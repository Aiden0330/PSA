# 最小割集算法（mcs-algorithms）

## 目录
- 1. MOCUS（自顶向下）
- 2. MICSUP（自底向上）
- 3. 截断策略与误差估计
- 4. 模块化（Dutuit-Rauzy 线性时间）
- 5. 非相干树与素蕴涵

## 1. MOCUS（自顶向下代入法）

来源：Fussell & Vesely 1972（Trans. ANS 15:262）；实现 ANCR-1156（MOCUS, 1974）。核心观察：
- **OR 门增加割集数量**（一行裂成多行）。
- **AND 门增加割集规模**（同一行内做集合并/笛卡尔积）。

算法：从顶事件的单格表出发，自顶向下逐个用门的输入替换门，OR 加行、AND 在行内组合，直到所有格都是基本事件；最后用吸收律 `a + a·b = a` 删除非最小割集。

数据结构：行 = 候选割集（基本事件 frozenset）。最坏复杂度指数级（割集数随 OR 门指数增长），**必须配截断**。实现见 `assets/mocus.py`。

示例（SIF，顶 G1=OR(G2,G3)，G2=AND(G4,G5)，G3=AND(V1,V2)，G4=OR(S1,S2,L1)，G5=OR(S3,R1)）→ 7 个 MCS：
{S1,S3},{S1,R1},{S2,S3},{S2,R1},{L1,S3},{L1,R1},{V1,V2}。

## 2. MICSUP（自底向上）

来源：Pande, Spector & Chatterjee 1975（ORC 75-3, UC Berkeley）。从基本事件出发逐层向上合并到顶。取舍：自顶向下（MOCUS）适合「只要支配割集」；自底向上适合需要完整模块结构。工业上两者多被 ZBDD/BDD 取代，但 MOCUS 仍是教学与小模型校验的核心方法（Rauzy 2003 仍称其为「many fault-tree assessment tools 的核心方法」）。

## 3. 截断策略与误差估计

三类截断：
- **概率截断（cut-off）**：丢弃概率 < 阈值（如 1e-12）的割集。
- **阶数/规模截断（limit-order）**：丢弃基本事件数 > 阈值（如 > 6）的割集。
- 二者组合。

**关键：在生成过程中截断，而非生成后**——边建边按概率下界/阶数剪枝，保持中间结果可解。SCRAM 命令行直接暴露 `--cut-off` 与 `--limit-order`。

误差估计（Jung 等）：给定截断限 `10⁻ᵏ`，近似截断概率 `ATP_k = P_k + ΔP_k`，下界 `LBTP_k = P_k`，其中 `ΔP_k = P_k − P_{k−1}`。做法：逐步降低截断限，比较相邻结果 `ΔP_k / P_k`，低于可接受阈值（如 1%）即停止——以此控制并报告截断误差。

## 4. 模块化（Dutuit-Rauzy 线性时间）

来源：Dutuit & Rauzy 1996《A Linear-Time Algorithm to Find Modules of Fault Trees》, IEEE Trans. Reliability 45(3):422–425, DOI 10.1109/24.537011。原文：「derived from the Tarjan algorithm to find strongly connected components of a graph」，对相干/非相干树均可。

模块 = 一棵子树，其所有终端事件不在树中别处出现（输入完全独立）。模块可当作单个新基本事件先行求解，再代回——把大问题分治成若干小问题，对 BDD/割集成本是数量级的下降。

实现要点（DFS 两次遍历记 first/second/last visit 时间戳）：对每个门，若其所有后代的最早访问 ≥ 该门首次访问、最晚访问 ≤ 该门末次访问，则该门是模块根。XFTA/SCRAM 预处理均含模块捕获。`assets/preprocess.py` 给出探测骨架。

## 5. 非相干树与素蕴涵

含 NOT 门 → 非相干，MCS 概念推广为**素蕴涵（prime implicants）**。Rauzy 2001《Mathematical Foundations of Minimal Cutsets》(IEEE TR 50(4):389–396) 指出 MCS ≠ 素蕴涵。计算素蕴涵需在每个 BDD 节点算 consensus 项（两子节点逻辑交，Coudert-Madre），开销大；相干树不需要。

工程近似：把成功分支/补事件用**删除项（delete-term）近似**处理，或对失败/成功部分分别建精确 BDD 再合并（RSAT 路线）。多数工具默认相干近似以避免昂贵的 consensus。详见 quantification.md 的事件树小节。
