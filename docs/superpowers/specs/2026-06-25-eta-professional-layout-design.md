# ETA 工作台布局对齐 + 矩阵填空 — 设计文档

- 日期:2026-06-25 · 分支 `feat/eta-barrier-reorder-cn-names`(沿用;若先 merge 前批可改新分支)
- 状态:已确认(brainstorm + 可视化 mockup,用户批准方向「布局对齐 + 矩阵填空」),待 spec 复核 → writing-plans
- 方法:纯前端布局/视觉(React + TS,vitest);多 agent 执行(frontend-dev / test-runner / code-reviewer)
- 交付:重建离线单文件 `bess-eta-standalone.html`

## 0. 目标(用户 2 条痛点)

1. **矩阵板块空白较多** → 风险矩阵约 600px 宽,却独占 `flex:1`(~1240px)面板,右侧约 600px 死白。在矩阵右侧并排一张**风险摘要卡**填充,把空白变成有用信息。
2. **整体页面上下宽度未对齐** → 各行右侧列宽参差(末态序列表 300 / ETA 清单 330 / 检视器 356)。引入**统一列网格**:工作区每行共用 `[主区 1fr | 右栏 SIDE_W]`,使上下右栏同宽对齐;检视器为一致的全高右轨。

范围:**暂不修改界面风格**——仅做布局对齐 + 矩阵填空两项。保留现有深色顶栏 + 浅色工作区配色、字体、面板 chrome 原样;**不改**数据模型 / 引擎 / 后端 / SSOT 状态;`RiskMatrix` 组件本身不动。新增的风险摘要卡复用现有卡片/面板样式,不引入新风格语言。

## 1. 现状关键事实(已核对源码 + 实测布局)

- `frontend/src/components/EventTreeEditor.tsx`(ETA 主视图,~668 行):
  - 顶层:`<div flex gap12>` = **工作区(flex1 列)** + **检视器 `<aside>` 356px 全高**(L360)。
  - 工作区列(L153-357):① KPI 条 4 卡(L156-166,整行);② 树面板 `section flex:'5 1 0'`(L169),内 `flex` = **画布(flex1)+ 末态序列表 `width:300`**(L272);③ 底部坞 `flex:'3 1 0'`(L312),内 = **风险矩阵 `section flex:1`(含 `RiskMatrix`)+ 参与汇总 `section width:330`**(L321)。
  - 复用样式常量:`panel`(L26)、`phead`(L27,高 40)、`accent`、`kpiCard`(L25)。
  - 实测(运行态):treeSection w≈1578、底部 checkSection w330、inspector w356 → 右缘 300/330/356 三档参差;矩阵 `section`(flex1)≈1240 宽而 `RiskMatrix` 表 ≈600 → 右侧大片空白。
- `frontend/src/components/RiskMatrix.tsx`:`RiskMatrix({totals})` 渲染 6×5 矩阵 + A/B/C 图例 + 免责;用 `riskmatrix.ts` 的 `FREQ_BANDS/SEVERITY_LABELS/CELLS/ZONE_COLORS/ZONE_LABEL/C_TO_LEVEL/freqBandOf/zoneOf`。**不改本组件**。
- `frontend/src/riskmatrix.ts`:含上述纯逻辑(后果→严重度列、频率档、区域)。新摘要纯函数加在此处复用既有逻辑。
- 多 ETA 汇总频率 `aggregateTotals`(由 App 传入)/ `consequenceTotals(model)`(回退)已在 EventTreeEditor 计算(L146-148)。

## 2. 设计

### 2.1 统一列网格(对齐)

- 新增布局常量(EventTreeEditor 顶部 `CSSProperties` 区):`const SIDE_W = 300`(工作区右栏统一宽);检视器维持 356(`RAIL_W`,独立右轨,已一致)。
- **末态序列表**(L272 `width:300`)→ `width: SIDE_W`。
- **参与汇总 ETA `section`**(L321 `width:330`)→ `width: SIDE_W`。
- 两行主区均 `flex:1`(画布 ↔ 矩阵区)天然等宽;右栏同为 `SIDE_W` → **上下右缘对齐**。KPI 条已整行,无需改。
- 结果:工作区内右栏一条直线对齐,检视器一条全高右轨,消除参差。

### 2.2 风险摘要卡(矩阵填空)

- 底部坞「风险矩阵」`section`(flex1)内容由「仅 `RiskMatrix`」改为 **`flex` 行:`[RiskMatrix(内容宽) | RiskSummary(flex1)]`**,中间一条 `0.5px dashed` 分隔。矩阵保持原状靠左,摘要卡占满右侧原空白。
- 新组件 `frontend/src/components/RiskSummary.tsx`:`RiskSummary({ totals, etaCount, importance? })`,展示(全部来自已算客户端数据):
  - **最终分区评价** A/B/C(用 `riskSummary().overall`,色块 + 文字「需立即处置/需控制/可接受」);
  - **各区计数** A/B/C(落入各区的严重度列数);
  - **最严重后果 + 频率**(worstC/worstFreq)、**≥C4 累计**(severe);
  - **最弱屏障(可选)**:仅当 `importance` 已由引擎算出时显示其 FV 最高项,否则省略(不强依赖引擎)。
  - **样式复用**:摘要卡用现有卡片/面板 token(`kpiCard`/`panel`/`C_COLOR`/灰阶),与当前界面风格一致,不引入新配色或新组件样式。
- 新纯函数 `frontend/src/riskmatrix.ts::riskSummary(totals)`(可单测):
  ```ts
  export interface RiskSummary { overall: Zone | null; zoneCounts: Record<Zone, number>; worstC: string | null; worstFreq: number; severe: number }
  export function riskSummary(totals: Record<string, number>): RiskSummary
  ```
  复用现有 `C_TO_LEVEL/freqBandOf/zoneOf/CELLS` 逻辑(与 `RiskMatrix` 同口径):按严重度列汇频率 → 落频率档 → 取区域;`overall` = 有 A→A,否则有 B→B,否则有 C→C,否则 null;`severe`= (C4+C5) 累计;`worstC`= 有频率的最严重后果级。

> 注:本轮**不做**面板 chrome 一致化/视觉重样(用户:暂不修改界面风格)。仅 2.1 对齐 + 2.2 填空。

## 3. 跨切面 / 兼容

- 纯布局/展示:不改 `EventTreeModel`、引擎请求、后端、序列化、SSOT 状态;`RiskMatrix` 组件签名不变。
- `RiskSummary` 只读 `totals`(及可选 `importance`),无副作用。
- 离线单文件不受影响(无后端依赖);响应式:主区 `flex` + `minWidth:0` 防溢出,窄屏时摘要卡可换行(`flex-wrap`)。

## 4. 测试策略

- **vitest `riskmatrix.ts`**:`riskSummary` —— 空 totals → overall null/severe 0;仅 C1 → C 区、worstC C1;含 C5 高频 → overall A 或 B(按档)、severe 含 C4+C5;zoneCounts 与 `RiskMatrix` 落格一致(同 totals 下 overall 与矩阵高亮区一致)。
- **组件/集成(preview DOM)**:① 末态序列表与 ETA 清单右缘 X 坐标相等(对齐);② 矩阵 `section` 内摘要卡存在且矩阵右侧无大块空白(摘要卡宽 > 0);③ 摘要卡显示分区评价/≥C4。
- **回归**:`npm run test --prefix frontend` 全绿;`npm run build --prefix frontend`(`tsc -b && vite build`)干净;`.venv/Scripts/python.exe -m pytest -q` 无后端回归。

## 5. 范围 / 默认(已确认)

- **仅布局对齐 + 矩阵填空两项**;**暂不修改界面风格**(不做 chrome 一致化/视觉重样)。保留现有配色 / 顶栏 / 字体 / 面板样式。
- `SIDE_W=300`(统一右栏);检视器 356 不变。
- 风险摘要卡复用现有卡片样式;仅用客户端已算数据;最弱屏障 FV 仅在引擎重要度已存在时显示。

## 6. 构建顺序(供 writing-plans)

1. `riskmatrix.ts`:`riskSummary` 纯函数 + vitest(先红后绿)。
2. `RiskSummary.tsx`:新组件(消费 `riskSummary`)。
3. `EventTreeEditor.tsx`:① `SIDE_W` 常量 + 末态表/ETA 清单统一宽(对齐);② 风险矩阵 `section` 内 `[RiskMatrix | RiskSummary]`。(本轮不做 chrome 微调)
4. 回归 + `npm run bundle` 重建单 HTML + ROADMAP 记录。
