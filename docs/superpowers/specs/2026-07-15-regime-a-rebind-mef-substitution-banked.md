# Regime-A 条件参数重绑定 + MEF define-substitution I/O —— BANKED 规格

*2026-07-15 · 状态:**BANKED**(规格+锚点先行,实现未启动)· 按「后 Fable 运行规则」
本规格即禁独改类的授权凭证 · 前置:`2026-07-15-gap7-qt-models-exchange.md`(exchange
regime-B v1 已落地;本规格补齐卷宗显式留 v2 的两件)*

*语义出处(一手,2026-07-15 当日核验):XFTA §7.2(经 Gap 7 卷宗:regime A = 条件下
参数重绑定,精确且 BDD 兼容;delete/recovery 可布尔编译、exchange 不可)· SCRAM
`src/substitution.{h,cc}`(hypothesis 校验 + 三传统型判定逐行)· MEF `input.rng`
L435–468 `<define-substitution>` 语法(hypothesis→source?→target;target =
basic-event | `<constant value="bool"/>`)。*

## 1 · 范围(两件独立交付,可分批实现)

**A. regime-A 重绑定**:house 配置条件下,基本事件参数**换法则**——精确通道全覆盖
(与 regime-B exchange 的本质区别:改的是 q 映射,不是割集列表;BDD 结构不动,
exact/MCS/ETA/频率使能/CCF 展开全部自动一致)。
**B. MEF define-substitution XML I/O**:既有 4 种 PostRule(regime-B)↔ MEF
`<define-substitution>` 无损往返。

## 2 · A:regime-A 语义

```
RebindRule:
  id: str                                   # 规则名(审计/报错用)
  when: dict[house_id, bool]                # 非空;全部命中才激活
  param: str                                # 被重绑参数 id
  value: float | None                       # 形式一:点值覆盖(→ probability(value))
  to_param: str | None                      # 形式二:整法则替换(XFTA「取 target 之律」)
  (value XOR to_param,恰一)
```

- **家**:`Model.rebind_rules: list[RebindRule]`(additive dataclass 字段,缺省 [];
  json_io 透传)。模型级声明——与 bc_sets 同性质(配置依赖的数据语义),非分析级
  显示过滤。
- **激活**:分析配置解析后(4a2 优先级:house_states 显式 > 命名 bc_set > PDAG 基态),
  规则激活 iff ∀(h,s)∈when:有效 house 态(h)==s。
- **应用点(单一咽喉,MUST)**:新模块 **`psaengine/model/rebind.py`**,承载
  `RebindRule` 与 `effective_parameters(model, house_config, purpose="point") ->
  ParameterLibrary`——有效库视图(浅拷贝,被绑条目替换;模型本体绝不改写,沿 4a2
  不可变原则);`purpose="sampling"` 且任何规则激活 → raise(不确定性通道 v1 排除的
  执行点)。Analysis.__init__ 以解析后配置调用之(purpose="point"),下游全部经
  `self.q`/视图取 `unavailability()`。**禁止逐调用点接线**——普查:`unavailability()`
  引擎侧调用点 10+ 处(analysis.py:31 / frequency.py:72 / ccf_expand.py ×3 /
  eta/sequence.py ×3 / eta/uncertainty.py ×2 / uncertainty/montecarlo.py ×2),
  逐点接线必漏(88× 教训同族)。mef_xml.py 的 2 处导出用**基库**(导出无配置语义,
  不变)。v1 生效通道 = Analysis 族(probability/cutsets/importance);ETA 与频率
  通道随实现批经同一视图接线并补锚(本规格记接线义务,不预设其配置解析形状)。
- **两种形式**:
  - `value` → 视图条目 = `Parameter(id=param, kind="probability", value=v)`
    (点覆盖;显式丢弃原分布 → 与不确定性通道的交互见排除项);
  - `to_param` → 视图条目 = to_param 的完整 Parameter(kind/字段/分布全套),id 保留
    (XFTA 语义:source 取 target 之律)。
- **响亮拒绝**(v1):
  - when 为空 / when 引用的 house id 不在被分析图(ETA 为合并图)的 house 节点集;
  - param 不存在;param 为 frequency-kind(量纲:IE λ 不是配置可绑量;IE 树内
    probability-kind 使能参数**允许**——集成/频率通道经视图自动生效);
  - 同一 param 有 ≥2 条**激活**规则(不许静默后写胜);
  - value ∉ [0,1] / value 与 to_param 同给或同缺 / to_param 不存在或 frequency-kind;
  - **不确定性通道**:`effective_parameters(..., purpose="sampling")` 在任何规则
    激活时 raise——抽样类调用方(MC/tornado/ETA-MC)必须以 sampling 目的取库,这是
    接线义务(「regime-A × 分布抽样」语义留 v2:to_param 带分布如何进联合抽样需
    单独裁决);importance(点扰动)**允许**。
- 后端/前端接线(schemas 透传、分析设置 UI)为可放行层,随实现批机械补,不在锚点内。

## 3 · B:MEF define-substitution 映射表

`Model.post_rules: list[PostRule]`(additive 字段,缺省 [];MEF 互换之家——分析请求
仍可临时传 rules,优先级:请求显式 > model.post_rules)。导出顺序:define-substitution
置于 fault-tree 定义之后、model-data 之前;name 属性 = 规则 id(无则 `rule-{i}`)。

| PostRule | 方向 | MEF 形状 |
|---|---|---|
| `mutually_exclusive(events)` | ↔ | 声明式;hypothesis = `and(e1,e2)`(恰 2 事件)或 `atleast min=2(events)`(>2);target `<constant value="false"/>`;type=`delete-terms`(SCRAM is_mutually_exclusive:and-2 或 vote-2,全由构造保证) |
| `delete_contains(events)` | ↔ | 声明式;hypothesis `and(events)`;target false;**无 type 属性**(合法未定型声明式替换) |
| `recovery(events, add_event, prob)` | ↔ | 声明式;hypothesis `and(events)`;target `basic-event(add_event)`;type=`recovery-rule`;add_event 的 q 写入 model-data(导入侧必须能解析出 q,否则响亮) |
| `exchange(events, source, add_event, prob, source_prob)` | ↔ | **非声明式**;hypothesis `and(sorted(events ∪ {source}))`;`<source>` = [source];target `basic-event(add_event)`;type=`exchange-event`(SCRAM 判定:非声明式 ∧ 单 source ∧ source∈hypothesis ∧ and/null);prob/source_prob 由 model-data 解析(缺 → 响亮) |

**model-data 并集规则**:替换所引用的全部基本事件(hypothesis / source / target /
recovery add_event)即使不出现在任何故障树,其 `<define-basic-event>` float 也必须
写入 model-data(否则导入侧概率不可解析,往返即断——M1 以「target 不在树内」为
最尖探针)。

导入响亮拒绝(SCRAM Validate 同款 + 本仓库口径):嵌套 hypothesis;hypothesis 含
非 basic-event(house/gate);声明式 target=true(「无效果」);非声明式 target=false
(「source 无意义」);atleast min≠2;**多 source**(MEF 全 source 替换型 recovery,
即"替换"而非"追加"语义——本仓库 recovery 为追加式,点名 v2);xor/not 连接词
(非相干 hypothesis)。七类拒收全部入 M3 夹具(评审 D7 补齐后 3 类)。
往返恒等:rules → XML → rules′,语义等价(events 排序规范化)。

**一元 hypothesis 导出形**(评审 S2 钉定):单事件 hypothesis(如 recovery
events=["H"])导出 `<and>` 单子——input.rng `oneOrMore` 允许;SCRAM 侧 Formula
元数校验的容忍性未在一手源内核验(formula.cc 未下载),实现批做 SCRAM 互操作验证时
若其拒一元 and,则回退发裸 basic-event 并**放弃 type 属性**(SCRAM type() 判定
声明式 recovery 要求 kAnd,裸事件为 kNull 判不出),往返锁按语义等价断言不受影响。

## 4 · 锚点(tests/banked/test_regime_a_mef_substitution_banked.py)

探针:A 组 = `rebind_rules` ∈ Model dataclass 字段;B 组 = `post_rules` ∈ 字段
(激活契约:实现批以这两个字段名落地,锚点自动激活)。

基准模型:TOP = OR(A, AND(B,C), AND(H_MAINT, D)),qA=0.02, qB=0.1, qC=0.25, qD=0.3;
house H_MAINT 基态 False(v1 校验要求 when 引用的 house 是被分析图中的 house 节点,
故置于结构内;D 支全额入手算式,无近似项)。锚点手算(独立编码进测试,数字仅注释):
基态(H=false,D 支死)P₀ = 1−(1−0.02)(1−0.025) = **0.0445**;
H=true 且重绑 qB:0.1→0.4:P₁ = 1−(1−0.02)(1−0.4·0.25)(1−0.3) = 1−0.98·0.9·0.7
= **0.3826**(独立乘积式成立:A、B∧C、H∧D 三支变量不交)。

| # | 场景 | 期望 |
|---|---|---|
| R1 | 重绑恒等式:`Analysis(m, house_states={H:true}).probability()`(规则 qB:0.1→0.4)vs 直改模型 qB=0.4 同配置量化 | **逐位 ==**(同 BDD 同算术)+ 手算式 rel 1e-12 |
| R2 | 条件不满足(H=false / 缺省) | 与无规则模型逐位 == |
| R3 | to_param 形式(target=probability(0.4))vs value 形式 | 逐位 == |
| R4 | 跨通道一致(Analysis 族):cutsets 中 {B,C} 割集概率 = 0.4·0.25 / importance Birnbaum(C) 手算 ∂P/∂qC = 0.98·0.4·0.7 | 各自手算式 rel 1e-12(ETA/频率通道锚随实现批补,§2 接线义务) |
| R5 | CCF 成员重绑经展开自动生效:beta 模型 2 成员,Q_t 0.1→0.4 → P(AND) = βQ+(1−βQ)((1−β)Q)² 随动 | 手算式 rel 1e-12(有效库视图 → ccf_expand 自动) |
| R6 | 守卫参数化:同参双激活规则 / 未知 param / 未知 house / frequency param / value=1.2 / value+to_param 同给 / 双缺 / to_param 缺失 / `effective_parameters(purpose="sampling")`×激活规则 | 各自带规则 id 或 param id 的 ValueError |
| M1 | 4 规则全集 → save_mef_xml → load_mef_xml → 语义等价(events 规范排序后逐字段) | 往返恒等 |
| M2 | 导出 XML 形状:4 条 define-substitution 的连接词/type 属性/target 形态/hypothesis∋source(exchange) | 结构断言逐条 |
| M3 | 导入拒绝夹具(七类全覆盖,评审 D7):嵌套 hypothesis / target=true 声明式 / 多 source / atleast min=3 / hypothesis 含 house-event / xor 连接词(not 同分支类代表) / 非声明式 target=false | 各自响亮 ValueError |
| M4 | 手写 SCRAM 风格夹具(RNG 语法)导入 → 期望 PostRule 字段逐一 | 解析正确性 |

## 5 · 评审记录

- **round-0(2026-07-15,规格铸造)**:映射表逐行对照 SCRAM substitution.cc
  `Validate()`/`type()` 与 input.rng L435–468;R1 恒等式手算独立复核
  (0.0445/0.3826——评审 D6:曾误留无 H∧D 支旧模型的 0.118,转录类罪案 +1);
  单一咽喉设计由 unavailability() 调用点普查支撑(评审核实为 14 处,逐点接线否决)。
- **round-1(2026-07-15,engine-reviewer 锚点审计):PASS(有条件)**——R1–R5 手算式
  在**冻结引擎**上以直改参数复算全部 rel ≤ 2e-16(0.3826 / 0.0445 / 割集 {B,C}=0.1 /
  Birnbaum(C)=0.2744 / beta 展开两态),证明手算式与既有 ccf_expand/importance/
  cutsets 语义兼容;R1「逐位 ==」成立条件核实(变量序纯结构、同构重建逐位复现、
  probability(0.4).unavailability() 逐位);映射表 vs substitution.cc/input.rng 逐行
  成立,M3 的 s3/s4 在 SCRAM 侧合法、规格以本仓库口径拒收的标注**诚实**;
  model-data 并集规则必要性成立,M1「target 不在树」探针评价为尖锐。落修:
  **D6** §5 记录残留旧模型数 0.118 → 0.3826(转录罪案直接命中);**D7** M3 补 3 类
  拒收夹具;**S1** F_IE 夹具预置进基库 + 补 to_param→frequency 拒收例;
  **S2** 一元 hypothesis 导出形钉定(§3);**S5** R2b 回环锁补规则表/旁参数断言。

## 6 · 门禁(实现批)

先红后绿;`make benchmark` 24/24(q 视图层,应零差异);engine-reviewer 两轮
(隔离/状态机类:有效视图不得写回模型——R2 后接 R1 再接 R2 的回环锚点防状态泄漏);
json_io/canonical 往返锁(新字段);MEF 往返锁并入既有 mef 测试族。

## 实现批评审记录(2026-07-17,commit f2fc916 → 收口修)

engine-reviewer 冷读 **FAIL(4 偏离,2 HIGH,均风险低估向)→ 全修**:
- **F-1(HIGH)通道分裂**:仅 Analysis 接了 effective_parameters;ETA 序列/频率/MC 抽样
  通道读裸 model.parameters,规则被静默忽略(同模型两页两数,规则「工况劣化 q 升」时低估);
  `purpose="sampling"` 守卫在真实调用链不设防。修:三通道咽喉(_build_event_tree /
  _build_integrated / fault_tree_frequency)对非空 rebind_rules **响亮拒绝**(接线义务见下
  backlog),Analysis 通道不受影响(锚点 F1×4)。
- **F-2(HIGH)house 基态跨树后写胜**:同名 house 不同基态时数值随树序翻转 5×。修:
  `_house_base_states` 同 id 基态不一致必炸(锚点 F2)。
- **F-3(MED)MEF 并集静默漂移**:替换事件 rule 概率 ≠ 库/树值时 setdefault 首写胜 →
  往返割集概率漂移。修:`_sub_extra_set` 冲突拒绝 + 树内不一致导出拒绝(锚点 F3)。
- **F-4(LOW)when 短路**:前项不符即短路,后项未知 house 永不校验。修:先全量校验键
  存在性(锚点 F4)。

**接线义务 backlog(v2)**:ETA 序列 / 频率 / MC 抽样通道经 effective_parameters 接线 +
锚点(当前响亮拒绝止血);"请求显式 post_rules > model.post_rules" 量化路径接线(当前
model.post_rules 仅 MEF 交换落点 + json 透传,未接量化)。
