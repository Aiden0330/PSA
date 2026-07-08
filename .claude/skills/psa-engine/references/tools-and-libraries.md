# 工具算法对照、Python 库与校验（tools-and-libraries）

## 目录
- 1. 五大工业引擎算法对照
- 2. Python 库适配
- 3. 校验与基准
- 4. 一手文献

## 1. 五大工业引擎算法对照

| 引擎 | 归属 | 割集/定量算法 | 成功分支 | 备注 |
|---|---|---|---|---|
| **SCRAM** | 开源（文档最全） | MOCUS / BDD / ZBDD 三选一 | 非相干（素蕴涵） | C++、Open-PSA MEF；预处理含常量传播/gate 归一化/coalescing/Boolean 优化；`--rare-event`/`--mcub`/BDD 精确；**最佳可复现参照** |
| **XFTA** | Rauzy / AltaRica | ZBDD 割集引擎 | 非相干，伪门模拟删除项 | 自动归一化（CCF 展开/常量传播，线性）；cutoff 同时按最大阶与最小概率；模块捕获 |
| **FTREX** | EPRI / CAFTA | ZBDD（Jung 相干公式） | 删除项近似 negate | 自动逻辑环打断、规则化后处理、截断误差估计、并行 |
| **SAPHSOLVE** | INL / SAPHIRE | MOCUS 为主 | 删除项近似 | 规则化割集恢复；从 SageRisk API 抽出的远程求解引擎 |
| **RiskSpectrum RSAT** | Lloyd's Register | **混合 MCS-BDD** | 精确 BDD 分部合并 | 不直接从树建 BDD，而是先出 MCS 再用枢轴分解建 BDD；精确/近似两模式；三类 cutoff + MCS Cutoff Term |

启示：默认精确 BDD（学 SCRAM/RSAT 精确模式）；大模型退化混合 MCS-BDD（学 RSAT）；相干树用 Jung 公式边截断边 subsume（学 FTREX）。

## 2. Python 库适配

- **`dd`（tulip-control）——推荐内核**：纯 Python BDD（`dd.autoref`，易调试）+ CUDD/Sylvan/BuDDy 的 Cython 绑定（`dd.cudd`），**含 CUDD ZDD 模块 `dd.cudd_zdd`**、Rudell sifting 动态重排、dump/load、引用计数 GC、`add_expr` 解析布尔表达式。策略：原型 autoref，部署切 cudd。
  - 安装：`pip install dd`（纯 Python 即可用）；CUDD 后端需 `pip install dd --no-binary dd` 或按其文档编译。
  - 关键 API：`from dd.autoref import BDD; bdd=BDD(); bdd.declare('a','b'); u=bdd.add_expr('a & b')`；或 `a=bdd.var('a'); u=a & b; ~u`；cofactor 用 `bdd.let({'a': True}, u)`；节点访问 `u.var / u.low / u.high`（已解析补边）。
- **CUDD**（Colorado University Decision Diagram）：BDD/ADD/ZDD 的 C 包，工业级性能与丰富动态重排。
- **pyeda**：布尔代数库含 BDD，适合教学/中小规模。
- 自研 ZBDD 割集层：在 `dd.cudd_zdd` 上实现 `subset0/subset1/change/union/intersect/product` 与截断 subsume。

## 3. 校验与基准

- **对拍 SCRAM**：同一 Open-PSA MEF 模型，核对顶值、割集、重要度；SCRAM 三算法（MOCUS/BDD/ZBDD）可互相交叉验证。
- **对拍 XFTA**：相干树定量。
- **FFORT 基准库**（Ruijters et al. 2019, ESREL）：大量真实故障树 + 参考结果，做回归。
- **小树手算**：用 2-3 个手算可得 MCS 与精确概率的小树做单元测试。
- **近似一致性**：对同一模型，验证 `精确 ≤ MCUB ≤ REA` 的序关系恒成立（不成立即代码有 bug）。

## 4. 一手文献

- Bryant 1986（BDD，IEEE TC 35(8):677–691）
- Minato 1993（ZBDD，DAC'93:272–277，DOI 10.1145/157485.164890）/ 2001（STTT 3(2):156–170）
- Rauzy 1993（New algorithms for fault trees analysis，RESS 40(3):203–211）/ 2001（MCS 数学基础，IEEE TR 50(4):389–396）/ 2003（MOCUS 高效实现，IEEE TR 52(2):175）
- Dutuit & Rauzy 1996（模块化，IEEE TR 45(3):422，DOI 10.1109/24.537011）/ 2000（重要度，RESS 72(2):213）
- Jung, Han & Ha 2004（相干 ZBDD/FTREX，RESS 83(3):369，DOI 10.1016/j.ress.2003.10.009）
- Sinnamon & Andrews 1996/1997（BDD for FTA）
- Coudert & Madre 1993（prime implicants）
- Matuzas & Contini 2015（非相干 BDD/ZBDD 动态标记，RESS 144:183）
- Brace/Rudell/Bryant 1990（BDD 包高效实现，DAC'90）
- Fussell & Vesely 1972（MOCUS，Trans. ANS 15:262）；ANCR-1156（MOCUS 程序，1974）
- Pande/Spector/Chatterjee 1975（MICSUP，ORC 75-3）
- Wang/Bäckström/Krcal 2014（RSAT MCS-BDD，PSAM12）；Bäckström/Ying 2008（PSAM9）
- NUREG-0492（Fault Tree Handbook，1981）；Open-PSA MEF 2.0d（Epstein & Rauzy 2008）；Rauzy《Probabilistic Safety Analysis with XFTA》2020；Andrews & Moss 教材

> 注意：RSAT 无公开理论手册（算法描述源自 PSAM 会议论文，正式手册专有）；Jung 2004 的 AND/OR/subsume 公式部分经二手转述，精确下标以 RESS 原文为准；FTREX/SAPHSOLVE 为受控/专有软件。版本号（SCRAM 0.16.2、XFTA 1.3.1、dd 0.6.x）在知识截止后可能更新，落地前核实。
