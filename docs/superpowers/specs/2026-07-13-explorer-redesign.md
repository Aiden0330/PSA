# Explorer 重设计(shell-A 工程座舱 + 多项目)实施规格

*2026-07-13 · 状态:实施中(R1-R2 Fable / R3 Opus / R4 sonnet·frontend-dev / R5 Opus)·
mockups:`docs/design/mockups/2026-07-13-explorer-*.html`(v2,用户两轮反馈定稿:
树保留并瘦身;4/5 不合并;ETA/FTA 画布主导可缩放;ETA 直角走线 = 现有 EtCanvas 制式)*

## 0 · 总则

- 视觉基调 = shell-A:浅色工程风(`--bg:#f1f5f9`,teal 强调 `#0f766e`),菜单栏 + ribbon +
  瘦身工程树(212px)+ 密排表 + 坞式检视器(290px)+ 状态栏。深色 chrome/顶部 8 页签/抽屉移除。
- **「保留每个控件与处理器」**是每批的验收底线:现有全部功能(量化/不确定性/重要度/AI 草案/
  分析设置/评审签发/贝叶斯/导入导出/模板/场景)必须在新壳里有落位,处理器原样复用。
- 认证门不动:`App`(门)/`AppShell`(壳)拆分与 `needsLogin` 语义保持;登录墙样式随新基调微调即可。
- 每批:`make check` + preview 实测 + `make bundle`;一任务一提交。

## 1 · R2 多项目状态架构(本规格的承重墙,Fable 实施)

### 1.1 设计:顶层即活动槽 + 停放注册表(方案 C)

拒绝的方案:双写镜像(活动项目同时存在顶层与注册表 → 两处真相,必然分歧);
选择器全改(破坏 `s.present.etas` 等既有 API 面,Phase 3 全部组件重写)。

**采用**:`projectStore` 顶层字段(past/present/future/activeKey/checkedKeys/pfds)
**就是**活动项目——形状与今天逐位相同;非活动项目"停放"在新增注册表里:

```ts
export interface ProjectIdentity {
  savedId: string           // '' = 未存档
  projectUuid: string       // '' = 未绑定版本库
  lastVersionHash?: string  // D-P5-4 乐观并发基线(随项目切换!)
  displayName: string
}
interface ParkedSlot {
  past: ProjectDoc[]; present: ProjectDoc; future: ProjectDoc[]
  activeKey: string; checkedKeys: Record<string, boolean>
  pfds: Record<string, Record<string, number>>
  identity: ProjectIdentity
}
// 顶层新增:
identity: ProjectIdentity                 // 活动项目身份
workspaceId: string                       // 活动槽稳定 id('draft:1' 或后续 open 传入)
parked: Record<string, ParkedSlot>        // 停放槽
openOrder: string[]                       // 打开顺序(树显示用;含活动)
```

不变量:**任一时刻每个项目的文档只存在于一处**(活动 → 顶层;非活动 → parked)。
切换 = `park(当前顶层 → parked[wid])` + `unpark(parked[目标] → 顶层)`,O(1) 指针搬运,
undo 历史/pfds 缓存/身份随槽整体迁移——**隔离是结构给的,不是纪律给的**。

### 1.2 新动作(公开 API 只增不改)

- `setIdentity(patch)` — 存档/读档后写身份(savedId/projectUuid/lastVersionHash)。
- `openProject(wid, init)` — init={etas, activeKey, checkedKeys, userFts, identity}。
  若 wid 或 identity.savedId 已在打开集(活动或停放)→ **仅聚焦**(switch,绝不重载——
  保护未保存编辑);否则停放当前、载入新槽、入 openOrder。
- `switchProject(wid)` — park + unpark;wid 不存在则 no-op。
- `closeProject(wid)` — 移出;若关的是活动槽:切到 openOrder 下一个,一个不剩则重置为新草稿。
- 选择器 `selectOpenProjects(s)` → [{workspaceId, identity, isActive}](R3 树消费)。
- `load()` 语义不变 = 替换**活动槽**内容(bootstrap/导入沿用)。

workspaceId 稳定性:草稿 = 'draft:'+自增计数(不用 Date/random);读档打开 = savedId。
草稿保存后 workspaceId 不变,identity.savedId 绑定即可(openProject 的去重按两个键都查)。

### 1.3 useProjectPersistence 改造

savedId/projectUuid/lastVersionHash 三个 useState **删除**,改读写 store.identity
(hook 返回面不变:`persistence.savedId` 等照旧)。`loadProject(id)`:目标已打开 →
`switchProject`(不 fetch,不覆盖编辑);未打开 → fetch → `openProject`。
saved 列表/conflict/sessionDraft 维持 hook 级(conflict 瞬态;sessionDraft 单槽全局,文档注明)。

### 1.4 R2 验收

- 新测试:双槽 undo 隔离(A 编辑→开 B 编辑→切回 A:present/canUndo 原样;A undo 不动 B)、
  pfds 隔离、同 savedId 重复打开只聚焦且编辑保留、close 活动槽回退语义、身份随槽迁移、openOrder。
- **既有 246 fe 测试逐位绿**(API 面未破的硬证明);tsc;bundle。

## 2 · R3 壳替换(Opus)

- `App.tsx`:AppShell 的 chrome 部分重写——`<MenuBar/>`(文件/编辑/模型/分析/数据/评审/报告/帮助;
  菜单项 = 既有命令的重新挂载:文件→保存/另存/导入导出,编辑→undo/redo,分析→量化/不确定性/
  重要度/分析设置,评审→送审/签发,帮助→⌘K)+ `<ExplorerTree/>` + `<StatusBar/>`。
  ribbon 由各页自带(现 EtaWorkbench/FtaWorkbench 工具栏改皮为 ribbon 风)。
- `ExplorerTree`(features/shell/):数据 = `selectOpenProjects`(打开集,带身份+评审徽章)
  ⊕ `listProjects()`(未打开的库存项目,点击→persistence.loadProject);节点:项目 →
  {项目总览, 事件树(n)>ETA 项(⚡FT 标记), 故障树(n), 参数库/CCF, 后果, FMEA, 报告};
  全局组:多项目组合总览、参考库。点击页节点 = `viewStore.setTab`(tab 枚举增 'portfolio')
  + 需要时 switchProject。评审徽章数据:R5 的 /api/portfolio;R3 先留槽(显示 savedId 有无)。
- viewStore:`MainTab` += 'portfolio';drawerOpen/paletteOpen 保留(⌘K 命令板不动)。
- 状态栏:引擎在线/py 计数移除(假数据),保留:活动项目名+版本哈希8+案例钉扎信息(persistence)。
- 验收:8 页全部可达且功能等价;auth 门测试绿;App.aiDraftVisibility 4 测绿(选择器兼容层的证明)。

## 3 · R4 逐页迁移(sonnet · frontend-dev;每页一提交)

通则:页 = `<div class="page">`(ribbon 行 + 主区 grid[1fr,290px] + 折叠底表);
样式常量迁 theme.css 新 token(--exp-* 前缀,老 --psa-* 保留供未迁页用)。

- **eta**:EtCanvas 加缩放/平移——`viewBox` 变换封装 `useCanvasZoom(scale 0.4–2.5,
  wheel=zoom(以指针为焦点),背景 drag=pan,双击/⤢=fit(内容 bbox+8% 边距),
  工具组 ⊖ pct ⊕ ⤢ 右上角);序列表折叠底部(默认 96px,⌃ 展开,状态进 viewStore);
  检视器 = 现 EtInspector 换皮(初始事件三源单选/屏障列表/溯源块全保留)。
- **fta**:reactflow 自带缩放/平移/minimap——开启 `minimap` + `fitView` 即可;
  割集/结果面板折叠底部;AnalysisSettingsPanel 入 ribbon「⚙ 分析设置」弹出;
  频率初因树模式(⚡按钮/量纲选择器)原样。
- **params/library/cons/fmea**:现组件(ParamLibrary/ReferenceLibrary/ConsequencesTab/
  FmeaWorkbench)套页框架换皮;ag-grid 主题变量对齐浅色基调;每个按钮/编辑器留存。
- **report**:ReportDossier 换皮;送审/签发/退回移入 ribbon(处理器不变);台账/对比/评论/页脚全保留。
- 每页验收:该页 vitest 绿 + preview 点检(控件清单逐项)。

## 4 · R5 组合总览 + 收口(Opus)

- **数字来源 = 已钉扎案例,不是现算**(证据链正确性):`GET /api/portfolio` →
  `[{uuid, name, versions, latest_hash, review_state, latest_case: {id, kind,
  consequences, version_hash, created_at} | null}]`——review_state 取该项目 reviews 最新行;
  latest_case 取 analysis_cases 最新 report/uncertainty 行的 results_json.consequences。
  无案例项目显示「未量化」,绝不静默现算。
- 页面:项目表(≥III 累计 = ΣC3..C5?否——直接展示 consequences 各级与 C5;≥III 累计定义
  沿用报告口径 ΣIII+IV 映射,注明"取自案例 #n·版本 xxxxxxxx")+ 对比条形 + 组合矩阵
  (各项目最劣格标记)+ 评审队列(in_review 项目 → 直达其报告页)。
- **domain-reviewer(fable)轻扫**:跨项目聚合声明的方法学口径(组合矩阵/最劣格/
  "取自钉扎案例"标注是否足以防误读)。
- 收口:bundle、ROADMAP、必要时 memory。

## 5 · 风险与回退

- R2 是唯一高风险批:任何隔离缺陷 = 跨项目数据串染(溯源违规级)。锁测优先于功能。
- 渐进可回退:R2 落地后旧壳照常工作(API 面未变)——R3 前随时可停;R4 每页独立。
- 已知不做:项目间拖拽复制 ETA、双项目并排视图(记 ROADMAP 候选)。
