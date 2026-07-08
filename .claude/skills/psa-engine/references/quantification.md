# 定量、事件树与重要度（quantification）

## 目录
- 1. 顶事件概率近似与序关系
- 2. 事件树序列定量与成功分支
- 3. 重要度精确计算
- 4. CCF 集成

## 1. 顶事件概率近似与序关系

- **稀有事件近似 REA**：`Q_TE ≤ Σᵢ Qᵢ`。最保守上界，丢弃所有交叉项，仅当所有事件稀有时准；非稀有时严重高估。
- **最小割集上界 MCUB（Esary-Proschan）**：`Q_TE ≤ 1 − ∏ᵢ(1 − Qᵢ)`，永不超过 1，比 REA 紧；但相干树下相对 REA 的提升在低概率时「negligible」（Collet 1996, IEEE TR 45(1)）。
- **序关系**：`Q_TE ≤ 1 − ∏(1 − Qᵢ) ≤ Σ Qᵢ`。
- **容斥（Sylvester-Poincaré）**：`Q_TE = ΣQᵢ − Σ Pr(Eᵢ∩Eⱼ) + …`，精确但项数随割集数指数增长，大模型不可行。
- **BDD 精确法**：线性 Shannon 遍历，避免上述全部近似误差——BESS 非稀有概率场景的正解。

单个 MCS（独立基本事件）：`Q_E = ∏ qᵢ`，上界 `≤ min qᵢ`。MCS 频率：`W_E = Σᵢ wᵢ ∏_{k≠i} qₖ = Q_E·Σᵢ wᵢ/qᵢ`。

## 2. 事件树序列定量与成功分支

事件树序列 = 始发频率 × 各功能事件分支概率连乘。成功分支（success branch）= 补事件，使序列**非相干**，引入「补问题」。处理方式：
- **删除项近似（delete-term，SAPHIRE/FTREX）**：把成功分支编码为 NOT，再用删除项操作近似——`Top_seq = Failset \ DeleteTerms`。工程常用、保守。
- **精确 BDD 分部合并（RSAT）**：为失败部分与成功模块分别建 BDD 再合并，可精确处理成功分支的否定。RSAT 论文 Claim 3：不加 cutoff 且全程精确处理时返回精确顶值。
- **XFTA**：无专门删除项机制，但可构造 `NewTop = Top AND NOT(DeleteTerms)` 伪门，其 MCS 引擎本身处理非相干树。

实践：BESS 三栅栏事件树序列频率 = `f_IE · ∏(屏障成功或失败概率)`，成功支用 `(1−PFD)`。若屏障间不独立或共享部件，需把分支链接到故障树并按非相干处理。

## 3. 重要度精确计算

全部可由 Birnbaum（边际重要度 MIF）经 BDD 单遍历导出（Dutuit & Rauzy 2000, RESS 72(2):213）：
- **Birnbaum** `I_B(i) = ∂h/∂pᵢ = h(1ᵢ,p) − h(0ᵢ,p)`：对变量 i 的两 cofactor 概率差。BDD 上对 i 做 restrict 各算一次概率即得。
- **Fussell-Vesely** `FV(i) = Pr(至少一个含 i 的割集发生)/Q_TE ≈ 1 − h(0ᵢ,p)/Q_TE`。
- **RAW（风险增值）** `= h(1ᵢ,p)/Q_TE`：假定 i 必失效时风险倍增。
- **RRW（风险降值）** `= Q_TE/h(0ᵢ,p)`：假定 i 完好时风险降低倍数。
- **Criticality（关键重要度）** `CIF(i) = I_B(i)·qᵢ/Q_TE`。
- **DIM（微分重要度）**：`I_B(i)·qᵢ` 归一。

实现见 `assets/importance.py`：对每个基本事件，用 BDD restrict 算 `h(1ᵢ)` 与 `h(0ᵢ)` 两个条件概率，组合出全部指标，单次建图多次遍历。

## 4. CCF 集成

CCF 在生成 MCS/BDD 前于归一化阶段展开为基本事件。Open-PSA MEF 元逻辑层定义 Beta、MGL、Alpha、Phi 四模型：
- **Beta 因子**：每个 `BEᵢ → Gᵢ = BE_CCFᵢ ∨ BEᵢ`，公共全失效项 `Pr(BE_CCF)=βQ`，独立项 `(1−β)Q`。
- **MGL（多希腊字母）**：`Q_k = (∏_{j=2}^{k} ρ_j)(1 − ρ_{k+1})·Q / C(n−1,k−1)`，逐阶子组合展开。
- **Alpha 因子（NRC 首选）**：`Q_k = [k·α_k / Σᵢ i·α_i]·Q / C(n−1,k−1)`。
- **Phi**：直接给各阶 φ_k。

展开后每个 `BEᵢ` 变成 OR over 所有含它的公共组合事件。多数工具对高阶（如 ≥4 阶）组合截断或假定参数为零。实现见 `assets/preprocess.py` 的 `expand_ccf`。参数依据 NUREG/CR-5485。
