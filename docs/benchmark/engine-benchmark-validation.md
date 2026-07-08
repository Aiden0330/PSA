# 引擎 vs 标准 PSA 基准模型 — 对标验证报告

> 自动生成自 `tests/benchmark/corpus.json` + 引擎实跑。重生成:
> `.venv/Scripts/python.exe -m tests.benchmark.make_report`

## 方法学
- 指标:精确顶事件概率(BDD,`Analysis.probability("exact")`);小模型并比最小割集数(`Analysis.cutsets()`)。
- 参考值:闭式解(Tier 1)/ 同行工具(SCRAM / OpenFTA)/ 学术基准(Tier 2),逐模型记赋值与出处。
- 容差:Tier 1 ≤1e-9;Tier 2 按公布精度(≤1e-3 或匹配有效位;高精度同行值收紧到 1e-6/1e-9)。
- 语料:3 个 Tier-1 闭式锚点 + 14 个 Tier-2 命名基准(参考值取自 SCRAM 同行工具 test 断言与 OpenFTA 报告,pinned commit b85b789)。其中 2 个非相干模型(XOR / NOT)仅作概率对标(probability-only,不计 MCS,见 spec §2.7 相干语料守卫)。引擎精确 BDD 规模已验证至 cea9601(201 门 / 186 基本事件)。
- 尺度上限:`engine_feasible=false` 的模型记为「尺度上限」(测试 xfail),非失败。

## 结果

| 模型 | Tier | 来源 | 参考顶概率 | 引擎顶概率 | 相对误差 | 参考MCS | 引擎MCS | 判定 |
|---|---|---|---|---|---|---|---|---|
| `voting_2of3` | 1 | Closed form: P(>=2 of 3) = (qa*qb+qa*qc+qb*qc) - 2*qa*qb*qc = 0.11 - 0.012 = 0.0 | 0.098 | 0.098 | 0.00e+00 | 3 | 3 | ✅ |
| `bridge` | 1 | Closed form via pivotal decomposition on bridge element E3, cross-checked by ful | 0.0586125 | 0.0586125 | 1.18e-16 | 4 | 4 | ✅ |
| `shared_event` | 1 | Closed form: qB + (1-qB)*qA*qC = 0.2 + 0.8*0.03 = 0.224 (repeated-event handling | 0.224 | 0.224 | 1.24e-16 | 2 | 2 | ✅ |
| `abc` | 2 | SCRAM peer tool, exact (no approximation) assertion EXPECT_DOUBLE_EQ(0.496, p_to | 0.496 | 0.496 | 0.00e+00 | 3 | 3 | ✅ |
| `ab_bc` | 2 | SCRAM peer tool, exact assertion EXPECT_DOUBLE_EQ(0.074, p_total) in tests/bench | 0.074 | 0.074 | 1.88e-16 | 2 | 2 | ✅ |
| `xor_abc` | 2 | SCRAM peer tool, exact assertion EXPECT_DOUBLE_EQ(0.404, p_total) in tests/bench | 0.404 | 0.404 | 0.00e+00 | — | — | ✅ |
| `a_or_not_ab` | 2 | SCRAM peer tool, exact assertion EXPECT_DOUBLE_EQ(0.28, p_total) in tests/bench_ | 0.28 | 0.28 | 0.00e+00 | — | — | ✅ |
| `theatre` | 2 | OpenFTA benchmark; SCRAM peer-tool exact assertion EXPECT_DOUBLE_EQ(0.00207, p_t | 0.00207 | 0.00207 | 2.10e-16 | 2 | 2 | ✅ |
| `trans_test` | 2 | OpenFTA benchmark (transfer-symbol test); SCRAM model input/TransTest/{trans_one | 2.4e-05 | 2.4e-05 | 0.00e+00 | 1 | 1 | ✅ |
| `three_levels` | 2 | OpenFTA benchmark (nested transfer symbols); SCRAM model input/ThreeLevels/top.x | 0.28 | 0.28 | 0.00e+00 | 2 | 2 | ✅ |
| `ne574` | 2 | NE574 Risk Analysis course (UW-Madison) example; SCRAM peer-tool exact assertion | 0.662208 | 0.662208 | 0.00e+00 | 7 | 7 | ✅ |
| `two_train` | 2 | SCRAM peer-tool exact assertion EXPECT_DOUBLE_EQ(0.7225, p_total) in tests/bench | 0.7225 | 0.7225 | 1.54e-16 | 4 | 4 | ✅ |
| `lift` | 2 | OpenFTA benchmark; OpenFTA report 'Exact value : 1.199993E-005', 12 minimal cut  | 1.19999e-05 | 1.19999e-05 | 3.33e-07 | 12 | 12 | ✅ |
| `chinese` | 2 | SCRAM peer-tool exact assertion EXPECT_NEAR(0.0045691, p_total, 1e-5) in tests/b | 0.0045691 | 0.00456932 | 4.85e-05 | — | — | ✅ |
| `baobab1` | 2 | Aralia/EDF benchmark (Rauzy et al.); SCRAM peer-tool exact assertion EXPECT_NEAR | 1.2823e-06 | 1.2823e-06 | 3.55e-06 | — | — | ✅ |
| `auto200` | 2 | SCRAM peer-tool exact assertion EXPECT_NEAR(0.55985, p_total, 1e-5) in tests/ben | 0.55985 | 0.559854 | 6.29e-06 | — | — | ✅ |
| `cea9601` | 2 | Aralia/CEA benchmark; SCRAM peer-tool assertion EXPECT_NEAR(2.38155e-6, p_total, | 2.38155e-06 | 2.38155e-06 | 8.69e-07 | — | — | ✅ |

_完整出处 / 赋值 / URL 见 `tests/benchmark/corpus.json`;复现:`.venv/Scripts/python.exe -m pytest tests/benchmark`。_
_生成时间(UTC):2026-06-24 03:42_