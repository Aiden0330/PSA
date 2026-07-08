# ETA 初始事件列 · 每-ETA 后果内涵 · 成功分支可发现性 · FTA 事件/门分带 — 设计

日期:2026-06-22
状态:已与用户确认设计,待写实施计划

## 背景

用户在 ETA 编辑器截图(`eta.png`)中反馈 5 个问题:

1. **事件序列字体重叠** —— 初始事件名(左上角)与第一屏障列表头(`B_BMS`)文字叠在一起。
2. **成功节点可接到所选屏障(不限下一个)** —— 希望从成功(绿)分支继续到任意更靠后的屏障。
3. **挂载 FTA 的事件节点与门节点要分开** —— 经典 FTA 画法:基本事件排到底部,门在上方分层。
4. **无法修改初始事件失效概率,初始事件未在 ETA 正式展示**。
5. **允许定义 C1–C5 不同的内涵** —— 各 ETA 的后果文字含义不同,但都映射到统一的 C1–C5 bin。

## 目标

- 初始事件成为 ETA 最左侧的正式一列,名称与频率可编辑,消除与首屏障的重叠。
- 成功/失败叶都能继续到任意更靠后屏障(已具备),并提升其可发现性。
- 挂载屏障 FTA 时,基本/房形事件压到画布底部同一带,门保持层级。
- 每个 ETA 各存一套 C1–C5 文字内涵,可编辑、可显示;bin 与下游(汇总/风险矩阵/引擎)保持不变。

## 非目标(明确排除)

- 不改变后果 bin 数量(仍 C1–C5),不改 `C_TO_LEVEL`(C→严重度)映射。
- 不把初始事件改成 0–1 概率语义(仍是频率 /yr,直接喂引擎 `init_frequency`)。
- 引擎契约零改动(`toEngineRequest` 输出结构不变)。
- 不引入后端字段;C1–C5 内涵纯前端存于 ETA 模型并随存档持久化。

## 现状(代码定位)

- 模型层:[frontend/src/eventtree.ts](../../../frontend/src/eventtree.ts)
  - `EventTreeModel { initEvent; initFreq; functionalEvents; root }`
  - `CONSEQUENCES = ['C1'..'C5']` 全局常量;叶仅存裸 `consequence: string`。
  - `subsequentFes` / `branchLeaf` 已支持「选中叶→继续到任意更靠后屏障(可跳过)」(commit `f3cf37f`)。
- ETA 渲染/侧栏:[frontend/src/components/EventTreeEditor.tsx](../../../frontend/src/components/EventTreeEditor.tsx)
  - 常量 `rowH=46, headerH=64, colW=150, LEFT=200`,`colX(d)=LEFT+d*colW`。
  - 初始事件目前是 `x=8` 的浮动文字(名 `y=26` 截断 12 字、频率 `y=42`)+ 从 `x=8` 到 `colX(0)` 的根连线 → 与居中于 `colX(0)=200` 的首屏障表头文字重叠。
  - 屏障表头居中于 `colX(d)`:id `y=22`、label `y=37`、`pf` `y=51`。
  - 叶侧栏已提供「继续到屏障」下拉(`EventTreeEditor.tsx` 选中叶分支)。
- FTA 布局:[frontend/src/layout.ts](../../../frontend/src/layout.ts) —— dagre `rankdir=TB`,门与基本事件按依赖秩混排。
- FTA 节点:[frontend/src/components/nodes.tsx](../../../frontend/src/components/nodes.tsx) —— `gate`/`basic`/`house` 形状已区分。
- 屏障 FTA 模态:[frontend/src/components/BarrierFtModal.tsx](../../../frontend/src/components/BarrierFtModal.tsx) —— 调 `layoutFaultTree(model, ftName)`(当前不传 positions)。
- 跨 ETA 汇总:[frontend/src/components/MultiEtaAggregate.tsx](../../../frontend/src/components/MultiEtaAggregate.tsx) —— 按 `['C1'..'C5']` 求和(必须保持)。
- 风险矩阵:[frontend/src/riskmatrix.ts](../../../frontend/src/riskmatrix.ts) `C_TO_LEVEL`(保持)。
- 装配/持久化:[frontend/src/App.tsx](../../../frontend/src/App.tsx) `loadEt` / `newBlankEta` / `onLoadSaved`(`normalizeEta`)。

## 设计

### 1. 初始事件成为正式最左列 + 可编辑(覆盖 ①、④)

**SVG 显示(EventTreeEditor.tsx)**
- 新增左侧「初始事件」列常量(初值,实现时按实测微调):`IE_X=12`(文字左)、`IE_RIGHT≈180`(列右边界/根线起点)、`LEFT` 提升至 `≈240`(首屏障中心),保证 `IE_RIGHT + 间距 < 首屏障表头文字左缘`,彻底消除重叠。
- 列内三行,尽量与屏障表头对齐:
  - caption「初始事件」(灰,~9px,`y≈14`)
  - 事件名(粗 12px,`y≈30`,过长截断 + `<title>` 全名)
  - 频率 `initFreq.toExponential(2)+'/yr'`(灰 10px,`y≈48`)
- 根连线改为 `x1=IE_RIGHT … x2=colX(0)`(`y=rootY`);并在 `x=IE_RIGHT` 画一条与屏障列同样式的浅色竖向分隔线。

**编辑(右侧栏新增「初始事件」块,置于「功能事件(屏障)」之上)**
- 名称输入:`value=model.initEvent` → `setInitEvent`。
- 频率输入(/yr):文本框,`parseFloat` 解析(接受 `1e-3`),NaN/<0 时忽略;旁注当前 `toExponential`。→ `setInitFreq`。

**模型层新增纯函数(eventtree.ts)**
- `setInitEvent(m, name): EventTreeModel`
- `setInitFreq(m, freq): EventTreeModel`(`Number.isFinite` 且 `>=0` 才改)

引擎/导出无需改:`toEngineRequest` 仍读 `m.initEvent` / `m.initFreq`。

### 2. 成功节点继续到所选屏障 —— 验证 + 修复 + 可发现性(覆盖 ②)

- **先验证**:启动前端,打开 BESS「过充」ETA,点绿色成功叶,确认侧栏「继续到屏障」下拉出现且 `branchLeaf` 渲染正确(含跨跳过列连线)。若有 bug 则修复。代码层面成功/失败叶走同一分支,无已知差异。
- **可发现性增强**:当选中的叶 `subsequentFes(...).length>0` 时,在该叶节点右侧的 **SVG 内**绘制一列小型可点选屏障按钮(显示 `feId — label`),点击即 `branchLeaf(path, feId)`。全部用 SVG 坐标,避免 HTML/SVG 混排。侧栏下拉保留。
  - 退路:若 SVG 内菜单与「叶→后果」虚线/后果块视觉冲突难调,则降级为「选中叶时在侧栏下拉旁加醒目提示 + 自动滚动可见」。

### 3. 挂载 FTA:事件/门分带(覆盖 ③)

改 `layoutFaultTree`([layout.ts](../../../frontend/src/layout.ts)),新增可选参数 `bandLeaves=true`:
- 照常 `dagre.layout(g)` 得到各节点坐标(门据此保留层级)。
- 计算底部带 `bandY = max(门节点 y) + NODE_H + BAND_GAP`(`BAND_GAP≈ranksep`)。
- 收集所有 `basic`+`house` 节点,按 `(父门 x, 自身 dagre x)` 排序,自 `marginx` 起左→右等距铺开(步距 `NODE_W + LEAF_GAP`,`LEAF_GAP≈24`),`y=bandY`,使同父叶聚簇且不重叠。
- 仍尊重 `positions` 手拖覆盖(若传入)。
- `BarrierFtModal` 使用默认(分带开)。若存在主 FTA 视图不宜分带,则在该处显式传 `bandLeaves=false`(实现时确认 `layoutFaultTree` 的全部调用点)。

权衡:高层门→底部带连线变长(经典 FTA 形态,可接受);相较 dagre rank 约束更可控、可预测。

### 4. 每个 ETA 自定义 C1–C5 内涵(覆盖 ⑤)

**模型层(eventtree.ts)**
- 新增 `export const DEFAULT_CONSEQUENCE_DEFS: Record<string,string>`,默认草案(措辞待用户最终确认):
  - `C1='单体安全排气'`、`C2='模组内热蔓延/起火'`、`C3='Pack/簇级起火'`、`C4='箱级起火蔓延'`、`C5='爆炸 + 毒气释放'`
- `EventTreeModel` 增 `consequenceDefs?: Record<string,string>`。
- `consDef(m, c) = m.consequenceDefs?.[c] ?? DEFAULT_CONSEQUENCE_DEFS[c] ?? ''`。
- `setConsequenceDef(m, c, text): EventTreeModel`。
- `normalizeEta`:`consequenceDefs: m.consequenceDefs ?? { ...DEFAULT_CONSEQUENCE_DEFS }`(旧存档补默认)。
- `newBlankEta`:带默认 `consequenceDefs`。

**装配(App.tsx)**
- `loadEt` 构造 base 模型时带默认 `consequenceDefs`(后端暂不提供;后续可扩展)。

**显示/编辑(EventTreeEditor.tsx)**
- 右侧栏新增「后果定义 (C1–C5)」块:5 行 `C{n}` + 文本输入 → `setConsequenceDef`。
- 叶后果下拉 option 文本:`${c} — ${consDef(model,c)}`。
- SVG 后果块加 `<title>{consDef}</title>` 悬浮提示。
- (可选)重要度 `impC` 下拉同样带文字。

**保持不变(关键)**
- `CONSEQUENCES` 仍为 `['C1'..'C5']`;`MultiEtaAggregate` 按 bin 求和、`riskmatrix` C→严重度、引擎 `consequence_bins` 均不受影响 —— 即「内容不同但都映射到 C1–C5」。

**持久化**
- `saveWorkspace` 存 `etModel`(JSON),`consequenceDefs` 自动随存;`loadSaved`→`normalizeEta` 给旧档补默认。

## 数据模型变更汇总

```ts
export interface EventTreeModel {
  initEvent: string
  initFreq: number
  functionalEvents: FuncEvent[]
  root: EtNode
  consequenceDefs?: Record<string, string>   // 新增:C1..C5 → 文字内涵(缺省取 DEFAULT)
}
export const DEFAULT_CONSEQUENCE_DEFS: Record<string, string>  // 新增
// 新增纯函数:setInitEvent / setInitFreq / setConsequenceDef / consDef
```

## 验收标准

- ①/④:打开任一 ETA → 无文字重叠;最左列显示初始事件名+频率;侧栏改名称/频率后 SVG 与「引擎精确量化」结果随之变化;Word/PDF/PNG/SVG 导出仍正常。
- ②:点击绿色成功叶 → 能选择并继续到任一更靠后屏障,渲染正确;引擎量化与前端积式一致(或以引擎为准提示)。
- ③:打开含 ≥2 门、数个基本事件的屏障 FTA → 基本事件对齐于底部同一带、门在上方、无重叠。
- ⑤:编辑 C3 文字 → 叶下拉与悬浮提示显示该文字;`MultiEtaAggregate`/风险矩阵数值不变;保存再载入保留内涵;旧存档载入自动套默认内涵。
- 回归:`tests/` 下引擎子集路径量化契约不受影响(引擎契约未变)。

## 影响面 / 风险

- 像素级布局(①、③)需在真实运行中微调 —— 实现时用 preview 截图核对。
- ② 很可能已可用 —— 先验证,避免重复造轮子;可发现性增强为净增 UX。
- ③ 分带对「多基本事件」会变宽 —— ReactFlow `fitView` 自适应缩放可接受。
- 共享基本事件(被多个门引用)按「首个父门」归位,长交叉连线可接受。

## 范围外

- bin 档数 / C→严重度重映射;初始事件概率语义;后端后果内涵字段;FTA 手拖位置持久化(沿用现状)。
