# 序列级完整 LFT 集成(Gap 9 残余,收官)

*2026-07-15 · 状态:实现中(Fable 亲做:规格→锚点→实现→engine-reviewer 两轮)· 前置:
`2026-07-14-ie-frequency-exact-mode.md`(逐初因精确模式,本特性把它推进到序列级)*

## 1 · 问题

IE 来自故障树且其**使能事件与屏障树共享基本事件**时,现行两段式
(F_IE × P(path),F 由频率通道独立算出)隐含 E_i ⊥ path 假设——共享事件下**错**,
且方向可为反保守(见锚点 C:同一使能既触发初因又击穿屏障时,"屏障成功"序列物理上
不可能,两段式却给正频率;"屏障失败"序列被低估 3.6×)。现状由前端独立性 lint 整体
拒绝共享场景——本规格以精确集成取代拒绝。

## 2 · 语义

设 IE 树(相干,经一频率规则校验)按初因分组得使能析取 E_i(同 exact 模式);
序列 s 的路径条件 Path_s = ∧(FE 失败取顶 / 成功取**精确否定**)——既有合并图机制。

    rate(s) = Σ_i λ_i · P(E_i ∧ Path_s)     (合并 BDD 上精确求值,共享事件自动正确)

精确性条件 = exact 模式同一假设集(独立 Poisson 初因;使能与屏障状态为与初因发生
无关的常驻态)。E_i 与 Path_s 共享变量正是本特性要正确处理的对象,无独立性假设。

**守恒恒等式**(锚点 B,套件锁):路径对状态空间分划 ⇒ Σ_s P(E_i∧Path_s) = P(E_i)
⇒ **Σ_s rate(s) = Σ_i λ_i·P(E_i) = F_exact(IE)** ——数学恒等式,测试以 rel=1e-12
锁定(review F4:浮点求和序不同,~27% 随机模型末位 1 ulp 差,「逐位」措辞撤回)。
**逐位成立的**是响应 `ie_frequency` 与频率通道 exact 头条(两条路径对 E_i 支撑集
同排序 → 同规范 ROBDD → 同算术,审查 400/400 逐位验证)。

**退化一致性**(锚点 A):IE 使能与屏障零共享 ⇒ P(E_i∧Path)=P(E_i)P(Path)
⇒ rate(s) = F_exact × P(Path_s)——数学恒等,rel=1e-12 锁(联合 Shannon 与两段乘法
的浮点结合序不同,不逐位;review F4 实测 694/2000 随机零共享例末位差)。

## 3 · 实现(psaengine/eta/sequence.py + quantify/frequency.py 复用)

- `_build_event_tree` 扩展:可选并入 IE 树 PDAG(节点按 id 合并——共享基本事件与
  屏障统一);IE 顶在**同一 BddManager** 建 BDD → `minimal_cutsets`(q=None)→
  复用频率通道的一频率规则校验与逐初因分组(小重构:frequency.py 抽出
  `group_enablers(cuts, freq_value)` 共享)。
- E_i 在合并管理器上以 apply_and/or 构造;q 映射跳过 frequency-kind 基本事件
  (初因变量不出现在 E_i∧Path_s 的 BDD 中,Shannon 遍历不会触及)。
- 新入口 `quantify_event_tree_integrated(model, et_name, ie_ft_name)` 返回与
  `quantify_event_tree` 同形的 {"sequences","consequences"}(+"method":"integrated",
  +"ie_frequency" 头条供 UI 对账);`event_tree_sequences_integrated` 同理。
- **v1 排除**(响亮拒绝,非静默):IE 树含 NOT/XOR(沿频率通道既有拒绝);IE 树事件
  出现在任何 CCF 组(展开语义与初因分组的交互留 v2);house/边界条件仅作用于屏障侧
  (IE 树含 house 即拒)。
- 后端:`EtQuantifyRequest` 增可选 `ie_fault_tree: {name, model}`(additive;
  et_builder 注入 Model.fault_trees)→ 设置时走 integrated;响应形状不变 + method 字段。
  不确定性/重要度通道 v1 不变(点估计先行,记 §6)。

## 4 · 锚点(TDD,先红)

| # | 场景 | 数值 |
|---|---|---|
| A 零共享退化 | IE=OR(AND(I,A)) λ=1e-3,qA=0.2;单屏障 B 独立 qB=0.1 | fail 序列 = 1e-3×0.2×0.1 = 2e-5;success = 1.8e-4;与两段式逐位相等 |
| B 守恒 | 任意共享结构(用 C 的模型) | Σ_s rate = F_exact(IE)(逐位) |
| C 共享使能击穿屏障 | IE=AND(I,S) λ=1e-3,qS=0.2;屏障顶=OR(S,X) qX=0.1 | fail 序列 = λ·P(S∧(S∨X)) = λ·qS = **2e-4**(两段式 5.6e-5,**低估 3.6×**);success 序列 = λ·P(S∧¬(S∨X)) = **0**(两段式 1.44e-4 > 0,物理不可能态) |
| D 双初因交叉共享 | I1 使能 {A};I2 使能 {B};屏障顶=OR(A,B) | 暴力真值表对拍(容斥手算易错的教训);同时锁 by-conservation |
| E 成功否定×共享 | C 的模型 + 二屏障(第二屏障共享 X) | 与暴力真值表逐位;非相干路径(¬)正确性 |

## 5 · 评审记录

- **round-1(2026-07-15):FAIL**——数学全部验证通过(独立 Campbell 推导;300 随机
  共享模型 vs 独立求值器 <1e-13;frequency.py 重构 400 例逐位等价;基准零差异结构性
  解释),但**合并无护栏**:节点 id 碰撞五类探针全部静默错数(IE 门撞屏障门 88× 低估
  且 HTTP 200;CCF 成员撞 IE 门 id 绕过旧守卫;屏障 house 撞 IE 基本事件违背"bc 仅
  屏障侧")。F1 碰撞护栏(同 id 仅限同参数基本事件)/ F2 屏障侧频率参数点名拒绝
  (原为深处 KeyError→500)/ F3 IE 块参数同 id 覆盖拒绝 / F4 本规格「逐位」过度声明
  (第三次转录类教训)/ F5 合并块抽共享 helper——全部落修,探针场景转为回归锁
  (含"护栏不扰动合法共享"逐位锁)。
- round-2(2026-07-15):(核验中,凭实际判定回填)

## 6 · 非目标(v2 候选,账本同步)

集成模式下的 MC 不确定性与屏障重要度(需把初因分组带进抽样/扰动语义);
IE 树事件参与 CCF 组;前端 lint 从"拒绝"翻转为"路由到集成通道"(本批由 Opus
在引擎落地后接线,lint 保留为"提示改走集成"而非报错)。
