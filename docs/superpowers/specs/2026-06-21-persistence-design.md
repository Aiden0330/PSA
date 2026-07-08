# ETA 工作台持久化(后端命名存档)— 设计文档

- 日期:2026-06-21 · 分支 `feat/persistence`
- 状态:**已确认机制=后端命名存档、范围=ETA 工作台,待 spec 复核**
- 方法:后端 TDD(pytest);前端 build + `preview_eval`;每部分一 commit

## 0. 目标(任务 6)

把当前仅存内存的「自定义/编辑后的 ETA 工作台」持久化到服务器磁盘:命名存档(存/列/读/删),跨浏览器与会话,文件可分享。

## 1. 现状关键事实

- 自定义 ETA(`App.tsx` 的 `customEtas`)与编辑后的 `etModel` + 各屏障故障树 `etFts`(第二个 `useModel` 的 `ModelJson`)均**仅在内存**,刷新即失。
- 后端无持久化层;`examples/` 为只读示例。`bess/*.json` 为内置数据。
- ETA 工作台完整状态 = `EventTreeModel`(`initEvent/initFreq/functionalEvents[含 linkFt]/root` 二叉树)+ `fts: ModelJson`(各屏障故障树 + 参数)。`computePfds(fts, model)` 由 FT 顶概率得各屏障 PFD。

## 2. 设计

### 2.1 数据形态

保存**可再编辑的前端状态**(非引擎请求,后者会丢失二叉树编辑结构):

```jsonc
// saved/<id>.json
{
  "id": "<短 uuid hex>",
  "name": "用户取的名字",
  "saved_at": "2026-06-21T..Z",
  "payload": {
    "etModel": { "initEvent","initFreq","functionalEvents":[{id,label,failProb,linkFt?}], "root": <EtNode 树> },
    "fts": { "model_data": {"parameters":[...]}, "fault_trees": [...] }
  }
}
```

后端将 `payload` 当**不透明 JSON** 存取(不解析其结构,前端自洽)。

### 2.2 后端(`backend/storage.py` + `backend/app.py` + `backend/schemas.py`)

`backend/storage.py`(存储目录可注入, 便于测试):
```python
_DIR = os.path.join(os.path.dirname(__file__), "..", "saved")  # repo 根 saved/(gitignore)
def _dir() -> str: ...                       # 确保存在并返回 _DIR
def save_workspace(name, payload, id=None) -> dict   # 写文件, 返回 {id,name,saved_at}
def list_workspaces() -> list[dict]          # 读各文件元数据 [{id,name,saved_at}], 按 saved_at 倒序
def load_workspace(id) -> dict               # 返回整条 {id,name,saved_at,payload}; 不存在抛 KeyError
def delete_workspace(id) -> None             # 删文件; 不存在抛 KeyError
```
- id:`uuid.uuid4().hex[:8]`;文件名 `saved/<id>.json`;name 存文件内(允许重名)。
- 路径安全:`id` 仅允许 `[0-9a-f]+`(校验),拒绝路径穿越。

端点(`app.py`)+ 请求模型(`schemas.py`):
```python
class SaveWorkspaceRequest(BaseModel):
    name: str
    payload: dict

# GET    /api/saved        -> [{id,name,saved_at}]
# POST   /api/saved        (SaveWorkspaceRequest) -> {id,name,saved_at}
# GET    /api/saved/{id}   -> {id,name,saved_at,payload}   (404 if missing)
# DELETE /api/saved/{id}   -> {ok: true}                   (404 if missing)
```

**测试**(`tests/backend/test_storage.py`):用 `monkeypatch` 把 `storage._DIR` 指向 `tmp_path`;往返:save→list(含该项)→load(payload 一致)→delete→list(空)/load(404)。端点测试同样隔离目录。

### 2.3 前端(`api.ts` + `App.tsx`)

`api.ts`:
```ts
export interface SavedItem { id: string; name: string; saved_at: string }
export const listSaved = () => jget<SavedItem[]>('/saved')
export async function saveWorkspace(name, etModel, fts) -> {id,...}   // POST /saved {name, payload:{etModel,fts}}
export const loadSaved = (id) => jget<{id,name,saved_at,payload:{etModel,fts}}>(`/saved/${id}`)
export async function deleteSaved(id) -> void                          // DELETE /saved/{id}
```

`App.tsx` ETA 工具栏新增一行:
- **保存当前**:`window.prompt` 取名 → `saveWorkspace(name, etModel, etFts.model)` → 刷新存档列表。
- **存档下拉**(load):选中 id → `loadSaved(id)` → `setEtModel(payload.etModel)`、`etFts.reset(payload.fts)`、`setBess(null)`、`computePfds(payload.fts, payload.etModel)` 回写 pfds/failProb(复用现有恢复逻辑)。
- **删除**:删当前选中存档 → 刷新列表。
- 状态:`saved: SavedItem[]`、`savedId: string`;挂载时 `listSaved()`。

### 2.4 `.gitignore`

加 `saved/`(用户数据,不入库)。

## 3. 文件改动

**新增**:`backend/storage.py`;测试 `tests/backend/test_storage.py`。
**修改**:`backend/schemas.py`(SaveWorkspaceRequest)、`backend/app.py`(4 端点)、`frontend/src/api.ts`、`frontend/src/App.tsx`、`.gitignore`。

## 4. 构建顺序与验收

| # | 部分 | 验收 |
|---|---|---|
| 1 | `storage.py` + 测试 | tmp 目录往返:save→list→load(payload 一致)→delete→404 |
| 2 | 4 端点 + schemas | TestClient(隔离目录):POST 返回 id;GET 列表含之;GET/{id} payload 一致;DELETE 后 404 |
| 3 | 前端 api + App 控件 | build 通过;`preview_eval` 覆盖 `window.prompt` 触发保存 → 存档下拉出现该项 → 选中加载恢复树(svg 节点数符合) |

全量:`pytest -q`(≥118 + 新增,CUDD 仍 2 skip);`npm run build --prefix frontend` 通过。

## 5. 取默认值 / 风险

- **后端命名存档**(已确认),`saved/*.json` opaque payload。
- **范围 = ETA 工作台**(etModel + fts);不含 FT 标签独立模型(用户选定)。
- 单用户本地工具,无并发/鉴权;重名允许(id 区分)。
- 测试隔离:`_DIR` 经 monkeypatch 指向 tmp,避免污染真实 `saved/`。
- 前端保存名经 `window.prompt`(preview 验证时覆盖之)。
