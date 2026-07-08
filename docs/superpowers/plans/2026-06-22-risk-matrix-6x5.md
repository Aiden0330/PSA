# 风险矩阵改 6×5 安全矩阵 + ETA 侧栏精简 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 多 ETA 风险矩阵改为对齐参考的 6×5 中电联安全矩阵(6 频率档×5 严重度 + A/B/C 子等级);ETA 编辑器侧栏移除后果频率与风险矩阵两节。

**Architecture:** 纯前端。`riskmatrix.ts`/`RiskMatrix.tsx` 重写为 6×5(`RiskMatrix` 保持 `{totals}` 接口,`MultiEtaAggregate` 不变);`EventTreeEditor` 删两节并精简深化分析为只重要度。

**Tech Stack:** React + TypeScript。后端无改动。

**验证:** `npm run build --prefix frontend`;预览(用户自有 :8000 占用时,临时加 8010 launch 配置起预览验证后还原)+ `preview_eval`。提交结尾 `Co-Authored-By: Claude Opus 4.8`。

---

## Task 1: 6×5 安全矩阵(`riskmatrix.ts` + `RiskMatrix.tsx`)

**Files:** Rewrite `frontend/src/riskmatrix.ts`, `frontend/src/components/RiskMatrix.tsx`

- [ ] **Step 1: 重写 `frontend/src/riskmatrix.ts`**(整文件替换)

```ts
// 中电联「安全矩阵」(对齐 D:/ETA_claude DEFAULT_MATRIX): 6 频率档 × 5 严重度, 单元 A/B/C 子等级。
export const FREQ_BANDS: { label: string; gt: number | null }[] = [
  { label: '频发', gt: 1e-2 },
  { label: '经常', gt: 1e-3 },
  { label: '偶尔', gt: 1e-4 },
  { label: '罕见', gt: 1e-5 },
  { label: '极少', gt: 1e-6 },
  { label: '几乎不可能', gt: null },
]
export const SEVERITY_LABELS = ['无事故(0)', '部件级碳化(I)', 'Pack起火(II)', '箱级起火(III)', '电站起火(IV)']
export const CELLS: string[][] = [
  ['C1', 'B3', 'A1', 'A2', 'A3'],
  ['C1', 'B2', 'B3', 'A1', 'A2'],
  ['C1', 'B1', 'B2', 'B3', 'A1'],
  ['C1', 'C3', 'B1', 'B2', 'B3'],
  ['C1', 'C2', 'C3', 'B1', 'B2'],
  ['C1', 'C1', 'C2', 'C3', 'B1'],
]
export type Zone = 'A' | 'B' | 'C'
export const ZONE_COLORS: Record<Zone, string> = { A: '#ef9a9a', B: '#ffcc80', C: '#a5d6a7' }
export const ZONE_LABEL: Record<Zone, string> = { A: 'A 不可接受', B: 'B 风险缓解', C: 'C 可接受' }
// 我的后果类 → 参考严重度级(1-based; 1=无事故 不用)
export const C_TO_LEVEL: Record<string, number> = { C1: 2, C2: 3, C3: 4, C4: 5, C5: 5 }

/** 频率落档(1-based): 首个 gt!==null 且 f>gt 的档; 否则末档(几乎不可能)。 */
export function freqBandOf(f: number): number {
  for (let i = 0; i < FREQ_BANDS.length; i++) {
    const gt = FREQ_BANDS[i].gt
    if (gt !== null && f > gt) return i + 1
  }
  return FREQ_BANDS.length
}
export function zoneOf(cell: string): Zone {
  return cell[0] as Zone
}
```

- [ ] **Step 2: 重写 `frontend/src/components/RiskMatrix.tsx`**(整文件替换;保持 `{ totals }` 接口)

```tsx
import type { CSSProperties } from 'react'
import { FREQ_BANDS, SEVERITY_LABELS, CELLS, ZONE_COLORS, ZONE_LABEL, C_TO_LEVEL, freqBandOf, zoneOf } from '../riskmatrix'
import type { Zone } from '../riskmatrix'

const th: CSSProperties = { padding: '3px 5px', fontSize: 10, color: '#475569', border: '1px solid #e2e8f0', background: '#f8fafc' }

export function RiskMatrix({ totals }: { totals: Record<string, number> }) {
  const levelFreq: number[] = [0, 0, 0, 0, 0, 0]   // 索引 1..5
  for (const [c, lvl] of Object.entries(C_TO_LEVEL)) levelFreq[lvl] += totals[c] || 0
  const placedBand: (number | null)[] = [null, null, null, null, null, null]
  for (let lvl = 1; lvl <= 5; lvl++) placedBand[lvl] = levelFreq[lvl] > 0 ? freqBandOf(levelFreq[lvl]) : null
  const activeZones: Zone[] = []
  for (let lvl = 1; lvl <= 5; lvl++) if (placedBand[lvl]) activeZones.push(zoneOf(CELLS[placedBand[lvl]! - 1][lvl - 1]))
  const overall: Zone | null = activeZones.includes('A') ? 'A' : activeZones.includes('B') ? 'B' : activeZones.length ? 'C' : null

  return (
    <div>
      <table style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={th}>频率＼严重度</th>
            {SEVERITY_LABELS.map((s) => <th key={s} style={th}>{s}</th>)}
          </tr>
        </thead>
        <tbody>
          {FREQ_BANDS.map((fb, ri) => (
            <tr key={ri}>
              <th style={th}>{fb.label}</th>
              {SEVERITY_LABELS.map((_, ci) => {
                const cell = CELLS[ri][ci]
                const z = zoneOf(cell)
                const here = placedBand[ci + 1] === ri + 1
                return (
                  <td key={ci} title={ZONE_LABEL[z]} style={{
                    width: 92, height: 34, border: '1px solid #e2e8f0', textAlign: 'center',
                    background: ZONE_COLORS[z], opacity: here ? 1 : 0.4,
                    fontSize: 10, fontWeight: here ? 800 : 500, color: '#0f172a',
                    outline: here ? '2px solid #0f172a' : 'none',
                  }}>
                    {here ? `${cell} · ${levelFreq[ci + 1].toExponential(1)}` : cell}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 11, marginTop: 6, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {(['A', 'B', 'C'] as Zone[]).map((z) => (
          <span key={z}><span style={{ display: 'inline-block', width: 12, height: 12, background: ZONE_COLORS[z], border: '1px solid #94a3b8', verticalAlign: 'middle' }} /> {ZONE_LABEL[z]}</span>
        ))}
        {overall && <b>最终评价:{ZONE_LABEL[overall]}</b>}
      </div>
      <div style={{ fontSize: 10, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', padding: 6, borderRadius: 6, marginTop: 6, maxWidth: 540 }}>
        ⚠ 6×5 安全矩阵(对齐中电联体系)频率档与子等级为示意默认,须按项目/法规校核。后果映射:C1→I、C2→II、C3→III、C4/C5→IV(无事故级不用)。
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 构建** — `npm run build --prefix frontend`。预期通过(EventTreeEditor 仍用 `<RiskMatrix totals=.../>`,接口未变,编译 OK)。若 TS 报旧导出缺失(EventTreeEditor 仍 import 旧的 `riskmatrix` 符号?——经查 EventTreeEditor 不直接 import riskmatrix,只用 RiskMatrix 组件),则在 Task 2 一并清理。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/riskmatrix.ts frontend/src/components/RiskMatrix.tsx
git commit -m "feat(frontend): 风险矩阵改 6×5 中电联安全矩阵(6频率档×5严重度+A/B/C子等级)"
```

## Task 2: ETA 编辑器侧栏精简(`EventTreeEditor.tsx`)

**Files:** Modify `frontend/src/components/EventTreeEditor.tsx`

- [ ] **Step 1: 读文件确认当前结构** — `Read frontend/src/components/EventTreeEditor.tsx`,定位:imports、状态(`engineSeq/engineCons/unc/imp/impC/...`)、`onEngineQuantify`、`onDeepen`、「后果频率」`<h4>` + `EChart` + 带表块、「风险矩阵」`<h4>` + `<RiskMatrix>` 块。

- [ ] **Step 2: 删两节 JSX** — 删除「后果频率(每站每年)」整节(`<h4>…后果频率…</h4>` + `<EChart …/>` + 其后 `{unc && (…带表…)}`)与「风险矩阵」整节(`<h4>…风险矩阵…</h4>` + `<RiskMatrix totals={totals} />`)。保留其后的「屏障重要度 FV/RAW」节。

- [ ] **Step 3: 精简 `onDeepen` 为只重要度**

```tsx
const onDeepen = async () => {
  setDeepBusy(true); setQErr(null)
  try {
    const imp0 = await importanceEventTree(toEngineRequest(model, linked))
    setImp(imp0.importance)
  } catch (e: any) { setQErr(String(e?.message ?? e)) }
  finally { setDeepBusy(false) }
}
```
按钮文案改 `{deepBusy ? '分析中…' : '📊 屏障重要度分析(FV/RAW)'}`。

- [ ] **Step 4: 清理状态与 import**
  - 删状态:`unc`/`setUnc`、`engineCons`/`setEngineCons`。
  - `onEngineQuantify`:仅 `setEngineSeq(res.sequences)`(删 `setEngineCons`)。
  - 模型变化的 `useEffect`:`setEngineSeq(null); setQErr(null); setImp(null)`(删 `setEngineCons(null)`、`setUnc(null)`)。
  - 删 import:`EChart`、`RiskMatrix`、`uncertaintyEventTree`、`consequenceTotals`(从 `../eventtree` 的解构里去掉 `consequenceTotals`)。
  - 删 `const totals = …`(已无消费者)。
  - 保留:`engineSeq`(叶 ▶ 值)、`imp`/`impC`、`quantifyEventTree`/`importanceEventTree`、`toEngineRequest`、`svgToPng`/导出、`BarrierFtModal`、`CONSEQUENCES`(重要度后果选择器仍用)。

- [ ] **Step 5: 构建** — `npm run build --prefix frontend` 通过(修任何遗留未用符号 TS 报错)。

- [ ] **Step 6: 预览验证**
  - 若 `preview_start bess-app` 报端口占用(用户自有 :8000):临时在 `.claude/launch.json` 加 `bess-app-verify`(--port 8010)→ `preview_start bess-app-verify`。
  - `preview_eval`:
    - ETA 标签选中某分支节点 → 右栏**无**「后果频率」「风险矩阵」;有 引擎精确量化、屏障重要度按钮/表、导出。
    - 展开「多 ETA 汇总」勾选 ≥1 场景 → 风险矩阵为 **6 行×5 列**,行首 6 档(频发…几乎不可能),表头 5 严重度;格 A/B/C 着色;落档高亮 + 子等级;最终评价行。
  - 验证后 `preview_stop` 验证服务器并**还原 launch.json**(删 bess-app-verify)。

- [ ] **Step 7: 提交**

```bash
git add frontend/src/components/EventTreeEditor.tsx
git commit -m "feat(frontend): ETA 编辑器侧栏移除后果频率/风险矩阵, 深化分析精简为重要度"
```

## 收尾

- [ ] `npm run build --prefix frontend` 通过;后端 `pytest -q` 未受影响(≥135,不必重跑但可确认)。
- [ ] 预览端到端(侧栏精简 + 6×5 矩阵);还原任何临时 launch 配置。
- [ ] 更新 `docs/superpowers/ROADMAP.md`(风险矩阵改 6×5 安全矩阵;ETA 侧栏精简)。

## 自检(plan vs spec)

- spec 2.1 侧栏精简 → Task 2。
- spec 2.2 6×5 安全矩阵 → Task 1(riskmatrix.ts + RiskMatrix.tsx,保持 totals 接口)。
- 类型一致:`FREQ_BANDS/SEVERITY_LABELS/CELLS/ZONE_COLORS/ZONE_LABEL/C_TO_LEVEL/freqBandOf/zoneOf/Zone` 在 riskmatrix.ts 定义、RiskMatrix.tsx 消费一致;`RiskMatrix` 仍 `{totals}`,MultiEtaAggregate 不改。
- 旧 riskmatrix 导出(SEVERITY_ASC/SEV_RANK/freqBandIndex/riskLevel/RISK_COLOR)删除;仅 RiskMatrix.tsx 曾用 → 重写后不再引用。report_export.py 是 Python 独立,不受影响。
- 坑:验证用临时 8010 预览(用户占 8000),验证后还原 launch.json;改后端才需重启,本次纯前端,用户 :8000 刷新即生效。
