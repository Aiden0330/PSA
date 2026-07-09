# CCF alpha/MGL/phi 展开语义(reference-hunt 报告 + 实现规格)

*2026-07-09 · parity 账本缺口 #1 · 语义来源:NUREG/CR-5485(Mosleh et al., 1998)
Tables 5-11/5-12;实现对照:SCRAM `src/ccf_group.cc`(基准语料参考工具,本日核验)*

## 一、记号

- 组规模 m,成员视为同质,Q_t = 单个部件总失效概率(取首成员参数)。
- Q_k = **一个特定** k 重共因基本事件的概率(k-子集事件,组内共 C(m,k) 个)。
- 展开后成员 x → OR(x__I 独立部分, 所有包含 x 的 k≥2 子集事件 CCF_g_S)。
- 一致性恒等式(所有模型、两种检验方案都必须满足,作 property 测试):
  **Σ_{k=1..m} C(m-1, k-1) · Q_k = Q_t**(某特定部件失效的全概率分解)。

## 二、各模型公式(SCRAM 核验一致)

| 模型 | Q_k | 因子键(引擎 JSON) | 备注 |
|---|---|---|---|
| beta | Q_1=(1-β)Q_t;Q_m=β·Q_t;中间层 0 | `beta` | 保持现有**单一集总事件**展开(CCF_g),与 SCRAM 相同 |
| MGL | Q_k = [Π_{i=1}^{k} ρ_i](1-ρ_{k+1}) Q_t / C(m-1,k-1),ρ_1=1, ρ_2=β, ρ_3=γ, ρ_4=δ…, ρ_{m+1}=0 | `beta,gamma,delta,epsilon,mu,nu,eta`(ρ_2..ρ_8) | 一致性:望远镜求和 Σ = Q_t(P_k=Πρ_i, Σ(P_k−P_{k+1})=1) |
| alpha(非错峰,**默认**) | Q_k = k·(α_k/α_t)·Q_t / C(m-1,k-1),α_t = Σ_{j} j·α_j | `alpha1..alpha{m}` | SCRAM 仅实现此式;NUREG/CR-5485 式(5-14) |
| alpha(错峰 staggered) | Q_k = α_k·Q_t / C(m-1,k-1) | 同上 + `staggered: true` | NUREG/CR-5485 Table 5-11;要求 Σα_k=1 时恒等式成立 |
| phi | Q_k = φ_k·Q_t | `phi1..phi{m}` | **SCRAM 约定**:φ 直接给出、须 Σφ_k=1(输入校验);注意此模型下恒等式变为 ΣC(m-1,k-1)φ_k·Q_t,一般≠Q_t——phi 是"直接指定",不参与恒等式测试 |

`staggered` 为 CCFGroup 新增可选布尔(默认 false);MGL 的错峰变体 NUREG 中亦有,
本期仅 alpha 支持错峰(BESS 场景 α 数据最常见),MGL+staggered 显式报错留待需要时补。

## 三、数值锚(手工推导,锁进 tests/unit + tests/property)

Q_t = 1e-2,m = 3:

1. **alpha 非错峰** α=(0.95, 0.03, 0.02) → α_t = 0.95+0.06+0.06 = 1.07:
   Q_1 = 0.95/1.07·1e-2 = **8.878505e-3**;Q_2 = (2/2)(0.03/1.07)·1e-2 = **2.803738e-4**;
   Q_3 = 3·(0.02/1.07)·1e-2 = **5.607477e-4**。恒等式:Q_1+2Q_2+Q_3 = 1e-2 ✓
2. **alpha 错峰** 同因子:Q_1 = **9.5e-3**;Q_2 = 0.03/2·1e-2 = **1.5e-4**;Q_3 = **2.0e-4**。
   恒等式(Σα=1):9.5e-3+3e-4+2e-4 = 1e-2 ✓
3. **MGL** β=0.10, γ=0.27:Q_1 = **9.0e-3**;Q_2 = ½·0.1·0.73·1e-2 = **3.65e-4**;
   Q_3 = 0.1·0.27·1e-2 = **2.7e-4**。恒等式:9.0e-3+7.3e-4+2.7e-4 = 1e-2 ✓
4. **beta ≡ MGL(m=2)**:m=2 时 MGL 只有 β,Q_1=(1-β)Q_t、Q_2=βQ_t,与 beta 模型一致(等价性测试)。
5. **系统级精确锚**:2oo3(ATLEAST k=2)+ MGL 展开(7 个独立基本事件:3 独立 + 3 对 + 1 三重),
   测试内**穷举 2^7 状态**求精确参考值,与 BDD 顶值逐位比对(不引入常数,消除抄写风险)。

## 四、实现决定

- `psaengine/preprocess/ccf_expand.py`:新增 `q_levels(model, factors, m, q_t, staggered)` 纯函数
  (公式唯一出处)+ mgl/alpha/phi 走**全子集展开**(k≥2 每个 k-子集一个基本事件
  `CCF_{gid}_{成员按字典序连接}`);beta 保持现集总路径(守护测试在)。
- 子集事件数 = 2^m − m − 1,m>6 拒绝(ValueError)——BESS 冗余通道 m≤4,防误用爆炸。
- 异质成员:按首成员 Q_t 展开(NUREG 同质假设);成员 Q 不同时不再各自保留
  (beta 路径维持逐成员 (1-β)q_i 旧行为不变)。
- `CCFGroup.staggered: bool = False`;json_io 读写透传。
- **MEF I/O**:`define-CCF-group`(model = beta-factor|MGL|alpha-factor|phi-factor)
  解析与生成:`<distribution>` 为 Q_t(成员注册为同值 basic),`<factor level=k>` 映射
  上表因子键;round-trip 测试。
- 前端 `ParamLibrary`:CCF 组编辑支持模型下拉 + 按模型动态因子输入 + 错峰勾选(alpha)。

## 四点五、评审后决定(engine-reviewer 2026-07-09,缺陷 1–6 全部修复并加锁定测试)

- **成员在场性(缺陷 #5)**:组成员**全部不在**当前树 → 静默跳过(逐树分析语义,组属别树);
  **部分在场**或**与先前组重叠**(成员已被展开)→ `ValueError` 响亮失败——按声明规模静默重归一
  会无声改写共因概率(评审实测 1.71×),监管工具不可接受。
- **同质性(缺陷 #6)**:mgl/alpha/phi 多层展开要求成员 Q_t 同质(rel 1e-9),异质显式拒绝
  并提示改用 beta(其逐成员 (1-β)q_i 路径保持旧行为)或统一参数。理由:NUREG 同质假设下
  取首成员会把其余成员边际概率无声减半(评审实测)。
- **Σ=1 容差**:phi 与错峰 alpha 的因子和校验容差 1e-4,对齐 SCRAM(1e-6 会拒收 SCRAM 合法文件)。
- **错峰 alpha 必须 Σα=1**(缺陷 #4):错峰式无 α_t 自归一,尺度敏感——静默缩放即静默改写全部共因概率。
- **MEF**(缺陷 #1–#3):`define-CCF-group` 允许嵌套于 define-fault-tree(root.iter);
  无 level 属性的 factor 自模型最小层级顺次分配(SCRAM 语义);staggered 经 MEF 通用
  `<attributes>` 无损往返;`<distribution>` 仅支持 `<float>`(其余显式报错)。
- **ETA 路径**:`_build_event_tree` 在合并 PDAG 上展开 CCF(跨屏障共享共因事件参与
  成功分支精确否定);扩充参数库随 `EtBuild.params` 贯穿序列/不确定性定量。
  ET 请求 (`EtQuantifyRequest`) 新增 `ccf_groups` 透传。

## 五、验收

- 数值锚 4 组逐位(rel 1e-12);恒等式 property(随机因子 × m∈{2,3,4} × 模型×方案);
  2oo3 穷举=BDD;MEF round-trip;`make benchmark` 17 例不回归;engine-reviewer 通过。
