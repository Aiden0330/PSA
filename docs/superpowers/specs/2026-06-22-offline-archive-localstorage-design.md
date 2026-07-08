# 离线存档(localStorage 回退)+ vitest 引入 — 设计文档

- 日期:2026-06-22 · 分支 `feat/offline-archive-localstorage`
- 状态:**已确认 方案=纯回退/独立仓、测试=引入 vitest、离线提示=细微提示,待 spec 复核**
- 方法:前端 TDD(vitest,新引入)纯逻辑 `localStore.ts`;`api.ts`/`App.tsx` 接线后用单文件离线 preview 验证;每部分一 commit

## 0. 目标(用户 2026-06-22 同意的 🥇)

后端不可达(单文件离线版,或后端未起)时,让 ETA 工作台存档四操作透明回退到浏览器 `localStorage`:存/列/读/删。**闭环单文件用例**——单文件 HTML 能存稿、刷新后重载继续编辑。`api.ts` 四个函数签名/返回类型不变,`App.tsx` 业务逻辑不改(仅加离线提示)。

## 1. 现状关键事实

- `api.ts` 已有 `jget` 回退:GET 类请求失败(网络抛错 **或** `!r.ok`,含单文件模式 `/api` 404)→ `embedFallback(path)` 取内置预置数据。`embedFallback` **仅覆盖只读预置**(scenarios/library/examples/event-tree/model),**不含 `/saved`** → 现状离线 `listSaved/loadSaved` 走 `jget` 仍抛错。
- 四个存档函数([api.ts:111–121](frontend/src/api.ts)):`listSaved`/`loadSaved` 经 `jget`(有回退框架但 `/saved` 未覆盖);`saveWorkspace`(POST)、`deleteSaved`(DELETE)失败直接 `throw`,**无回退**。
- `App.tsx` 用法:挂载 `listSaved().then(setSaved).catch(()=>{})`(已吞错 → 现状离线=空列表不崩);`onSaveWorkspace`(prompt 取名→save→重列)、`onLoadSaved`(load→`normalizeEta`→恢复)、`onDeleteSaved`(del→重列);`aggEtas` 对每个存档 `loadSaved` 后 `quantifyEventTree`(**引擎,后端专属**)。
- 后端契约([backend/storage.py](backend/storage.py)):`save_workspace`→`{id,name,saved_at}`(id=`uuid hex[:8]`,saved_at=ISO UTC);`list_workspaces`→`[{id,name,saved_at}]` 按 saved_at 倒序;`load_workspace`→整条 `{id,name,saved_at,payload}`,缺失抛 `KeyError`;`delete_workspace`→缺失抛 `KeyError`。`payload = {etModel, fts}` 不透明。
- 前端**无测试框架**(`package.json` 仅 dev/build/bundle/lint/preview);全仓**无 localStorage 使用**(均为绿地)。环境:Node 20.12 / Vite 5.4 / React 18(沿用既有锁版纪律)。

## 2. 设计

### 2.1 方案(选 A:纯回退 / 独立仓)

每个存档调用先试后端;**任何失败**(网络抛错 *或* `!r.ok`,即 `jget` 同款判据)→ 用 `localStorage`。在线→服务器仓;离线→浏览器仓。两仓**互不同步/合并**(YAGNI,单文件目标只需各自自洽)。否决:B localStorage 缓存+后端同步(引入冲突逻辑)、C 显式「本地/服务器」双 UI(多余界面负担)。

### 2.2 新增 `frontend/src/localStore.ts`(纯逻辑,可 TDD)

镜像 `storage.py` 契约,单键 `bess-eta:saved:v1` → JSON 字典 `{ [id]: SavedRecord }`(`SavedRecord = {id,name,saved_at,payload:{etModel,fts}}`,复用 `api.ts` 既有类型):

```ts
export function lsList(): SavedItem[]            // 读字典 → 元数据数组, 按 saved_at 倒序; 解析失败/无键 → []
export function lsLoad(id: string): SavedRecord  // 返回整条; 缺失 throw Error('not found')
export function lsSave(name, etModel, fts): SavedItem  // id=8位 hex 随机, saved_at=new Date().toISOString(); 写回; 返回元数据
export function lsDelete(id: string): void       // 删键; 缺失 throw Error('not found')
```

- id 生成:`crypto.getRandomValues` 取 4 字节转 hex(8 位,与后端同形);无 crypto 时退化 `Math.random`。
- 容错:读取 `getItem` 返回非法 JSON 或键不存在 → `lsList` 返回 `[]`(镜像后端 `list_workspaces` 吞坏文件);写入 `setItem` 抛错(私密模式/配额)→ `lsSave` 抛**可读错误**由调用方上抛。
- 每次 save = 新 id(不按名去重,与后端一致,允许重名)。

### 2.3 `api.ts` 接线(签名不变)

四函数各自 `try 后端 / catch 回退`(**与 `embedFallback` 分离**,后者保持只读预置专属):

```ts
let _savedOffline = false                 // 最近一次存档操作是否走了回退
export const wasSavedOffline = () => _savedOffline
// listSaved:  try 后端 GET(!ok 即抛) → catch lsList();  设 _savedOffline
// loadSaved:  try 后端 GET           → catch lsLoad(id); 设 _savedOffline
// saveWorkspace: try 后端 POST       → catch lsSave(...); 设 _savedOffline
// deleteSaved:   try 后端 DELETE     → catch lsDelete(id); 设 _savedOffline
```

回退判据 = `jget` 同款:`fetch` 抛错 **或** `!r.ok`(单文件 404 命中)均视为「后端不可用」。`_savedOffline` 在成功走后端时置 `false`、走回退时置 `true`,供 App 渲染提示。

### 2.4 `App.tsx` 离线提示(细微)

- 新状态 `const [archiveLocal, setArchiveLocal] = useState(false)`。
- 在 App **已有**的 `listSaved()` 解析点(挂载、save 后、delete 后)同步 `setArchiveLocal(wasSavedOffline())`——不新增网络调用。
- 渲染:存档控件附近条件显示一行 muted 提示(如 `离线:存档于本浏览器`),`archiveLocal` 为真时出现。不改存档名、不改下拉项文案。

### 2.5 引入 vitest(TDD 基座)

- devDeps:`vitest`(`^2.1` 配 Vite 5 / Node 20)、`jsdom`(`^25`,提供 `localStorage` 全局)。
- `frontend/vitest.config.ts`(独立于 `vite.config`,避免影响构建):`test: { environment: 'jsdom' }`。
- `package.json` 脚本:`"test": "vitest run"`。
- 测试文件显式 `import { describe, it, expect, beforeEach } from 'vitest'`(免改 tsconfig 的 globals 类型)。
- `frontend/src/localStore.test.ts`:`beforeEach(() => localStorage.clear())`。

## 3. 范围边界(重要)

离线闭环覆盖:**存/列/读/删工作台**(etModel + 各屏障 fts)+ 前端本就离线可算的(积式序列频率、风险矩阵、C1–C5)。**不**覆盖引擎类:⚙精确量化 / 重要度 / 不确定度 / 报告导出仍需 Python 后端(无法塞单文件)。故离线时 `aggEtas` 对存档项的汇总(走 `quantifyEventTree`)仍如现状失败;**载入/编辑**单个存档可用。

## 4. 文件改动

**新增**:`frontend/src/localStore.ts`、`frontend/src/localStore.test.ts`、`frontend/vitest.config.ts`。
**修改**:`frontend/src/api.ts`(四函数回退 + `wasSavedOffline`)、`frontend/src/App.tsx`(`archiveLocal` 状态 + 提示行 + 三处 set)、`frontend/package.json`(devDeps + test 脚本)。
**后端不改**。

## 5. 构建顺序与验收(TDD)

| # | 部分 | 验收 |
|---|---|---|
| 1 | vitest 基座 + `localStore.test.ts`(红) | `npm run test` 能跑,用例先红 |
| 2 | `localStore.ts`(绿) | 往返:save→list(含且倒序)→load(payload deep-equal)→delete→load 抛错;坏 JSON→list `[]`;setItem 抛错→lsSave 抛可读错误 |
| 3 | `api.ts` 四函数回退 + `wasSavedOffline` | `npm run build` 通过;单测覆盖「后端 fetch 失败→走 localStore」(mock fetch 抛错/`!ok`) |
| 4 | `App.tsx` 提示 + 接线 | `npm run build` 通过;单文件离线 preview:save→刷新页面→存档下拉仍含该项→载入恢复树(svg 节点数符合)+ 提示行显示 |

全量回归:`npm run build --prefix frontend` 通过;后端 `pytest` 不受影响(未改,仍 137 passed + 2 skipped)。单文件:`npm run bundle` 重出 `bess-eta-standalone.html`,http.server 静态根 + 浏览器导航验证离线存稿。

## 6. 取默认值 / 风险

- **纯回退/独立仓**(已确认):在线用服务器、离线用浏览器,跨环境不可移植——非目标。
- **vitest 即刻引入**(已确认):顺带为既有纯函数(`eventtree.ts`/`ftbanding.ts`)解锁单测 backlog;本轮只测 `localStore.ts`,其余留 backlog。
- **细微离线提示**(已确认):避免用户误以为服务器级持久。
- localStorage 配额/私密模式:`lsSave` 抛可读错误;`lsList` 退化 `[]`(App 挂载不崩,沿用现 `.catch(()=>{})`)。
- 混合模式(会话中后端忽断忽连)非目标:逐调用各取当时可达者。
- payload 体量:etModel + fts 通常 < 数百 KB,远低于 ~5MB 配额;超限走可读错误。
