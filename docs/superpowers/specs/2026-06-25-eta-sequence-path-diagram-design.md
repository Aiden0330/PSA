# ETA 事故序列路径图(底部区域) — 设计文档

- 日期:2026-06-25 · 分支 `feat/fta-standalone-and-quantify`(与 FTA 自建+量化同批)
- 状态:已确认(brainstorm:2 项澄清 + mockup,用户批准设计),待 spec 复核 → writing-plans
- 方法:纯前端展示(React + TS);多 agent 执行(frontend-dev / code-reviewer)
- 交付:重建离线单文件 `bess-eta-standalone.html`

## 0. 目标(用户)

在 ETA 工作台**底部区域**新增一块**事故序列路径图**:每条末态序列一行——`序列号 · 初因 →[屏障 ✓成功/✗失败 + 中文名]→ … · 后果分级(0–IV)· 频率`,按频率降序;点行与上方事件树高亮联动。填补改版后底部的空白。**暂不改界面风格**(沿用 `psa-*`),不改数据/引擎。

## 1. 现状关键事实(已核对 main `5d05b22`)

- `frontend/src/components/EventTreeEditor.tsx`:
  - **底部坞**(L286):`<div style={{ flex:'3 1 0', minHeight:220, display:'flex', gap:12, alignItems:'stretch' }}>` = `[风险矩阵 section(flex1,内含 RiskMatrix+RiskSummary) | 参与汇总的 ETA section(width:var(--psa-side-w))]`。**改版已移除独立末态表**(序列改为事件树右侧终端芯片);底部即用户所指"空白处"。
  - 树面板 `flex:'5 1 0'`(L168)。
  - **`seqRows`**(L129-133)已算:`{ i, seq, lf, freq, c(后果id), path: barrierPath(lf.path), diff }`,按叶 DFS(成功优先)序;`barrierPath(path)`(L119)→ `[{ feId, outcome:'success'|'failure' }]`。`sel`/`setSel`/`selKey` 为选中叶路径(L70 区)。
  - 量化结果 tab(L580+)已用 `seqRows` 列序列(纯文字),含 `consGrade(model, r.c)`(L592)——路径图是其**图形化 + 屏障名芯片**版,放底部主面板。
- `frontend/src/eventtree.ts`:`gradeLabel(level)`(C1–C5→0–IV)、`consGrade(m,consId)`、`consLevel`/`consText` 已导出。
- `frontend/src/riskmatrix.ts`:`C_COLOR`(C1–C5→色)已导出(供 EventTreeEditor/RiskSummary 复用)。
- 屏障中文名:`model.functionalEvents.find(f=>f.id===feId)?.label ?? feId`。

## 2. 设计

### 2.1 新组件 `frontend/src/components/SequencePaths.tsx`(纯展示)

```ts
interface SeqRow { i: number; seq: number; lf: { path: string[] }; freq: number; c: string; path: { feId: string; outcome: 'success' | 'failure' }[]; diff?: boolean }
export function SequencePaths(props: {
  rows: SeqRow[]
  model: EventTreeModel
  selKey: string
  onSelect: (path: string[]) => void
}): JSX.Element
```
- 渲染:`[...rows].sort((a,b)=>b.freq-a.freq)`,每行:
  - 序列号方块,底色 `C_COLOR[consLevel(model,row.c)]`;
  - `初因` →(对 `row.path` 每项)一个芯片:屏障名(`functionalEvents` 的 label,截断 + `<title>` 全名)+ `✓`(成功,绿)/`✗`(失败,红);**只显示走过的屏障**(跳过的不画);
  - 末尾:后果分级 `gradeLabel(consLevel(model,row.c))` 徽标(底色 `C_COLOR`)+ 后果文字 `consText` + `{diff?'▶ ':''}{freq.toExponential(2)}/yr`;
  - 整行可点 → `onSelect(row.lf.path)`;`selKey===row.lf.path.join('/')` 时高亮(底色软)。
- 样式复用现有 `psa-*`(`psa-chip` 等)+ `C_COLOR` + mono 字体,**不引入新风格**。空(无序列)显占位文字。

### 2.2 EventTreeEditor 底部坞重排(三栏)

- 底部坞改为三面板,并提高底部高度占比:
  - 树面板 `flex:'5 1 0'` → `flex:'4.5 1 0'`;底部坞 `flex:'3 1 0'` → `flex:'4 1 0'`(给三栏腾高度;`minHeight` 微调)。
  - 底部坞内:`[事故序列路径图 section(flex 1.6,主) | 风险矩阵 section(flex 1,内 RiskMatrix+RiskSummary 不变) | 参与汇总 section(var(--psa-side-w) 不变)]`。
- 路径图 section:`<section className="psa-panel" style={{ flex:'1.6 1 0', minWidth:0 }}>` + `psa-ch` 头(标题「事故序列路径图」+ meta「N 序列·按频率」)+ 滚动体 `<SequencePaths rows={seqRows} model={model} selKey={selKey} onSelect={setSel} />`。
- 触点仅 `EventTreeEditor.tsx`(import + 底部坞 JSX 重排 + 两处 `flex` 值)+ 新 `SequencePaths.tsx`。

## 3. 跨切面 / 兼容

- 纯展示:复用既算 `seqRows`/`barrierPath`/`gradeLabel`/`consLevel`/`consText`/`C_COLOR`,**无新纯函数、不改数据/引擎/后端/序列化**。
- 与事件树高亮**双向联动**(共用 `sel`/`selKey`/`setSel`):点路径行 → 树上对应序列高亮;反之亦然(已有)。
- 引擎精确量化后 `seqRows.freq` 用引擎值(`engineSeq`),路径图自动跟随(同 `diff` 标记 ▶)。
- 响应式:三栏 + `minWidth:0` 防溢出;路径行屏障多时 `flex-wrap` 换行,频率/分级右侧固定块。

## 4. 测试策略

- **组件本身为纯展示**,无新纯函数 → 不单测组件;`seqRows`/`barrierPath`/`gradeLabel` 既有逻辑隐式覆盖。
- **集成(preview DOM)**:① 底部出现「事故序列路径图」面板(三栏布局,无溢出);② 行数=序列数、按频率降序、每行屏障芯片 ✓/✗ + 中文名 + 分级 + 频率;③ 点路径行 → 事件树对应序列高亮(`selKey` 变);④ 引擎量化后频率切换为精确值。
- **回归**:`npm run test --prefix frontend` 全绿(不新增 vitest,但确保不破坏现有 75);`npm run build --prefix frontend` 干净;`pytest -q` 无后端回归。

## 5. 范围 / 默认(已确认)

- 路径图 = **每序列一行**;每行**只显示走过的屏障**(非全部屏障灰显)。
- 位置 = **并入底部区域,改三栏**(路径图作主面板),非替换矩阵/清单。
- 树/底部高度比 `4.5 : 4`(可微调)。纯前端、暂不改界面风格、引擎/数据不变。

## 6. 构建顺序(供 writing-plans)

1. `SequencePaths.tsx`:新组件(消费 `seqRows`/model/selKey/onSelect)。
2. `EventTreeEditor.tsx`:底部坞重排三栏 + 挂载 `SequencePaths` + 调 `flex`(树 4.5 / 底部 4)。
3. 回归 + `npm run bundle` 重建单 HTML + ROADMAP 记录。
