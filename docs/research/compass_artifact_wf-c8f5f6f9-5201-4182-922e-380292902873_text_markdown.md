# MCS 与 BDD/ZBDD 算法在工业 PSA/FTA/ETA 工具中的实现：面向 BESS 热失控 QRA 自研 Python 引擎的深度分析报告

## TL;DR
- 工业级故障树定量的两条主线是**割集法（MOCUS/ZBDD，配合截断与 MCUB/稀有事件近似）**与**BDD 法（Shannon/ITE 递归，精确概率）**；对 BESS 热失控 QRA 这类规模较小（数百至数千基本事件）但含**非稀有屏障概率（0.01–0.5）**的模型，应优先采用**精确 BDD 定量**，因为 MCUB/稀有事件近似在高概率事件下会显著高估。
- 推荐架构：**预处理（常量传播、gate 归一化、coalescing、模块化探测）→ 用 DFS 左优先（DFLM）启发式定变量序 → 自底向上 ITE 递归建 ROBDD（带 unique table + computed table 哈希缓存）→ 线性自底向上 Shannon 遍历算精确概率 → 需要割集时用 ZBDD 抽取/截断**；当 BDD 爆炸时退化为**「先 MOCUS/ZBDD 出割集，再在约简割集上建 BDD」的混合 MCS-BDD 法**（RiskSpectrum RSAT 即此路线）。
- Python 落地：用 `dd` 库（tulip-control，纯 Python BDD + CUDD/Sylvan/BuDDy 的 Cython 绑定，含 CUDD ZDD）作为 BDD/ZDD 内核，自研故障树前端与 ZBDD 割集层；以 SCRAM（开源、文档最全）与 XFTA（Rauzy）作为算法参照与基准校验。

## Key Findings

### 1. MOCUS（自顶向下割集法）
- MOCUS 的方法首见于 **Fussell, J.B. & Vesely, W.E. (1972)《A New Method for Obtaining Cut Sets for Fault Trees》, Transactions of the American Nuclear Society, Vol. 15, p. 262**；其计算机实现见 **Fussell, Henry & Marshall《MOCUS – a Computer Program to Obtain Minimal Sets from Fault Trees》, ANCR-1156, Aerojet Nuclear Co., Idaho Falls, 1974 年 3 月**。核心观察：**OR 门增加割集数量（生成新行），AND 门增加割集规模（在同行内合并列）**。算法从顶事件单元格出发，逐步用门的输入替换门，最终展开为所有割集，再用吸收律 $a + ab = a$ 做最小化过滤。
- 数据结构是一个可扩展的表/矩阵（tableau）：每一行是一个候选割集（基本事件的合取）。复杂度在最坏情况下指数级（割集数随 OR 门指数增长），所以必须配合截断。

### 2. MICSUP 与自底向上法
- MICSUP（Minimal Cut Sets Upward）是自底向上法：从基本事件出发，逐层向上合并到顶事件，由 **Pande, P.K., Spector, M.E. & Chatterjee, P. (1975)《Computerized Fault Tree Analysis: TREEL and MICSUP》, Report ORC 75-3, Operations Research Center, University of California, Berkeley, 1975 年 4 月** 提出。自顶向下（MOCUS）通常更适合「只要支配割集」的场景，自底向上更适合需要完整模块结构的场景。

### 3. 组合爆炸与截断策略
- 三类截断：**概率截断（cutoff，丢弃概率低于阈值的割集）**、**阶数/规模截断（limit-order，丢弃基本事件数超过阈值的割集）**、二者组合。关键工程实践是**在生成过程中（during generation）就截断，而非生成后**，以保持问题可解。
- SCRAM 命令行直接暴露 `--limit-order` 与 `--cut-off` 选项。
- 截断误差估计：Jung 等人给出截断概率估计量——给定截断限 $10^{-k}$，近似截断概率 $ATP_k = P_k + \Delta P_k$，下界 $LBTP_k = P_k$，其中 $\Delta P_k = P_k - P_{k-1}$，通过比较相邻截断限的结果收敛性来控制误差。

### 4. 模块化（独立子树探测）
- **Y. Dutuit & A. Rauzy《A Linear-Time Algorithm to Find Modules of Fault Trees》, IEEE Transactions on Reliability, 45(3):422–425, 1996 年 10 月, DOI 10.1109/24.537011** 提出线性时间模块探测算法，原文摘要明确：「a linear time algorithm to detect modules of a fault tree, coherent or not, that is derived from the Tarjan algorithm to find strongly connected components of a graph.」模块是「终端事件不在树中其他地方出现」的独立子树，可被当作单个新基本事件处理，从而把大问题分解为若干小问题，大幅降低 BDD/割集计算成本。XFTA 的预处理就包含模块捕获，1.1 版「捕获更多模块」。

### 5. 非相干树与素蕴涵
- 含 NOT 门的非相干树中，MCS 概念推广为**素蕴涵（prime implicants）**。Rauzy 2001《Mathematical Foundations of Minimal Cutsets》(IEEE Trans. Reliability 50(4):389–396) 首次给出 MCS 的严格数学定义并指出 MCS ≠ 素蕴涵。计算素蕴涵需在每个 BDD 节点计算 consensus 项（两子节点的逻辑交），相干树则不需要，故工业上常用**相干近似**（把成功分支当作恒真/删除项处理）以避免昂贵的 consensus 计算。

### 6. BDD 基础（Bryant 1986）
- ROBDD 基于 Shannon 分解 $f = x\cdot f_{x=1} + \bar{x}\cdot f_{x=0}$（Bryant《Graph-based algorithms for Boolean function manipulation》, IEEE TC 35(8):677–691, 1986），核心是 **ITE（If-Then-Else）算子** $ite(x, f_1, f_0)$。关键数据结构：**unique table（哈希，保证强规范型/节点唯一即 hash-consing）**与 **computed table（memoization 缓存，避免重复递归）**。两条约简规则：合并同构子图、消除冗余节点（两出边指向同一节点则删除该节点）。故障树通过自底向上对每个门递归调用 ITE 转成 BDD。Brace/Rudell/Bryant 1990《Efficient Implementation of a BDD Package》(DAC'90) 是工业实现范式（complemented edges、哈希、缓存、垃圾回收）。

### 7. 变量序
- BDD 大小对变量序呈指数敏感，求最优序是 NP 完全/难。主流启发式：**深度优先最左（DFLM）**及其变体**加权 DFLM（WDFLM）**、**重复事件优先 DFLM（RDFLM）**；DFLM 即按故障树 DAG 的深度优先最左遍历给变量编号，线性复杂度，对手写树往往效果好（Bouissou, Bruyère & Rauzy, ESREL'97；Mo et al. 2013, QREI 29:307–315）。Bartlett & Andrews 提出基于结构重要度的序、以及用神经网络选择启发式（IEEE Trans. Reliability 51(3):344–349, 2002）。CUDD 提供基于 Rudell sifting 的动态重排序。

### 8. 从 BDD 精确算概率
- 线性时间自底向上遍历，每节点 $pr(node) = pr(var)\cdot pr(high) + (1-pr(var))\cdot pr(low)$，因为 Shannon 分解的两项互斥，结果是**精确**的，完全避免稀有事件/MCUB 近似误差。

### 9. ZBDD（Minato 1993）
- ZBDD 专为**稀疏集合（如割集族）**设计，出自 **Shin-ichi Minato (NTT LSI Laboratories)《Zero-Suppressed BDDs for Set Manipulation in Combinatorial Problems》, Proc. 30th ACM/IEEE Design Automation Conference (DAC'93), Dallas, TX, 1993 年 6 月 14–18 日, pp. 272–277, DOI 10.1145/157485.164890**（应用综述见 Minato 2001, STTT 3(2):156–170）。零抑制约简规则：若某节点的 1-边（正边）指向 0-终端则删除该节点（用其 0-子取代）——与 BDD「两边相同则删」不同。核心操作：`Subset1(P,var)`、`Subset0(P,var)`、`Change(P,var)`、`Union`、`Intersection(Intsec)`、`Difference(Diff)`、`Count`、`Product`。节点唯一性由 `Getnode(top, P0, P1)` 配合 uniq-table 维护。ZBDD 是割集的**因子化压缩表示**，远比割集列表省内存。

### 10. Jung-Han-Ha 2004 的相干 ZBDD 公式（FTREX 内核）
- Jung, Han & Ha 2004《A fast BDD algorithm for large coherent fault trees analysis》(RESS 83(3):369–374, DOI 10.1016/j.ress.2003.10.009) 为**相干系统**两个 ITE 连接词之间的 AND/OR 运算给出新公式，使得**在构造过程中即可删子集（subsuming）并按概率或规模限截断 ITE 连接词**。设变量序 $x<y$，$h=ite(y,H_1,H_2)$：
  - OR：$ite(x,G_1,G_2) + ite(y,H_1,H_2) = ite(x, G_1, G_2 + h)$
  - AND（$x<y$）：$ite(x,G_1,G_2)\cdot ite(y,H_1,H_2) = ite(x, G_1\cdot h, G_2\cdot h)$
  - AND（同变量 $x=x$）：$ite(x,G_1,G_2)\cdot ite(x,H_1,H_2) = ite(x, G_1 H_1 + G_1 H_2 + G_2 H_1, G_2 H_2)$
  - 这些公式与 Rauzy 1993 的常规 BDD 运算不同，正是相干简化之处（丢弃被吸收的非最小项）。
- subsuming（子集删除）递归：$subsume(G,H)=G\backslash H$，按 $x<y$、$x>y$、$x=y$ 分三种情形递归；「在构造过程中边截断边 subsume」是快速求解大型相干树的关键。FTREX（Jung et al. 2008）实现了该算法，可选常规 BDD 或相干 BDD。

### 11. 重要度的 BDD 精确计算
- Birnbaum 重要度 = 系统不可用度对 $p_i$ 的偏导 $I^B_i = \partial h / \partial p_i = h(1_i, p) - h(0_i, p)$，可由单次 BDD 遍历计算（关于变量的偏导即对应 BDD 的 cofactor 差）。FV、CIF、RAW、RRW、DIM 均可由 Birnbaum/MIF 在 ZBDD 上线性时间导出（Dutuit & Rauzy 2000, RESS 72(2):213–222）。

### 12. 定量近似与误差
- **稀有事件近似（REA）**：$Q_{TE} \le \sum_i Q_i$，最保守上界，高概率事件下严重高估。
- **MCUB（最小割集上界，Esary-Proschan）**：$Q_{TE} \le 1 - \prod_i (1 - Q_i)$，永不超过 1，比 REA 更紧；但对相干树精度提升相对有限（Collet 1996《Some remarks on rare-event approximation》, IEEE Trans. Reliability 45(1) 指出 MCUB 相对 REA 的精度提升「negligible」当事件概率低时）。三者关系：$Q_{TE} \le 1-\prod(1-Q_i) \le \sum Q_i$。
- **容斥（Sylvester-Poincaré）**：精确但项数随割集数指数增长，大模型不可行。
- **BDD 精确法**：避免上述所有近似误差。

### 13. 事件树序列定量与删除项
- 成功分支（success branch）使序列变为非相干（含补事件），引入「补问题」。SAPHIRE/FTREX 用**删除项近似（delete-term approximation）**处理 negate：把成功分支编码为 NOT 门，再用删除项操作近似。XFTA 当前版本不提供专门删除项机制，但可通过在模型里构造 `NewTop = Top AND NOT(DeleteTerms)` 的伪门来模拟，其 MCS 引擎本身能处理非相干树。RiskSpectrum RSAT 则用**精确 BDD** 分别为失败部分和成功模块各建 BDD 再合并，可精确处理事件树成功分支的否定。

### 14. CCF 集成
- CCF 在生成 MCS 前于归一化阶段展开为基本事件。Beta 因子模型：为每个 $BE_i$ 建 $G_i = BE_{CCF_i} \lor BE_i$，$BE_{CCF}$ 关联 $\beta Q$；MGL、Alpha 因子模型推广到各阶子组合。Open-PSA MEF 元逻辑层定义了 Beta、MGL、Alpha、Phi 四种模型。多数工具对四阶及以上 CCF 组合做截断处理（例如 PTC Windchill 对 ≥4 阶的组合假定参数为零）。

### 15. 关键工具的算法实现
- **SCRAM（开源、文档最全，基准研究用 0.16.2 版）**：C++，遵循 Open-PSA MEF。组件依赖图显示分析栈为 `pdag → preprocessor → bdd/zbdd → fault_tree_analysis/mocus → probability/importance/uncertainty`。预处理含常量传播、gate 归一化、coalescing、Boolean 优化；支持 MOCUS、BDD、ZBDD 三种定性算法，`--rare-event`/`--mcub` 两种近似与 BDD 精确概率；支持非相干树（素蕴涵）。bdd 与 zbdd 组件互相依赖（cycle）。
- **XFTA（Rauzy，手册 1.1 版/2012，基准用 1.3.1 版）**：Open-PSA 故障树引擎，ZBDD 割集引擎，自动归一化（CCF 展开、常量传播，均线性时间），cutoff 同时按最大阶与最小概率；能处理非相干树；1.1 版改进了预处理（更多模块）、变量选择启发式、数据结构与 cutoff。
- **FTREX（EPRI/CAFTA 引擎，Jung 等 2008）**：ZBDD 算法，相干与非相干（negate 用删除项近似），特性含自动逻辑环打断、规则化后处理、截断误差估计、并行计算；与 AIMS、EPRI R&R Workstation 接口。
- **SAPHSOLVE/SAPHIRE（INL）**：MOCUS 为主，删除项近似处理成功分支，规则化割集恢复；SAPHSOLVE 是从 SageRisk API 抽出的远程求解引擎。
- **RiskSpectrum RSAT（Lloyd's Register/原 Relcon Scandpower）**：**混合 MCS-BDD 路线**——不直接从树建 BDD，而是先出 MCS 列表，再用枢轴（pivotal）分解从 MCS 列表建 BDD（基于 Shannon 非相交分解 $f=x f_1+\bar x f_0$）。提供「精确处理」（精确顶事件概率）与「近似处理」（类 ZBDD，对相干结构保守，比标准 ZBDD 量化更精确）两种模式；论文 Claim 3 明确：不加 cutoff 且全程精确处理时，MCS BDD 返回精确顶值。三类 cutoff（失败部分割集生成时、成功模块生成时、建 BDD 前），加 MCS Cutoff Term 阈值把割集分成 BDD 处理的支配部分与 MCUB 处理的尾部（阈值设 0% 则对整个 MCS 列表建 BDD）。失败/成功部分各建 BDD 再合并，精确处理事件树成功分支。算法描述来自 Wang, Bäckström & Krcal (2014) PSAM12 与 Bäckström & Ying (2008) PSAM9 论文。

### 16. 学术基础与权威一手来源
- Bryant 1986（原始 BDD 论文，IEEE TC 35(8):677–691）；Minato 1993（ZBDD，DAC'93:272–277, DOI 10.1145/157485.164890）与 2001（STTT 3(2):156–170）；Rauzy 1993（New algorithms for fault trees analysis, RESS 40(3):203–211）；Coudert & Madre 1993（prime implicants, ARMS'93）；Sinnamon & Andrews 1996/1997（BDD for FTA）；Dutuit & Rauzy 1996（模块化, IEEE TR 45(3)）、2000（重要度, RESS 72(2)）；Rauzy 2001（MCS 数学基础, IEEE TR 50(4)）；Rauzy 2003《Toward an Efficient Implementation of the MOCUS Algorithm》(IEEE TR 52(2):175，指出 MOCUS 仍为「the core method of many fault-tree assessment tools」)；Jung et al. 2004/2008（ZBDD/FTREX）；NUREG-0492（Fault Tree Handbook, 1981）；Open-PSA Model Exchange Format 2.0d（Epstein & Rauzy 2008）；Rauzy《Probabilistic Safety Analysis with XFTA》2020；Andrews & Moss 教材。

## Details

### MOCUS 算法步骤（以 Jahanian 2025《Basic Computations in Fault Tree Analysis》的 SIF 例子说明）
顶事件 G1（OR 门）出发，表格按行展开：
1. G1=OR → 两行：{G2}，{G3}
2. G2=AND（G4,G5）→ {G4,G5}，{G3}
3. G3=AND（V1,V2）→ {G4,G5}，{V1,V2}
4. 继续展开 G4=OR(S1,S2,L1)、G5=OR(S3,R1)，AND 门内做笛卡尔积
5. 最终 7 个 MCS：{S1,S3},{S1,R1},{S2,S3},{S2,R1},{L1,S3},{L1,R1},{V1,V2}

数据结构本质：行=割集（事件集合），OR 加行，AND 在行内做集合并（组合）。最后用吸收律删非最小集。

### MCS 概率（一手公式，Jahanian 2025）
单个 MCS（独立基本事件）：$Q_E = \prod_{i=1}^n q_i$，上界 $Q_E \le \min\{q_i\}$。
MCS 频率：$W_E = \sum_i w_i \prod_{k\ne i} q_k = Q_E \sum_i w_i/q_i$。
顶事件容斥：$Q_{TE} = \sum Q_i - \sum_{i<j} Pr(E_i\cap E_j) + \dots$

### ITE 递归与表（Bryant/Brace-Rudell-Bryant）
```
ITE(F, G, H):
  if terminal case: return result
  if (F,G,H) in computed_table: return cached
  x = top variable among F,G,H
  T = ITE(F|x=1, G|x=1, H|x=1)
  E = ITE(F|x=0, G|x=0, H|x=0)
  if T == E: return T                      # 冗余节点消除
  R = find_or_add_unique_table(x, T, E)    # hash-consing 保证唯一
  computed_table[(F,G,H)] = R
  return R
```
AND = ITE(F,G,0)，OR = ITE(F,1,G)，NOT = ITE(F,0,1)。

### ZBDD 操作（Minato）
`Getnode(top,P0,P1)`：若 P1==空（0-终端）则返回 P0（零抑制规则）；否则查 uniq-table。`Subset1/Subset0/Change` 实现集合的因子化操作，`Union/Intsec/Diff` 递归。ZDD 无 NOT（补集需全集 U，$\bar P = Diff(U,P)$）。Apply 类操作的时间复杂度理论上界为两操作数 ZDD 尺寸之积，但经验上近似为输入输出尺寸之和的线性（依赖 memoization）。

### 变量序启发式实现（DFLM）
对故障树 DAG 做深度优先最左遍历，首次访问基本事件即赋递增序号；门定义只访问一次，线性复杂度。加权变体 WDFLM 给每个事件赋权重（如出现次数），按子树权重排序子节点。

### 截断在构造中的实施
SCRAM/FTREX 在 ITE/ZBDD 操作时，对中间 ITE 分支若其下界概率低于截断限或阶数超限则立即剪枝。即时截断使 ite 表更小（可小 30%）但增加运行时；延迟截断（处理完门后）表更大但更快——两种策略各有取舍。具名文献：**V. Matuzas & S. Contini《Dynamic labelling of BDD and ZBDD for efficient non-coherent fault tree analysis》, RESS 144 (2015):183–192**，原文：「Truncation is an expensive operation in the terms of timing. When the cache record is retrieved, it can be truncated immediately or at a later stage…Truncation, when requested, is applied before subsuming.」

### Python 库适配性
- **`dd`（tulip-control，报告所见至 0.6.0）**：纯 Python BDD（易调试）+ CUDD/Sylvan/BuDDy 的 Cython 绑定，**含 CUDD ZDD 模块（`dd.cudd_zdd`）**、Rudell sifting 动态重排序、dump/load、引用计数 GC、`add_expr` 解析布尔表达式。推荐作为内核：原型用纯 Python，部署切 CUDD。
- **CUDD**（Colorado University Decision Diagram）：BDD/ADD/ZDD 的 C 包，丰富动态重排序，工业级性能。
- **pyeda**：布尔代数库，含 BDD，适合教学/中小规模。
- 自研 ZBDD 割集层：在 `dd` 的 ZDD 上实现 `subset0/subset1/change/union/intersect/product` 与截断 subsume。

## Recommendations

**阶段 1（MVP，立即）**：实现 Open-PSA MEF（或子集）解析 → 预处理（常量传播、house event 代入、gate coalescing、把 k/n 展开）→ DFLM 变量序 → 用 `dd` 纯 Python BDD 自底向上 ITE 建树 → 线性 Shannon 遍历算**精确**顶事件概率。对 BESS 模型（数百–数千事件、屏障概率 0.01–0.5）这是正解，因为非稀有概率使近似失真。基准：用 SCRAM 跑同一 Open-PSA 模型对拍顶值与重要度。

**阶段 2（扩展）**：加 Dutuit-Rauzy 线性时间模块探测，对独立模块分治；加 ZBDD 割集抽取（用 `dd.cudd_zdd`）以输出按概率排序的支配 MCS 列表，配 `--cut-off`/`--limit-order`；加 Birnbaum/FV/RAW/RRW 单遍历计算；加 CCF（Beta/MGL/Alpha）归一化展开。

**阶段 3（鲁棒化）**：当某些大子树 BDD 爆炸（内存墙）时，退化为混合 MCS-BDD：先 ZBDD 截断出割集，再在约简割集上建 BDD 精确定量（RSAT 路线）；事件树成功分支用精确 BDD（失败/成功分别建再合并）或删除项近似。加截断误差估计 $\Delta P_k$ 收敛监控。

**触发阈值（何时改变策略）**：
- 纯 BDD 完整求解的经验规模上限约为「数百个基本事件」（Ibáñez-Llano et al. 2010：「Only small and medium fault trees, up to several hundred of basic events can be evaluated completely [by BDD]」）。若 BDD 节点数随变量增长超出内存（如 > 数千万 ITE 节点）→ 切换变量序启发式（试 WDFLM/RDFLM 或 CUDD sifting），仍不行则切混合 MCS-BDD。
- 若基本事件概率普遍 < 1e-3 且只需支配割集 → MCUB 可接受，ZBDD+MCUB 更快。
- 若含非稀有屏障概率（BESS 典型）或需精确 RAW/RRW → 必须精确 BDD。
- 截断误差：当相邻截断限结果变化 $\Delta P_k / P_k$ 低于可接受阈值（如 1%）时停止降低截断限。

**校验**：对拍 SCRAM（开源，三算法可交叉验证）与 XFTA；用已知小树手算 MCS 与精确概率；用 FFORT 故障树基准库（Ruijters et al. 2019, ESREL）做回归。

## Caveats
- **RiskSpectrum/RSAT 无公开理论手册**：算法描述来自 Bäckström/Krcal/Wang 的 PSAM9（2008）/PSAM11（2012）/PSAM12（2014）会议论文，正式手册为专有。用户提到的「Berg」未找到对应 RSAT 论文，实际作者为 Bäckström/Krcal。
- **Jung 2004 公式经二手转述**：AND/OR/subsume 公式取自作者本人的 FTREX 综述（KNS）对 2004 RESS 论文的转引；RESS 原文付费，发表时若需精确下标建议核对原文（DOI 10.1016/j.ress.2003.10.009）。PDF 抽取可能有格式损耗。
- **FTREX/SAPHSOLVE 为受控/专有软件**，部分算法细节来自论文而非源码；SCRAM 与 XFTA 为最佳可复现参照。
- **版本时效**：SCRAM 基准研究用 0.16.2 版、XFTA 1.3.1 版（2022 年 IMECE/ResearchGate 基准）；XFTA 手册引用为 1.1 版（2012）；`dd` 库版本随 PyPI 演进（报告所见至 0.6.0）。这些版本号在本知识截止后可能更新，落地前请核实最新版。
- **MOCUS 复杂度**：最坏指数级；纯 MOCUS 不适合大模型，工业上已基本被 ZBDD/BDD 取代，但作为教学与小模型验证仍有价值（Rauzy 2003 仍指其为「many fault-tree assessment tools 的核心方法」）。

---

## 可复用技能（Reusable Skill）：自研 Python ETA/FTA 定量引擎实现清单

**SKILL 名称**：`fta-eta-quantification-engine`

**适用场景**：构建支持 MCS 与 BDD/ZBDD 的故障树/事件树定量引擎（BESS 热失控 QRA 等中小规模、含非稀有概率的模型）。

**核心决策树**：
1. 模型规模与概率特征？小–中、非稀有 → 精确 BDD；大、稀有、只要支配割集 → ZBDD+MCUB；BDD 内存爆炸（> 数百事件完整 BDD 不可行）→ 混合 MCS-BDD。
2. 是否含 NOT/成功分支？是 → 非相干，需素蕴涵或删除项近似/精确 BDD 否定。
3. 是否需精确重要度？是 → BDD 单遍历偏导。

**实现模块清单**：
- 解析器：Open-PSA MEF（XML，RELAX NG 校验）
- 预处理：常量传播、house event 代入、gate coalescing、k/n 展开、CCF 展开（Beta/MGL/Alpha）、Dutuit-Rauzy 线性时间模块探测
- 变量序：DFLM（默认）/ WDFLM / RDFLM；可选 CUDD sifting 动态重排序
- BDD 内核：`dd` 库（纯 Python 原型 → CUDD 部署）；ITE + unique table + computed table
- 概率：线性 Shannon 自底向上遍历（精确）；REA / MCUB 备选
- 割集：ZBDD（`dd.cudd_zdd`）+ subset0/subset1/change/union/intsec/product + 构造中截断与 subsume
- 重要度：Birnbaum/FV/RAW/RRW/DIM 单遍历
- 截断：`cut-off`（概率）+ `limit-order`（阶数），误差估计 $\Delta P_k$
- 校验：对拍 SCRAM/XFTA，FFORT 基准

**关键公式速查**：
- Shannon：$pr(n)=pr(x)\cdot pr(hi)+(1-pr(x))\cdot pr(lo)$
- MCUB：$1-\prod_i(1-Q_i)$；REA：$\sum_i Q_i$；关系 $Q_{TE}\le$ MCUB $\le$ REA
- Birnbaum：$h(1_i,p)-h(0_i,p)$
- Beta 因子：$G_i=BE_{CCF_i}\lor BE_i$，$Pr(BE_{CCF})=\beta Q$
- 相干 ZBDD AND（x<y）：$ite(x,G_1,G_2)\cdot ite(y,H_1,H_2)=ite(x,G_1 h,G_2 h)$，$h=ite(y,H_1,H_2)$
- 相干 ZBDD AND（x=x）：$ite(x,G_1,G_2)\cdot ite(x,H_1,H_2)=ite(x, G_1 H_1+G_1 H_2+G_2 H_1, G_2 H_2)$

**一手参考**：Bryant 1986；Minato 1993（DOI 10.1145/157485.164890）/2001；Rauzy 1993/2001/2003；Dutuit & Rauzy 1996（DOI 10.1109/24.537011）/2000；Jung-Han-Ha 2004（DOI 10.1016/j.ress.2003.10.009）；Sinnamon & Andrews 1997；Fussell & Vesely 1972 / MOCUS ANCR-1156 1974；Pande/Spector/Chatterjee 1975（MICSUP, ORC 75-3）；Matuzas & Contini 2015；Wang/Bäckström/Krcal 2014（RSAT, PSAM12）；SCRAM 文档（scram-pra.org）；XFTA 手册（Rauzy）；Open-PSA MEF 2.0d；NUREG-0492。