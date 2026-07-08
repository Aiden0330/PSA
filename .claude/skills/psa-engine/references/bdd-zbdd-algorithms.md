# BDD 与 ZBDD 算法（bdd-zbdd-algorithms）

## 目录
- 1. ROBDD 与 ITE
- 2. unique table 与 computed table
- 3. 变量序启发式
- 4. 从 BDD 精确算概率
- 5. ZBDD（Minato）与集合算子
- 6. Jung 相干 ZBDD 公式（FTREX 内核）
- 7. 从 BDD/ZBDD 抽割集
- 8. 实践限制与混合 MCS-BDD

## 1. ROBDD 与 ITE

基础：Bryant 1986《Graph-based algorithms for Boolean function manipulation》, IEEE TC 35(8):677–691。Shannon 分解 `f = x·f|x=1 + x̄·f|x=0`。核心算子 **ITE(If-Then-Else)** `ite(F,G,H)=F·G + F̄·H`：

```
ITE(F, G, H):
  if terminal: return trivial result          # 如 ITE(1,G,H)=G, ITE(0,G,H)=H, ITE(F,1,0)=F
  if (F,G,H) in computed_table: return cached
  x = top variable among F,G,H (按全局变量序)
  T = ITE(F|x=1, G|x=1, H|x=1)
  E = ITE(F|x=0, G|x=0, H|x=0)
  if T == E: return T                          # 约简规则2：消冗余节点
  R = unique_table.get_or_create(x, T, E)      # 约简规则1：hash-consing 合并同构
  computed_table[(F,G,H)] = R
  return R
```

门到 BDD：自底向上对每个门递归。`AND=ITE(F,G,0)`，`OR=ITE(F,1,G)`，`NOT=ITE(F,0,1)`，`XOR=ITE(F,H̄,H)`。表决门 k/n 先展开为 OR-of-AND 或用阈值递归。

工业实现范式：Brace/Rudell/Bryant 1990《Efficient Implementation of a BDD Package》(DAC'90)——complemented edges（补边，省一半节点）、哈希、缓存、垃圾回收。

## 2. unique table 与 computed table

- **unique table**：`(var, low, high) → node` 的哈希，保证强规范型（同构子图唯一）。即 hash-consing。
- **computed table**：`(op, args) → result` 的 memoization 缓存，避免重复递归，是把指数变多项式的关键。
- 补边表示下，规范化规则：保证 high 边非补（或 low 边非补，取一种约定），把补位下推。

用 dd 库时这些都已封装；自研时务必两表齐备，否则退化为指数。

## 3. 变量序启发式

BDD 大小对变量序**指数敏感**，最优序 NP 难。实用启发式：
- **DFLM（深度优先最左）**：对故障树 DAG 深度优先、最左子优先遍历，首次访问基本事件即赋递增序号；门只访问一次，线性。对手写树往往效果好（Bouissou/Bruyère/Rauzy ESREL'97；Mo 2013 QREI 29:307）。
- **WDFLM（加权 DFLM）**：给事件赋权重（如重复出现次数），按子树权重排序子节点访问顺序。
- **RDFLM（重复事件优先）**：让重复事件（多处出现）尽早排序，减少 BDD 宽度。
- **动态重排（sifting，Rudell）**：CUDD 内置，运行中自动调序；代价是时间。
- 结构重要度序、神经网络选启发式（Bartlett & Andrews 2002, IEEE TR 51(3):344）。

实现见 `assets/variable_ordering.py`。建议默认 DFLM，爆炸时试 WDFLM/RDFLM，再不行开 CUDD sifting。

## 4. 从 BDD 精确算概率

线性自底向上遍历，每节点：
```
pr(node) = pr(var)·pr(node.high) + (1 − pr(var))·pr(node.low)
pr(⊤)=1, pr(⊥)=0
```
两项因 Shannon 分解互斥 → **精确**，完全避免 REA/MCUB 误差。配 memoization 做到线性。补边需在遍历时正确处理（dd 的 `.low/.high` 访问器已解析补位）。实现见 `assets/bdd_engine.py` 的 `exact_probability`。

## 5. ZBDD（Minato）与集合算子

来源：Minato 1993《Zero-Suppressed BDDs for Set Manipulation in Combinatorial Problems》, DAC'93:272–277, DOI 10.1145/157485.164890；综述 Minato 2001（STTT 3(2):156–170）。ZBDD 专为**稀疏集合族（如割集）**设计，是割集的因子化压缩表示，远比割集列表省内存。

**零抑制约简规则**：若节点的 1-边（正边）指向 0-终端，则删除该节点，用其 0-子取代（与 BDD「两边相同则删」不同）。

核心算子：
- `Subset1(P,var)`：P 中含 var 的子集，去掉 var。
- `Subset0(P,var)`：P 中不含 var 的子集。
- `Change(P,var)`：翻转 var 的有无。
- `Union / Intersect(Intsec) / Diff`。
- `Product`：集合族笛卡尔积（用于 AND 门合并割集）。
- `Count`：割集计数。
- `Getnode(top,P0,P1)`：若 P1 是 0-终端则返回 P0（零抑制），否则查 uniq-table。

注意 ZDD 无 NOT；补集需全集 U：`P̄ = Diff(U,P)`。Apply 类操作理论上界为两操作数 ZDD 尺寸之积，经验上近似线性（依赖 memoization）。

## 6. Jung 相干 ZBDD 公式（FTREX 内核）

来源：Jung, Han & Ha 2004《A fast BDD algorithm for large coherent fault trees analysis》, RESS 83(3):369–374, DOI 10.1016/j.ress.2003.10.009。为**相干系统**给出两个 ite 连接词间 AND/OR 的新公式，使**构造中即可删子集（subsume）并按概率/规模截断**。设序 `x<y`，`h=ite(y,H₁,H₂)`：

- OR：`ite(x,G₁,G₂) + ite(y,H₁,H₂) = ite(x, G₁, G₂ + h)`
- AND（x<y）：`ite(x,G₁,G₂)·ite(y,H₁,H₂) = ite(x, G₁·h, G₂·h)`
- AND（同变量 x=x）：`ite(x,G₁,G₂)·ite(x,H₁,H₂) = ite(x, G₁H₁+G₁H₂+G₂H₁, G₂H₂)`

subsume（子集删除）`subsume(G,H)=G\H` 按 `x<y / x>y / x=y` 三情形递归。「边构造边 subsume 边截断」是快速求解大型相干树的关键（Matuzas & Contini 2015 RESS 144:183 指出截断在 subsume 之前施加，且可即时或延迟，两者时间/空间取舍不同）。

## 7. 从 BDD/ZBDD 抽割集

- 相干树：枚举 BDD 的 **1-路径**（从根到 ⊤、只走变量为真的边的路径集合经最小化）得 MCS；非相干得素蕴涵需 consensus。
- ZBDD：直接就是割集族的表示，遍历即得，配截断输出支配割集。
- `assets/bdd_engine.py` 给出 1-路径抽取的相干实现。

## 8. 实践限制与混合 MCS-BDD

完整 BDD 求解经验上限约「数百个基本事件」（Ibáñez-Llano 2010）。BDD 爆内存时（节点数随变量超出内存）：
1. 先换变量序（WDFLM/RDFLM/sifting）。
2. 仍不行 → **混合 MCS-BDD**：先 MOCUS/ZBDD 截断出割集，再在约简割集集合上建 BDD 做精确定量（RiskSpectrum RSAT 路线：用枢轴分解从 MCS 列表建 BDD；可设 MCS Cutoff Term 把割集分成 BDD 精确处理的支配部分与 MCUB 处理的尾部）。
