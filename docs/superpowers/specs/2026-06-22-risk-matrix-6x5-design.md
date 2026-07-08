# 风险矩阵改 6×5 安全矩阵 + ETA 侧栏精简 — 设计文档

- 日期:2026-06-22 · 分支 `feat/risk-matrix-6x5`
- 状态:**设计已认可(用户「继续风险矩阵」),待 spec 复核**
- 方法:纯前端;build + `preview_eval`(无后端改动)。

## 0. 目标

1. **ETA 编辑器侧栏精简**:`EventTreeEditor` 右栏移除「后果频率(每站每年)」(条形图 + 不确定性带表)与「风险矩阵」两节。
2. **多 ETA 风险矩阵对齐参考 6×5 安全矩阵**:重写为 ETA_claude 的中电联「安全矩阵」(6 频率档 × 5 严重度 + A/B/C 区域子等级)。

## 1. 现状关键事实

- `EventTreeEditor` 右栏含:引擎精确量化按钮(叶上 ▶ 值,用 `engineSeq`)、深化分析(`unc`+`imp`)、导出报告/图、功能事件、选中节点、**后果频率**(`EChart` 条形 + `unc` 带表/误差棒,用 `totals=engineCons??consequenceTotals(model)`)、**风险矩阵**(`<RiskMatrix totals={totals}/>`)、屏障 FV/RAW 重要度表(`imp`)。
- `RiskMatrix`(`components/RiskMatrix.tsx`)+ `riskmatrix.ts`(当前 5 频率带 × C1–C5,乘式 low/med/high/extreme + 配色)。**仅被** `EventTreeEditor`(将移除)与 `MultiEtaAggregate` 使用。
- `MultiEtaAggregate` 传 `totals:{Cx:freq}` 给 `RiskMatrix`。
- 参考 `D:/ETA_claude/eta-tool/src/core/riskMatrix.ts` 的 `DEFAULT_MATRIX`(见 §2.2)。
- 后端报告(`report_export.py`)内有独立的 Python 风险矩阵 —— **本次不动**。

## 2. 设计

### 2.1 ETA 侧栏精简(`EventTreeEditor.tsx`)

- 删除「后果频率」节(EChart 条形 + 不确定性带表 + 误差棒)与「风险矩阵」节。
- 「深化分析」简化为**仅重要度**:去掉不确定性请求与 `unc` 状态(`uncertaintyEventTree` 调用 + 带表随后果频率一并移除);保留 FV/RAW 重要度表(`imp`)。
- 保留:引擎精确量化(叶 ▶ 值,`engineSeq`)、功能事件、选中节点、导出报告/图。
- 清理空出的引用:`EChart`、`RiskMatrix`、`uncertaintyEventTree`、`consequenceTotals` 的 import,以及 `engineCons`/`totals`/`unc` 状态与 `setEngineCons`。`onEngineQuantify` 仅保留 `setEngineSeq`。

### 2.2 多 ETA 6×5 安全矩阵(`riskmatrix.ts` + `RiskMatrix.tsx`)

移植参考 `DEFAULT_MATRIX`(`riskmatrix.ts` 重写,旧 5×5 定义/配色删除):
```ts
export const FREQ_BANDS = [   // 行, 上(高频)→下; gt=下界开区间, 末档 null 兜底
  { label: '频发', gt: 1e-2 }, { label: '经常', gt: 1e-3 }, { label: '偶尔', gt: 1e-4 },
  { label: '罕见', gt: 1e-5 }, { label: '极少', gt: 1e-6 }, { label: '几乎不可能', gt: null },
]
export const SEVERITY_LABELS = ['无事故(0)', '部件级碳化(I)', 'Pack起火(II)', '箱级起火(III)', '电站起火(IV)']
export const CELLS = [
  ['C1','B3','A1','A2','A3'], ['C1','B2','B3','A1','A2'], ['C1','B1','B2','B3','A1'],
  ['C1','C3','B1','B2','B3'], ['C1','C2','C3','B1','B2'], ['C1','C1','C2','C3','B1'],
]
export const ZONE_COLORS = { A: '#ef9a9a', B: '#ffcc80', C: '#a5d6a7' }
export const ZONE_LABEL = { A: 'A 不可接受', B: 'B 风险缓解', C: 'C 可接受' }
export function freqBandOf(f): number   // 1-based: 首个 gt!==null && f>gt → i+1; 否则 6
export function zoneOf(cell): 'A'|'B'|'C'  // cell[0]
// 我的 C1–C5 → 参考严重度级(1-based;1=无事故 不用):
export const C_TO_LEVEL = { C1: 2, C2: 3, C3: 4, C4: 5, C5: 5 }   // C4,C5 合并到"电站起火"
```

`RiskMatrix.tsx`(保持 `{ totals: Record<string, number> }` 接口,`MultiEtaAggregate` 不变):
- 由 `totals` 求**每严重度级频率** `levelFreq[L]= Σ totals[Cx](C_TO_LEVEL[Cx]===L)`;即 L2=tot.C1、L3=tot.C2、L4=tot.C3、L5=tot.C4+tot.C5、L1=0。
- 渲染 6 行(频发→几乎不可能)× 5 列(严重度标签)。每格底色 = `ZONE_COLORS[zoneOf(CELLS[row][col])]`(淡),格内显子等级文字。
- 每严重度列若 `levelFreq[L]>0`:其落档行 = `freqBandOf(levelFreq[L])`,把该 (band, col) 格**高亮**(描边 + 显频率值 + 子等级加粗)。
- 底部:A/B/C 图例 + **最终评价**(任一高亮格 A 区→A 级不可接受;否则 B→B 级;否则 C→C 级;无高亮则不显)。
- 「示意默认值须校核」声明保留。

### 2.3 不动

- `MultiEtaAggregate.tsx`(仍传 `totals`)、后端、`report_export.py` 的矩阵。

## 3. 文件改动

**修改**:`frontend/src/riskmatrix.ts`(重写为 6×5)、`frontend/src/components/RiskMatrix.tsx`(重写渲染)、`frontend/src/components/EventTreeEditor.tsx`(删两节 + 精简深化分析 + 清 import)。

## 4. 构建顺序与验收

| # | 部分 | 验收(build + `preview_eval`) |
|---|---|---|
| 1 | 侧栏精简 | ETA 选中节点侧栏无「后果频率」「风险矩阵」;引擎量化 ▶ 值、重要度表、导出仍在;无 TS 报错 |
| 2 | 6×5 安全矩阵 | 多 ETA 汇总面板:矩阵 6 行×5 列;表头 5 严重度 + 行首 6 频率档;格按 A/B/C 着色;勾选场景后对应列频率落档高亮 + 子等级;最终评价行 |

全量:`pytest -q`(后端未改, ≥135);`npm run build --prefix frontend` 通过。

## 5. 取默认值 / 风险

- C1–C5→严重度:C1→I、C2→II、C3→III、C4→IV、C5→IV(L1 无事故留空,C4+C5 合并 L5)——用户选「完全用参考标签」。
- `RiskMatrix` 接口不变(`totals`),故 `MultiEtaAggregate` 零改动;`RiskMatrix` 改后仅此一处消费。
- `riskmatrix.ts` 旧导出(`SEVERITY_ASC/SEV_RANK/freqBandIndex/riskLevel/RISK_COLOR`)删除;确认无其他 import(仅 RiskMatrix 用)。
- 后端报告矩阵是另一套(Python),本次不统一。
- 纯前端;用户自有 :8000 服务器静态托管 dist,build 后刷新即生效(改后端才需重启,本次不涉及)。
