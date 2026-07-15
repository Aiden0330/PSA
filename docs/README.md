# docs/ 目录地图

> 找"这个数字/行为哪来的"先走:报告页脚 → 分析案例 → 版本哈希 →
> `superpowers/ROADMAP.md` 对应条目 → 当日 spec。

## 当前有效(canonical)

| 位置 | 内容 |
|---|---|
| `BESS-PSA-TD-001-技术文档.html` / `.docx` | **权威手册**(Rev C,2026-07-14):方法基础 / 算法详解 / 工具手册 / 示例 / SOTA 对比 / AI 输入调研。旧 USER_GUIDE 与 ALGORITHM_DESIGN 已被其取代。 |
| `superpowers/ROADMAP.md` | 活文档:分阶段实施台账(含各次评审判定与教训),每次收口追加。 |
| `superpowers/specs/` · `plans/` | 逐特性规格与计划,`YYYY-MM-DD-<slug>`。已完成的规格保留偏离记录(如 explorer-redesign §6)。 |
| `reviews/` | 独立评审存档:数据溯源评审 ×2、change-quiz 答案卷。 |
| `benchmark/engine-benchmark-validation.md` | SCRAM/OpenFTA 对标基准报告(引擎改动强制门)。 |
| `design/` | 设计规范与策略:`restyle-spec.md`(UI 令牌语言)、`ai-model-strategy.md`(模型分层)、`ai-live-run-runbook.md`、`ai-eta-example.md`(AI 草案契约示例)、`mockups/`(历次方向稿,含 explorer 定稿 8 页)。 |
| `reference-assets/templates-eta-claude.ts` | 前代工具模板原件(已迁入场景库,保留作对照)。 |

## 调研与外部资料(research/)

RiskSpectrum 调研报告(docx)、三份 compass 深研文稿(领域/算法/对标)。
只读参考,不随版本演进。

## 历史归档(archive/)

被取代但保留证据链的文档:`USER_GUIDE.md` 与 `ALGORITHM_DESIGN.md`(内容并入
TD-001,顶部有迁移注记)、`bess_qra_report.md`(早期样例输出)、
`skill-blueprints/`(设计期技能蓝图——**勿参照草图改真码**,真实实现见
`.claude/skills/` 与源码)。

## 相关但不在本目录

- 工作方法与技能:`.claude/skills/`(5 域 + 9 流程)、`.claude/agents/`(3 评审/实现代理)。
- Windows 时代完整历史:`git-archive repo/`(ignored,独立仓)。
