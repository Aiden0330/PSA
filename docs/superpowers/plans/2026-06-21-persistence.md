# ETA 工作台持久化(后端命名存档)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 ETA 工作台(`etModel` + 各屏障故障树 `fts` + 名称)命名存档到服务器磁盘 `saved/*.json`,支持存/列/读/删,前端工具栏可保存/加载/删除。

**Architecture:** 后端 `storage.py` 把前端可再编辑状态当不透明 JSON 存取(存储目录可注入便于测试);4 个 REST 端点;前端加保存/存档下拉/删除控件,加载即恢复并重算各屏障 PFD(复用 `computePfds`)。

**Tech Stack:** Python/FastAPI/pytest;React/TS。`saved/` 进 `.gitignore`。

**验证:** 后端 `.\.venv\Scripts\python.exe -m pytest -q`;前端 `npm run build --prefix frontend` + `preview_eval`(改后端须重启 uvicorn 预览)。提交结尾 `Co-Authored-By: Claude Opus 4.8`。

---

## Task 1: 存储模块 `backend/storage.py`

**Files:** Create `backend/storage.py`; Test `tests/backend/test_storage.py`

- [ ] **Step 1: 写失败测试** `tests/backend/test_storage.py`

```python
import pytest
import backend.storage as storage


def test_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    meta = storage.save_workspace("场景A", {"etModel": {"x": 1}, "fts": {"y": 2}})
    assert meta["name"] == "场景A" and meta["id"]
    assert any(w["id"] == meta["id"] for w in storage.list_workspaces())
    rec = storage.load_workspace(meta["id"])
    assert rec["payload"]["etModel"] == {"x": 1}
    storage.delete_workspace(meta["id"])
    assert storage.list_workspaces() == []
    with pytest.raises(KeyError):
        storage.load_workspace(meta["id"])


def test_bad_id_rejected(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    with pytest.raises(KeyError):
        storage.load_workspace("../etc/passwd")
```

- [ ] **Step 2: 跑测试确认失败** — `... -m pytest tests/backend/test_storage.py -q` → ModuleNotFoundError。

- [ ] **Step 3: 写 `backend/storage.py`**

```python
from __future__ import annotations
import json, os, re, uuid
from datetime import datetime, timezone

_DIR = os.path.join(os.path.dirname(__file__), "..", "saved")
_ID_RE = re.compile(r"^[0-9a-f]+$")


def _dir() -> str:
    os.makedirs(_DIR, exist_ok=True)
    return _DIR


def _path(sid: str) -> str:
    if not _ID_RE.match(sid):          # 路径安全: 仅 hex id
        raise KeyError(sid)
    return os.path.join(_dir(), f"{sid}.json")


def save_workspace(name: str, payload: dict, sid: str | None = None) -> dict:
    sid = sid or uuid.uuid4().hex[:8]
    rec = {"id": sid, "name": name,
           "saved_at": datetime.now(timezone.utc).isoformat(), "payload": payload}
    with open(_path(sid), "w", encoding="utf-8") as f:
        json.dump(rec, f, ensure_ascii=False, indent=2)
    return {"id": sid, "name": name, "saved_at": rec["saved_at"]}


def list_workspaces() -> list[dict]:
    out = []
    for fn in os.listdir(_dir()):
        if fn.endswith(".json"):
            try:
                with open(os.path.join(_dir(), fn), encoding="utf-8") as f:
                    r = json.load(f)
                out.append({"id": r["id"], "name": r["name"], "saved_at": r["saved_at"]})
            except Exception:
                pass
    out.sort(key=lambda x: x["saved_at"], reverse=True)
    return out


def load_workspace(sid: str) -> dict:
    p = _path(sid)
    if not os.path.isfile(p):
        raise KeyError(sid)
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def delete_workspace(sid: str) -> None:
    p = _path(sid)
    if not os.path.isfile(p):
        raise KeyError(sid)
    os.remove(p)
```

- [ ] **Step 4: 跑测试确认通过** — `... -m pytest tests/backend/test_storage.py -q` → PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/storage.py tests/backend/test_storage.py
git commit -m "feat(storage): ETA 工作台命名存档(存/列/读/删, 目录可注入)"
```

## Task 2: 4 个端点 + schemas + .gitignore

**Files:** Modify `backend/schemas.py`, `backend/app.py`, `.gitignore`; Test `tests/backend/test_saved_api.py`

- [ ] **Step 1: 写失败测试** `tests/backend/test_saved_api.py`

```python
import backend.storage as storage
from fastapi.testclient import TestClient
from backend.app import app

client = TestClient(app)


def test_saved_api_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    r = client.post("/api/saved", json={"name": "T1", "payload": {"etModel": {"a": 1}, "fts": {}}})
    assert r.status_code == 200
    sid = r.json()["id"]
    assert any(w["id"] == sid for w in client.get("/api/saved").json())
    got = client.get(f"/api/saved/{sid}").json()
    assert got["payload"]["etModel"] == {"a": 1}
    assert client.delete(f"/api/saved/{sid}").status_code == 200
    assert client.get(f"/api/saved/{sid}").status_code == 404
```

- [ ] **Step 2: 跑测试确认失败** → 404(端点不存在)。

- [ ] **Step 3: `schemas.py` 加请求模型**(末尾)

```python
class SaveWorkspaceRequest(BaseModel):
    name: str
    payload: dict
```

- [ ] **Step 4: `backend/app.py` 加 4 端点**(放 `/api/event-tree/quantify` 附近)

```python
@app.get("/api/saved")
def api_saved_list():
    from backend import storage
    return storage.list_workspaces()

@app.post("/api/saved")
def api_saved_create(req: schemas.SaveWorkspaceRequest):
    from backend import storage
    return storage.save_workspace(req.name, req.payload)

@app.get("/api/saved/{sid}")
def api_saved_get(sid: str):
    from backend import storage
    try:
        return storage.load_workspace(sid)
    except KeyError:
        raise HTTPException(404, f"no saved workspace {sid}")

@app.delete("/api/saved/{sid}")
def api_saved_delete(sid: str):
    from backend import storage
    try:
        storage.delete_workspace(sid)
    except KeyError:
        raise HTTPException(404, f"no saved workspace {sid}")
    return {"ok": True}
```

- [ ] **Step 5: `.gitignore` 加一行**(用 Edit 在文件末尾追加)

```
saved/
```

- [ ] **Step 6: 跑测试 + 全量回归** — `... -m pytest tests/backend/test_saved_api.py -q`(PASS)+ `... -m pytest -q`(≥118 绿)。

- [ ] **Step 7: 提交**

```bash
git add backend/schemas.py backend/app.py tests/backend/test_saved_api.py .gitignore
git commit -m "feat(api): /api/saved 存/列/读/删端点; saved/ 入 gitignore"
```

## Task 3: 前端保存/加载/删除控件

**Files:** Modify `frontend/src/api.ts`, `frontend/src/App.tsx`

- [ ] **Step 1: `api.ts` 加类型与函数**(末尾)

```ts
export interface SavedItem { id: string; name: string; saved_at: string }
export interface SavedRecord { id: string; name: string; saved_at: string; payload: { etModel: any; fts: any } }
export const listSaved = () => jget<SavedItem[]>('/saved')
export const loadSaved = (id: string) => jget<SavedRecord>(`/saved/${id}`)
export async function saveWorkspace(name: string, etModel: any, fts: any): Promise<SavedItem> {
  const r = await fetch(`${BASE}/saved`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, payload: { etModel, fts } }) })
  if (!r.ok) throw new Error(`save → ${r.status}`)
  return r.json()
}
export async function deleteSaved(id: string): Promise<void> {
  const r = await fetch(`${BASE}/saved/${id}`, { method: 'DELETE' })
  if (!r.ok) throw new Error(`delete → ${r.status}`)
}
```

- [ ] **Step 2: `App.tsx` import 与 state**

import 行加 `listSaved, loadSaved, saveWorkspace, deleteSaved`(从 `./api`)与 `type ... SavedItem`。state 加:
```tsx
const [saved, setSaved] = useState<SavedItem[]>([])
const [savedId, setSavedId] = useState<string>('')
```
挂载效果:`useEffect(() => { listSaved().then(setSaved).catch(() => {}) }, [])`。

- [ ] **Step 3: `App.tsx` 处理函数**(放 `onNewEta` 附近)

```tsx
const onSaveWorkspace = async () => {
  if (!etModel) return
  const name = window.prompt('存档名称', etModel.initEvent || 'ETA')
  if (!name) return
  await saveWorkspace(name, etModel, etFts.model ?? { model_data: { parameters: [] }, fault_trees: [] })
  setSaved(await listSaved())
}
const onLoadSaved = async (id: string) => {
  setSavedId(id)
  if (!id) return
  const rec = await loadSaved(id)
  const model = rec.payload.etModel as EventTreeModel
  const fts = rec.payload.fts as ModelJson
  setBess(null); etFts.reset(fts)
  const p = await computePfds(fts, model)
  setPfds(p)
  setEtModel({ ...model, functionalEvents: model.functionalEvents.map((f) => (f.id in p ? { ...f, failProb: p[f.id] } : f)) })
}
const onDeleteSaved = async () => {
  if (!savedId) return
  await deleteSaved(savedId); setSavedId(''); setSaved(await listSaved())
}
```

- [ ] **Step 4: `App.tsx` ETA 工具栏加一行**(在现有「场景/新建 ETA」那行之后)

```tsx
<div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
  <button onClick={onSaveWorkspace} style={{ fontSize: 12 }}>💾 保存当前</button>
  <span style={{ fontSize: 13 }}>存档:</span>
  <select value={savedId} onChange={(e) => onLoadSaved(e.target.value)}>
    <option value="">—</option>
    {saved.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
  </select>
  <button onClick={onDeleteSaved} disabled={!savedId} style={{ fontSize: 12, color: '#dc2626' }}>删除</button>
</div>
```

- [ ] **Step 5: 构建** — `npm run build --prefix frontend` 通过(修 TS 报错)。

- [ ] **Step 6: 重启预览并验证**
  - `preview_stop` 旧 server(若在跑)→ `preview_start` bess-app(**载入新端点**)。
  - `preview_eval`:进 ETA(默认),选 SC_OVERCHARGE 加载;`window.prompt = () => '测试存档'`;点「保存当前」;轮询「存档」下拉出现「测试存档」选项;再 `select` 该项触发 `onLoadSaved`,确认树重渲染(`svg circle` 存在、首屏障文本)。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/api.ts frontend/src/App.tsx
git commit -m "feat(frontend): ETA 工作台保存/加载/删除(后端命名存档)"
```

## 收尾

- [ ] 全量回归 `... -m pytest -q`(≥118 + 新增 storage/api,CUDD 仍 2 skip)。
- [ ] `npm run build --prefix frontend` 通过;预览端到端(保存→加载→删除)。
- [ ] 更新 `docs/superpowers/ROADMAP.md`(持久化:后端命名存档)。

## 自检(plan vs spec)

- spec 2.1 数据形态(payload={etModel,fts})→ Task 1/3 一致。
- spec 2.2 storage + 端点 → Task 1/2。
- spec 2.3 前端控件 → Task 3。
- spec 2.4 .gitignore → Task 2 Step 5。
- 类型一致:`save_workspace/list_workspaces/load_workspace/delete_workspace`、`_DIR`(测试 monkeypatch)、`SaveWorkspaceRequest`、`listSaved/loadSaved/saveWorkspace/deleteSaved`、`SavedItem/SavedRecord` 跨任务一致。
- 关键坑:**改后端端点后必须重启 uvicorn 预览**(本会话已踩过:静态 dist 会更新但 Python 进程不自动重载)。
- 复用:`computePfds`(App,Task5 已加)做加载后 PFD 恢复。
