# 离线存档(localStorage 回退)+ vitest 引入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 后端不可达时,ETA 工作台存档四操作(存/列/读/删)透明回退到浏览器 `localStorage`,闭环单文件离线版的存稿用例。

**Architecture:** 纯回退/独立仓:新 `localStore.ts` 镜像后端 `storage.py` 契约(单键 `bess-eta:saved:v1`);`api.ts` 四函数 `try 后端 / catch 回退`(判据同 `jget`:`fetch` 抛错或 `!r.ok`),并暴露 `wasSavedOffline()` 旗标;`App.tsx` 据旗标显示细微离线提示。顺带引入 vitest 作前端测试基座(本轮只测 `localStore.ts` 与 `api.ts` 回退)。

**Tech Stack:** TypeScript / React 18 / Vite 5;新增 vitest ^2.1 + jsdom ^25(Node 20.12 兼容)。

---

### Task 1: 引入 vitest 基座 + 写 `localStore` 失败测试(红)

**Files:**
- Modify: `frontend/package.json`(devDeps + `test` 脚本)
- Create: `frontend/vitest.config.ts`
- Create: `frontend/src/localStore.test.ts`

- [ ] **Step 1: 加 `test` 脚本到 package.json**

把 `frontend/package.json` 的 `scripts` 块由:
```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "bundle": "vite build && node scripts/inline-html.mjs",
    "lint": "eslint .",
    "preview": "vite preview"
  },
```
改为(新增最后一行 `test`):
```json
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "bundle": "vite build && node scripts/inline-html.mjs",
    "lint": "eslint .",
    "preview": "vite preview",
    "test": "vitest run"
  },
```

- [ ] **Step 2: 安装 vitest + jsdom(锁版以配 Vite 5 / Node 20)**

Run(工作目录 `frontend/`):
```bash
npm install -D vitest@^2.1.8 jsdom@^25.0.1 --prefix frontend
```
Expected: `package.json` 的 `devDependencies` 多出 `vitest` 与 `jsdom`,`node_modules` 安装成功(无 ERESOLVE)。

- [ ] **Step 3: 建 vitest 配置(独立于 vite.config,避免影响构建)**

Create `frontend/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

// 独立配置: 测试用 jsdom 环境(提供 localStorage / crypto 全局)
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: 写 `localStore` 失败测试(红)**

Create `frontend/src/localStore.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { lsList, lsLoad, lsSave, lsDelete } from './localStore'

const et = { initEvent: 'IE', initFreq: 1 }
const fts = { model_data: { parameters: [] }, fault_trees: [] }

beforeEach(() => localStorage.clear())

describe('localStore', () => {
  it('save 返回 8 位 hex id + ISO 时间戳', () => {
    const item = lsSave('案例A', et, fts)
    expect(item.name).toBe('案例A')
    expect(item.id).toMatch(/^[0-9a-f]{8}$/)
    expect(item.saved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('list 倒序返回元数据, 无存档时为 []', () => {
    expect(lsList()).toEqual([])
    const a = lsSave('A', et, fts)
    const b = lsSave('B', et, fts)
    const ids = lsList().map((x) => x.id)
    expect(ids).toContain(a.id)
    expect(ids).toContain(b.id)
    const list = lsList()
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1].saved_at >= list[i].saved_at).toBe(true)
    }
  })

  it('load 返回整条含 payload; 缺失抛错', () => {
    const a = lsSave('A', et, fts)
    const rec = lsLoad(a.id)
    expect(rec.payload.etModel).toEqual(et)
    expect(rec.payload.fts).toEqual(fts)
    expect(() => lsLoad('deadbeef')).toThrow()
  })

  it('delete 删除后 load 抛错; 删缺失抛错', () => {
    const a = lsSave('A', et, fts)
    lsDelete(a.id)
    expect(() => lsLoad(a.id)).toThrow()
    expect(() => lsDelete('deadbeef')).toThrow()
  })

  it('往返 save→list→load→delete', () => {
    const a = lsSave('round', { x: 1 }, { y: 2 })
    expect(lsList().map((i) => i.id)).toContain(a.id)
    expect(lsLoad(a.id).payload).toEqual({ etModel: { x: 1 }, fts: { y: 2 } })
    lsDelete(a.id)
    expect(lsList().map((i) => i.id)).not.toContain(a.id)
  })

  it('存储里是坏 JSON → list 返回 []', () => {
    localStorage.setItem('bess-eta:saved:v1', '{not json')
    expect(lsList()).toEqual([])
  })

  it('setItem 抛错(配额/隐私模式) → lsSave 抛可读错误', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(() => lsSave('A', et, fts)).toThrow(/本地存储/)
    spy.mockRestore()
  })
})
```

- [ ] **Step 5: 跑测试确认红**

Run: `npm run test --prefix frontend`
Expected: FAIL — vitest 启动正常但无法解析 `./localStore`(`Failed to resolve import "./localStore"`)。这同时验证了 vitest 基座可用。

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/src/localStore.test.ts
git commit -m "test(frontend): 引入 vitest + localStore 失败测试(红)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 实现 `localStore.ts`(绿)

**Files:**
- Create: `frontend/src/localStore.ts`
- Test: `frontend/src/localStore.test.ts`(Task 1 已建)

- [ ] **Step 1: 实现 localStore**

Create `frontend/src/localStore.ts`:
```ts
import type { SavedItem, SavedRecord } from './api'

// 单键存全部存档; import type 确保与 api.ts 仅类型耦合(运行时无循环依赖)
const KEY = 'bess-eta:saved:v1'
type Store = Record<string, SavedRecord>

function readStore(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const o = JSON.parse(raw)
    return o && typeof o === 'object' ? (o as Store) : {}
  } catch {
    return {} // 坏 JSON / localStorage 不可读 → 视为空(镜像后端吞坏文件)
  }
}

function writeStore(s: Store): void {
  localStorage.setItem(KEY, JSON.stringify(s)) // 可能抛(配额/隐私模式)→ 由调用方处理
}

function genId(): string {
  const c = (globalThis as any).crypto
  if (c?.getRandomValues) {
    const a = new Uint8Array(4)
    c.getRandomValues(a)
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0')
}

export function lsList(): SavedItem[] {
  const s = readStore()
  return Object.values(s)
    .map(({ id, name, saved_at }) => ({ id, name, saved_at }))
    .sort((a, b) => (a.saved_at < b.saved_at ? 1 : -1))
}

export function lsLoad(id: string): SavedRecord {
  const r = readStore()[id]
  if (!r) throw new Error(`存档 ${id} 不存在`)
  return r
}

export function lsSave(name: string, etModel: any, fts: any): SavedItem {
  const s = readStore()
  const id = genId()
  const rec: SavedRecord = { id, name, saved_at: new Date().toISOString(), payload: { etModel, fts } }
  s[id] = rec
  try {
    writeStore(s)
  } catch {
    throw new Error('本地存储失败(可能是隐私模式或空间不足)')
  }
  return { id, name, saved_at: rec.saved_at }
}

export function lsDelete(id: string): void {
  const s = readStore()
  if (!(id in s)) throw new Error(`存档 ${id} 不存在`)
  delete s[id]
  writeStore(s)
}
```

- [ ] **Step 2: 跑测试确认绿**

Run: `npm run test --prefix frontend`
Expected: PASS — `localStore.test.ts` 全部用例通过(7 passed)。

- [ ] **Step 3: Commit**

```bash
git add frontend/src/localStore.ts
git commit -m "feat(frontend): localStore.ts 浏览器存档(localStorage)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `api.ts` 四函数回退 + `wasSavedOffline` + 回退测试

**Files:**
- Modify: `frontend/src/api.ts:111-121`(四函数)+ 顶部加 import 与旗标
- Create: `frontend/src/api.saved.test.ts`

- [ ] **Step 1: 写 api 回退失败测试(红)**

Create `frontend/src/api.saved.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { listSaved, loadSaved, saveWorkspace, deleteSaved, wasSavedOffline } from './api'

const et = { initEvent: 'IE' }
const fts = { model_data: { parameters: [] }, fault_trees: [] }

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('api 存档回退', () => {
  it('后端 reject → 走 localStorage 全套往返, wasSavedOffline=true', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network'))))
    const item = await saveWorkspace('s1', et, fts)
    expect(item.id).toMatch(/^[0-9a-f]{8}$/)
    expect(wasSavedOffline()).toBe(true)
    const list = await listSaved()
    expect(list.map((x) => x.id)).toContain(item.id)
    const rec = await loadSaved(item.id)
    expect(rec.payload.etModel).toEqual(et)
    await deleteSaved(item.id)
    expect((await listSaved()).map((x) => x.id)).not.toContain(item.id)
  })

  it('后端可达 → 用后端数据, wasSavedOffline=false', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([{ id: 'srv1', name: 'fromServer', saved_at: '2026-06-22T00:00:00Z' }]) }),
    ) as any)
    const list = await listSaved()
    expect(list[0].id).toBe('srv1')
    expect(wasSavedOffline()).toBe(false)
  })

  it('后端 !ok(404) 视为回退', async () => {
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) }),
    ) as any)
    const list = await listSaved()
    expect(wasSavedOffline()).toBe(true)
    expect(Array.isArray(list)).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认红**

Run: `npm run test --prefix frontend`
Expected: FAIL — `wasSavedOffline` 未导出(`does not provide an export named 'wasSavedOffline'`)。

- [ ] **Step 3: 改 api.ts —— 顶部加 import + 旗标**

把 `frontend/src/api.ts:1` 由:
```ts
import { EMBEDDED_BESS } from './embeddedData'

const BASE = '/api'
```
改为:
```ts
import { EMBEDDED_BESS } from './embeddedData'
import { lsList, lsLoad, lsSave, lsDelete } from './localStore'

const BASE = '/api'

// 最近一次存档操作是否走了 localStorage 回退(后端不可达)。供 UI 显示离线提示。
let _savedOffline = false
export const wasSavedOffline = () => _savedOffline
```

- [ ] **Step 4: 改 api.ts —— 四函数加回退**

把 `frontend/src/api.ts:111-121` 由:
```ts
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
改为:
```ts
export async function listSaved(): Promise<SavedItem[]> {
  try {
    const r = await fetch(`${BASE}/saved`)
    if (!r.ok) throw new Error(`/saved → ${r.status}`)
    const data = (await r.json()) as SavedItem[]
    _savedOffline = false
    return data
  } catch {
    _savedOffline = true
    return lsList()
  }
}
export async function loadSaved(id: string): Promise<SavedRecord> {
  try {
    const r = await fetch(`${BASE}/saved/${id}`)
    if (!r.ok) throw new Error(`/saved/${id} → ${r.status}`)
    const data = (await r.json()) as SavedRecord
    _savedOffline = false
    return data
  } catch {
    _savedOffline = true
    return lsLoad(id)
  }
}
export async function saveWorkspace(name: string, etModel: any, fts: any): Promise<SavedItem> {
  try {
    const r = await fetch(`${BASE}/saved`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, payload: { etModel, fts } }) })
    if (!r.ok) throw new Error(`save → ${r.status}`)
    const data = (await r.json()) as SavedItem
    _savedOffline = false
    return data
  } catch {
    _savedOffline = true
    return lsSave(name, etModel, fts)
  }
}
export async function deleteSaved(id: string): Promise<void> {
  try {
    const r = await fetch(`${BASE}/saved/${id}`, { method: 'DELETE' })
    if (!r.ok) throw new Error(`delete → ${r.status}`)
    _savedOffline = false
  } catch {
    _savedOffline = true
    lsDelete(id)
  }
}
```

> 注:`listSaved`/`loadSaved` 不再走 `jget`(`embedFallback` 保持只读预置专属)。`SavedItem`/`SavedRecord` 类型已在本文件上方定义(api.ts:109-110),无需改动。

- [ ] **Step 5: 跑测试确认绿 + 构建**

Run: `npm run test --prefix frontend`
Expected: PASS(localStore 7 + api 3 = 10 passed)。
Run: `npm run build --prefix frontend`
Expected: 构建通过(无 TS 报错;localStore 与 api 间为 `import type`,无运行时循环)。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api.ts frontend/src/api.saved.test.ts
git commit -m "feat(frontend): api 存档四操作后端不可达时回退 localStorage" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `App.tsx` 离线提示 + 旗标同步

**Files:**
- Modify: `frontend/src/App.tsx`(import 行 :3、状态 :48 附近、挂载 :55、`onSaveWorkspace` :131、`onDeleteSaved` :146、存档控件 JSX :286-294)

无单测(App 为大型集成组件,RTL 未引入,本轮范围外);经 `npm run build` 类型检查 + 单文件离线 preview 验收。

- [ ] **Step 1: import 加入 `wasSavedOffline`**

把 `frontend/src/App.tsx:3`:
```ts
import { getExamples, getModel, quantify, getBessEventTree, getScenarios, listSaved, loadSaved, saveWorkspace, deleteSaved, getLibrary, importMef, quantifyEventTree } from './api'
```
改为(末尾加 `wasSavedOffline`):
```ts
import { getExamples, getModel, quantify, getBessEventTree, getScenarios, listSaved, loadSaved, saveWorkspace, deleteSaved, getLibrary, importMef, quantifyEventTree, wasSavedOffline } from './api'
```

- [ ] **Step 2: 加 `archiveLocal` 状态**

在 `frontend/src/App.tsx:48` 的:
```ts
  const [savedId, setSavedId] = useState<string>('')
```
之后新增一行:
```ts
  const [archiveLocal, setArchiveLocal] = useState(false)   // 存档是否落在本地(后端不可达)
```

- [ ] **Step 3: 挂载点同步旗标**

把 `frontend/src/App.tsx:55`:
```ts
  useEffect(() => { listSaved().then(setSaved).catch(() => {}) }, [])
```
改为:
```ts
  useEffect(() => { listSaved().then((s) => { setSaved(s); setArchiveLocal(wasSavedOffline()) }).catch(() => {}) }, [])
```

- [ ] **Step 4: 保存后同步旗标**

把 `frontend/src/App.tsx:131`(`onSaveWorkspace` 内):
```ts
    setSaved(await listSaved())
```
改为:
```ts
    setSaved(await listSaved()); setArchiveLocal(wasSavedOffline())
```

- [ ] **Step 5: 删除后同步旗标**

把 `frontend/src/App.tsx:146`(`onDeleteSaved` 内):
```ts
    await deleteSaved(savedId); setSavedId(''); setSaved(await listSaved())
```
改为:
```ts
    await deleteSaved(savedId); setSavedId(''); setSaved(await listSaved()); setArchiveLocal(wasSavedOffline())
```

- [ ] **Step 6: 存档控件加细微离线提示**

把 `frontend/src/App.tsx:293`(删除按钮那行)后、第 294 行 `</div>` 前插入提示。即把:
```tsx
            <button onClick={onDeleteSaved} disabled={!savedId} style={{ fontSize: 12, color: '#dc2626' }}>删除</button>
          </div>
```
改为:
```tsx
            <button onClick={onDeleteSaved} disabled={!savedId} style={{ fontSize: 12, color: '#dc2626' }}>删除</button>
            {archiveLocal && <span style={{ fontSize: 12, color: '#94a3b8' }} title="后端不可达,存档保存在此浏览器(localStorage)">离线:存档于本浏览器</span>}
          </div>
```

- [ ] **Step 7: 构建**

Run: `npm run build --prefix frontend`
Expected: 构建通过(无 TS 报错)。

- [ ] **Step 8: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(frontend): 离线存档时显示「存档于本浏览器」提示" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 重出单文件 + 离线端到端验证

**Files:** 无源码改动(产物 `bess-eta-standalone.html` 已 gitignore,不提交)

- [ ] **Step 1: 重新打包单文件**

Run(需先有运行中的后端供 `vite build`?否——bundle 仅静态构建,不需后端):
```bash
npm run bundle --prefix frontend
```
Expected: 生成/更新 `bess-eta-standalone.html`(单文件)。

> 注:内置预置数据 `embeddedData.ts` 本轮未变,无需重跑 `capture-data.mjs`。

- [ ] **Step 2: 起静态服务器(非后端端口)**

Run(仓库根;端口避开用户自有 :8000/:5173,用 4180):
```bash
python -m http.server 4180
```

- [ ] **Step 3: 离线端到端验证(preview_eval,非截图——重包截图超时)**

用 preview 工具导航到 `http://localhost:4180/bess-eta-standalone.html`(此时 `/api` 404 → 触发回退,即便后端在跑也走离线路径)。验证序列:
1. 改一处 ETA(如初始事件名),点「💾 保存当前」,prompt 输入名(preview 覆盖 `window.prompt` 返回固定名)。
2. 断言:存档下拉出现该名;「离线:存档于本浏览器」提示可见。
3. `window.location.reload()`。
4. 断言:刷新后存档下拉仍含该项(证明 localStorage 持久)。
5. 选中该存档载入;断言:ETA 画布 svg 节点数 > 0 且初始事件名与保存前一致。
6. 删除该存档;断言:下拉不再含之。

Expected: 全部断言通过。

- [ ] **Step 4: 停服 + 撤临时 preview 配置**

停 `http.server`;若改过 `.claude/launch.json` 临时端口,撤回。

- [ ] **Step 5: 最终回归 + 收尾**

Run:
```bash
npm run test --prefix frontend   # 10 passed
npm run build --prefix frontend  # 通过
```
后端未改,`pytest` 不受影响(仍 137 passed + 2 skipped,无需重跑,除非顺手核对)。

> 收尾(由我在计划外执行):刷新 memory `bess-psa-tool.md`(加 ⑩ 段:离线存档 + vitest 引入),并视情更新 `ROADMAP.md`。

---

## Self-Review

**1. Spec coverage:**
- 方案 A 纯回退 → Task 3(四函数 try/catch)✅
- `localStore.ts` 契约/容错/id → Task 2 + 测试 Task 1 ✅
- `api.ts` 接线 + `wasSavedOffline` → Task 3 ✅
- `App.tsx` 离线提示 + 三处同步 → Task 4 ✅
- vitest 引入 → Task 1 ✅
- 范围边界(引擎仍后端)→ 不需代码;Task 5 验证仅覆盖存/读/删 ✅
- 验收表 1–4 → Task 1/2/3/4 + Task 5 端到端 ✅

**2. Placeholder scan:** 无 TBD/TODO;每个代码步均含完整代码与确切命令/期望输出。

**3. Type consistency:** `lsList/lsLoad/lsSave/lsDelete` 签名在 Task 2 定义,Task 3 import 一致;`SavedItem/SavedRecord` 复用 api.ts 既有导出;`wasSavedOffline` 在 Task 3 定义、Task 4 import 一致;`archiveLocal/setArchiveLocal` 命名贯穿 Task 4 一致。
