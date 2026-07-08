# ETA 易用性修复 + 项目文件 + 可编辑参考库 — 设计文档

- 日期:2026-06-24 · 分支 `feat/eta-ux-and-editable-library`
- 状态:已确认(brainstorm:3 项澄清,用户批准设计),待 spec 复核 → writing-plans
- 方法:纯前端(React + TS,vitest);**多 agent 执行**(frontend-dev / test-runner / code-reviewer)
- 交付:重建离线单文件 `bess-eta-standalone.html`(`npm run bundle`)

## 0. 目标(用户 7 条 → 5 项功能 + 多 agent + 单文件)

1. **① ETA 页签名跟随初始事件名**(新建/套模板/改初因都实时刷新),可双击手动改名覆盖。
2. **② 删除 ETA**(当前完全没有删除入口)。
3. **③ 项目以文件形式保存**,供后续版本读取:新增「导出/导入文件」,保留现有快速存档。
4. **④ 参考库可扩展、数据可改**:localStorage 覆盖层 + 文件导入导出(离线单文件版亦可用)。
5. **⑤ FTA 页签列表标明所属 ETA**:从扁平列表改为**按 ETA 分组**(配合 ① 的有意义命名)。
6. **⑥ 多 agent 模式实现**(见 §6 分工)。
7. **⑦ 完成后重建单 HTML**(见 §交付)。

引擎 / MEF / 后端契约不变;均为纯前端模型与持久化层改动。

## 1. 现状关键事实(已核对源码)

- 离线单文件 `bess-eta-standalone.html` 由 `npm run bundle`(`vite build` + `frontend/scripts/inline-html.mjs`)生成;**无后端**——后端 API 在单文件版回退到 `embeddedData.ts`(`EMBEDDED_BESS`)。故③④的持久化必须不依赖后端。
- `frontend/src/App.tsx`(602 行,中枢):
  - `EtaTab = { key; name; model; fts; pfds }`(L34)。页签渲染 `summaries[].name`=`t.name`(L257、L542)。
  - 新建 `onAddEta` 取固定名 `'自定义 ETA N'`(L126-128);套模板 `buildScenarioTab` 取场景名(L111)。初因名 `model.initEvent` 由 `setInitEvent` 独立编辑(`EventTreeEditor.tsx` L390),**与页签名无联动** → ①根因。
  - ETA 页签行(L538-549)只有「+」`onAddEta`,**无删除** → ②根因。L532 的「删除」是删*存档*(`onDeleteSaved`),非删页签。
  - 存档:`onSaveWorkspace`/`onSaveAs`/`loadProject` 走 `api.ts` 的 `saveWorkspace/loadSaved`(后端 `/api/saved` 或 localStorage 回退),**非可携带文件** → ③缺口。
  - FTA 侧栏(L357-371)`etaFtRows` 扁平列出全部挂载 FTA,每行小灰字 `row.etaName`(L368);名无意义时分不清 → ⑤(已部分做,需分组 + 有意义名)。
  - `lib` 由 `getLibrary()` 单点加载(L70),传 LibPicker / EventTreeEditor。
- `frontend/src/project.ts`:`serializeProject(etas, activeKey, checkedKeys): ProjectPayload{v:2,…}` 与 `deserializeProject(payload, fallbackName)`(兼容旧单-ETA)。**③可直接复用。**
- `frontend/src/components/ReferenceLibrary.tsx`(74 行):**只读**三张表(器件失效率 / 屏障有效性 / 初因频率),数据 `getLibrary()`。`LibraryData` 形状见 `api.ts` L73-78(各段行含嵌套 `source{citation,url?,note?}`)。
- 基线库:`bess/reference_data.json` → `/api/bess/library`;离线回退 `EMBEDDED_BESS.library`。
- 历史:eventtree `setLinkFt`/`branchLeaf` 等纯函数返回新对象(撤销/重做 `etHist`)。

## 2. 设计

### 2.1 ① 页签名跟随初因名(可改名覆盖)

- `EtaTab` 与 `project.ts:ProjectEta` 增 `renamed?: boolean`。
- **派生显示名** `etaDisplayName(t, m) = t.renamed ? t.name : (m?.initEvent?.trim() || t.name)`(`m`=活动页用实时 `etModel`,其余用 `t.model`)。新建一个小工具函数,`summaries`(L251-258)、`etaFtRows`(L303-315 的 `etaName`)、ribbon「当前 ETA」(L515)、删除/导出默认名均改用它。
- 双击页签 → `window.prompt('ETA 名称', 当前显示名)` → 命中则 `setEtaTabs(list => list.map(x => x.key===key ? {...x, name, renamed:true} : x))`。
- 新建 `onAddEta`、套模板 `buildScenarioTab`、默认级联:均置 `renamed:false`(显示名跟随其 `initEvent`)。`newBlankEta` 的 `initEvent` 作为新页签初始显示名。
- 持久化:`serializeProject`/`deserializeProject` 增 `renamed`(缺省 `false`,旧存档兼容)。

### 2.2 ② 删除 ETA

新增 `onDeleteEta(key)`(App.tsx):

```
const onDeleteEta = (key: string) => {
  if (etaTabs.length <= 1) return                  // 仅剩 1 个不允许删
  const t = etaTabs.find(x => x.key === key); if (!t) return
  const nm = etaDisplayName(t, t.key === activeKey ? etModel : t.model)
  if (!window.confirm(`删除 ETA「${nm}」?此操作不可撤销。`)) return
  const snap = snapshotActive(etaTabs)             // 先固化活动页实时编辑
  const remaining = snap.filter(x => x.key !== key)
  setEtaTabs(remaining)
  setCheckedKeys(c => { const n = { ...c }; delete n[key]; return n })
  if (key === activeKey) {                          // 删活动页 → 切相邻
    const idx = snap.findIndex(x => x.key === key)
    loadIntoActive(remaining[Math.min(idx, remaining.length - 1)])
  }
}
```

- 每个页签加 ×(`onClick` 内 `e.stopPropagation()`;`etaTabs.length<=1` 时隐藏/禁用)。
- FTA 目标联动:删除后若当前 `ftEditTarget` 指向已消失的 ETA 行,既有 effect(L318-322)已重置为 `{src:'model'}`,无需额外处理。

### 2.3 ③ 项目文件导出 / 导入(新增,保留快速存档)

新建 `frontend/src/projectFile.ts`(纯逻辑,可单测):

```
export interface ProjectFile { kind: 'bess-psa-project'; version: 2; exportedAt: string;
  payload: ProjectPayload; libraryOverlay?: LibraryOverlay }       // libraryOverlay 见 2.4(次要项)
export function buildProjectFile(payload, libraryOverlay?): ProjectFile
export function downloadProjectFile(file: ProjectFile, baseName: string): void   // Blob + <a download>
export function parseProjectFile(text: string): { payload: ProjectPayload; libraryOverlay?: LibraryOverlay }
```

- `parseProjectFile`:容错——若 `kind/version` 匹配取 `payload`;否则把整个对象交给 `deserializeProject`(兼容直接导入旧 payload / 裸 v2)。失败抛可读错误。
- App:ribbon(L520-533 区)加「导出文件」(→ `downloadProjectFile(buildProjectFile(serializeProject(snapshotActive(etaTabs), activeKey, checkedKeys), libraryStore.getOverlay()), 名)`)与「导入文件」(`<input type=file accept=".json,.psaproj.json">` → `parseProjectFile` → 同 `loadProject` 的还原路径;若带 `libraryOverlay` 则 `libraryStore.mergeOverlay(...)`)。
- 全程无后端 → 离线单文件可用。文件名 `<项目/活动ETA显示名>.psaproj.json`。

### 2.4 ④ 可编辑可扩展参考库(localStorage 覆盖层 + 文件)

新建 `frontend/src/libraryStore.ts`(纯逻辑 + localStorage,可单测):

```
type Section = 'component_failure_rates' | 'barrier_effectiveness' | 'initiating_events'
interface LibraryOverlay { upsert: Record<Section, Record<string, any>>; deleted: Record<Section, string[]> }
const KEY = 'bess-eta:library-overlay:v1'
getOverlay(): LibraryOverlay                     // 读 localStorage(坏 JSON → 空)
setOverlay(o): void                              // 写(配额/隐私模式 → 抛可读错误)
applyOverlay(base: LibraryData, o): LibraryData  // 纯合并:overlay.upsert 按 id 覆盖/新增, deleted 隐藏;保 meta
upsertEntry(section, row): void / deleteEntry(section, id): void / resetOverlay(): void
mergeOverlay(other): void                        // 项目导入用:非破坏性并入(只 upsert,不删他项)
exportOverlay()/importOverlay(text) 复用 projectFile 同款信封或独立 { kind:'bess-psa-library' }
```

- `App.tsx`:`getLibrary()` 后 `applyOverlay` 得有效库供全局(LibPicker / `addBasicFromLib` / EventTreeEditor 取到改后值);维护 `libVersion` state,库编辑后 `++` 触发有效库重算。
- `ReferenceLibrary.tsx` 重写为**可编辑表**(手写 input,因行含嵌套 `source` 与文本/数值混合,比 AG Grid 更可控):
  - 三段各:每行值可改(名称 / 失效模式 / rate|pfd|freq / 单位 / grade / 来源 citation·url·note),行尾 ×删除;段尾「＋添加一行」(新行带新 id);顶部「导出参考库 / 导入参考库 / 恢复内置」。
  - 编辑即 `upsertEntry`/`deleteEntry` 写覆盖层并回调 App `onLibraryChange`(bump `libVersion`)。
- **次要子项**(可后做):项目文件信封携带 `libraryOverlay`(见 2.3),导入时 `mergeOverlay`,实现「库随项目走」。

### 2.5 ⑤ FTA 列表按 ETA 分组

FTA 侧栏(App.tsx L357-371)从扁平改**分组**:用 `etaFtRows` 按 `etaKey` 分组,每组渲染一个组标题(ETA 派生显示名,样式仿 `ftSidebarGroup`),下挂该 ETA 的 FTA 行(保留点击切换 + 活动高亮)。空时仍显「(无挂载故障树)」。

## 3. 跨切面 / 兼容

- 引擎 / MEF / 后端不变;③④纯前端 + localStorage + 文件,离线单文件版全可用。
- 旧存档兼容:`renamed` 缺省 `false`;`deserializeProject` 已兜底旧格式。
- 库覆盖层叠加在基线之上,「恢复内置」= 清空覆盖层;基线仍可由后端/embedded 升级而不丢用户改动(按 id 合并)。
- localStorage 写失败(隐私模式/配额)→ 统一可读错误(镜像 `localStore.ts` 现有处理)。

## 4. 测试策略

- **vitest `projectFile.ts`**:`buildProjectFile` 形状;`parseProjectFile`(正常信封 / 裸 v2 payload / 旧单-ETA / 坏 JSON 抛错);round-trip 等价。
- **vitest `libraryStore.ts`**:`applyOverlay`(upsert 覆盖既有 id、新增新 id、deleted 隐藏、保 meta、不改基线对象);`mergeOverlay` 非破坏;坏 JSON → 空覆盖层。
- **vitest `project.ts`**:`renamed` 往返序列化;旧 payload 反序列化 `renamed=false`。
- **组件/集成(preview DOM)**:① 改初因→页签名实时变,双击改名后不再跟随;② ×删除→页签消失、活动切相邻、仅剩 1 个无×;③ 导出下载 + 导入还原多 ETA;④ 改 rate→「从库加基本事件」取到新值、加行/删行/恢复内置、导出导入;⑤ FTA 侧栏按 ETA 分组且标题为有意义名。
- **回归**:`npm run test --prefix frontend` 全绿;`npm run build --prefix frontend`(`tsc -b && vite build`)干净;`.venv/Scripts/python.exe -m pytest -q` 无后端回归。

## 5. 范围 / 默认(已确认)

- ① 跟随初因名 + **可手动改名覆盖**(非"始终等于初因名")。
- ② 仅剩 1 个 ETA 时不允许删除(不进空状态);删除**不入撤销栈**(`confirm` 兜底)。
- ③ **新增**文件导出导入,**保留**现有快速存档(非替换)。
- ④ **localStorage 覆盖层 + 文件**(非写回后端、非仅内存);UI 手写可编辑表;「库随项目走」为次要子项。
- ⑤ 分组而非仅小字标注。

## 6. 多 agent 分工(关键:避免 App.tsx 并行冲突)

`App.tsx` 是单一中枢,①②③⑤ 都改它 → **并行改 App.tsx 必冲突**。故"先造独立模块,再集成":

| 工作流 | 范围 | 文件 | 调度 |
|---|---|---|---|
| **W2** | ③ 项目文件逻辑 | 新建 `projectFile.ts` + `projectFile.test.ts` | 与 W3 **并行** |
| **W3** | ④ 库覆盖层 + 可编辑库 UI | 新建 `libraryStore.ts` + `libraryStore.test.ts`、重写 `ReferenceLibrary.tsx` | 与 W2 **并行** |
| **W1** | ①②⑤ + `project.ts` 的 `renamed` + 接 W2/W3 进 App | `App.tsx`、`project.ts`(+ `project.test.ts`) | W2/W3 完成后**集成** |

- W2、W3 产出明确接口(`projectFile.*`、`libraryStore.*`、新 `ReferenceLibrary`),不碰 `App.tsx`;W1 仅在 App 接线(ribbon 两按钮、`getEffectiveLibrary` + `libVersion`、库 tab 回调)+ 实现 ①②⑤ + `project.ts` 字段。
- 各股用 `frontend-dev` 子代理;`test-runner` 跑 vitest 回失败项;`code-reviewer` 复审 diff。
- 集成后由主 session 跑全量回归 + `npm run bundle` 重建单 HTML + ROADMAP。

## 7. 构建顺序(供 writing-plans)

1. **(并行)W2** `projectFile.ts` + 单测(先红后绿)。
2. **(并行)W3** `libraryStore.ts` + 单测;重写 `ReferenceLibrary.tsx`。
3. **W1-a** `project.ts` 增 `renamed` + 单测。
4. **W1-b** App ①(派生名 + 双击改名 + 各处接派生名)。
5. **W1-c** App ②(`onDeleteEta` + 页签 ×)。
6. **W1-d** App ⑤(FTA 侧栏分组)。
7. **W1-e** App 接 W2(导出/导入按钮)+ W3(有效库 + libVersion + 库随项目)。
8. 全量回归 + `npm run bundle` 重建 `bess-eta-standalone.html` + ROADMAP 记录。
