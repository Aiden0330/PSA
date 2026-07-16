# 分析执行与证据重放 v2(F3:EB-01 + EB-02 + EB-08 同根)

*2026-07-16 · 状态:**规格(Fable 亲做)**,实现待接(EB-01 薄片先行 → EB-02 → EB-08)·
禁独改类:监管口径 + 证据链契约 + 引擎数值语义,须本规格 + 先红锚点在先 · 依据:
第三方评审裁定 `docs/reviews/2026-07-16-3rd-party-review-adjudication.md` F3 段,三条 P0/P1
均已对代码核实*

## 0 · 一句话

**quantify 走一条路、report 走另一条路**——这是三条缺陷的共同病根。EB-01(报告发布错误
频率)、EB-02(结果绑到无关版本)、EB-08(已固定版本不能完整重放)都是"计算的输入"与
"报告/钉扎/重放的输入"各行其是的症状。本规格建立**单一规范化执行输入**,让四条分析通道
(quantify / report / uncertainty / importance)消费同一份,并让钉扎从该份派生、canonical
能完整承载它。

## 1 · 已核实的三处断裂(对代码)

**EB-01(P0,报告发布错误频率)**:`api_report`(app.py:224)对 single scope 调
`rx.build_report_data(model, "TR", …)`——签名(report_export.py:71)**无 house_states/
boundary_condition_set 入参**,且 `ReportRequest`(schemas.py:126)**无 ie_fault_tree 字段**。
后果两重:①集成 LFT 模型的报告静默走普通 `event_tree_sequences`(锚点 C:C3 低估 3.6×、
C1 生成物理不可能的正频率);②house 条件的报告忽略边界设置(点计算 C5=1e-3、报告 C5=0)。
`ReportRequest` 经继承**确有** house_states(EtUncertaintyRequest:102),只是从未透传——
这是最便宜的止血点。集成 MC 不确定性/屏障重要度**引擎侧根本不存在**(uncertainty.py/
barrier_importance_exact 无 integrated 变体)——所以集成模型的这两个通道必须**响亮拒绝**,
绝不回退普通 ETA(回退=EB-01 换个面复发)。

**EB-02(P0,证据链断裂)**:`_pin_case`(app.py:142)对 `req.project_payload` **独立**
canonicalize,与实际计算所用的 `req`(dumped model)**零校验**。用 PFD=.9 算出的报告能钉到
PFD=.1 的版本,HTTP 200,案例版本哈希指向错模型——证据链"这个数来自这个钉扎模型"的承诺被
静默违背。

**EB-08(P1,重放不完整)**:canonical Parameter 只认 probability/rate/frequency
(models.py:62);engine_request 只重建 `{value}`(engine_request.py:72);et_builder 强制
kind="probability"(:29)。Weibull/glm/periodic_test 参数过不了 canonical;beta-CCF 重放
给 .01 而非 .018019;`engine_version()` 恒 `0.1.0`(pyproject:3),分辨不了数值实现变更。

## 2 · 目标架构:单一执行输入 + 派生钉扎 + 完整 canonical

### 2.1 ExecutionInput(规范化执行输入,单一真源)

新增 `backend/execution.py`,定义 `build_execution_input(req) -> ExecutionInput` 与
`run_analysis(exec_input, channel) -> ...`。`ExecutionInput` 是一个冻结 dataclass,承载
**一次分析所需的全部语义**:

```
ExecutionInput:
  model: Model                     # build_model_from_request 的产物(含 fault_trees/ccf/参数)
  et_name: str = "TR"
  ie_ft_name: str | None           # 非 None ⇒ 集成 LFT 通道
  house_states: dict[str,bool]     # 已解析(直接覆盖 ∪ 命名集,4a2 优先级)
  boundary_condition_set: str|None
  request_hash: str                # 规范化引擎请求的内容哈希(见 2.3)
  # 通道无关;quantify/report/uncertainty/importance 全部从这里取输入
```

`channel ∈ {quantify, report_point, uncertainty, importance}`。`run_analysis` 按
`ie_ft_name` 分派:
- `ie_ft_name` 为 None:既有 `event_tree_sequences` / `event_tree_uncertainty` /
  `barrier_importance_exact`(house_states/bc **必须透传**——EB-01 第二病)。
- `ie_ft_name` 非 None:`event_tree_sequences_integrated`;**uncertainty/importance 通道
  抛 `UnsupportedIntegratedAnalysis`**(端点映射 422,body 明示"集成模式下 MC 不确定性/
  屏障重要度为 v2 候选,尚未实现,不回退普通 ETA")。

四个入口(api_event_tree_quantify / api_report / api_event_tree_uncertainty /
api_event_tree_importance)全部改为:`exec = build_execution_input(req)` →
`run_analysis(exec, channel)`。**quantify 与 report 的点结果从此逐位同源**。

### 2.2 report_export 接入

`build_report_data` 增 `house_states`/`boundary_condition_set`/`ie_ft_name` 入参并透传到
序列/后果聚合;集成通道用 `event_tree_sequences_integrated` 的 rate(s) 填充后果频率,报告
后果表列出 `ie_frequency` 头条对账。`ReportRequest` 增 `ie_fault_tree: Optional[dict]`
(与 EtQuantifyRequest 同形)。checked_set scope 的集成暂不支持(现已拒逐树 bc,一并拒
逐树 ie_fault_tree,响亮)。

### 2.3 派生钉扎与请求哈希(EB-02)

`request_hash` = 规范化引擎请求的内容哈希(把 build_model_from_request 的**输入** dump 按
canonical_json 同规则规范化后 hash——键序无关、浮点 repr 稳定)。钉扎改为:

- **首选**:`_pin_case` 接收 ExecutionInput,从 `req.project_payload` canonicalize 得
  version 后,**再从该 version 反构引擎请求**(EB-08 的 canonical v2 使这成为可能),其
  `request_hash` 必须等于计算所用的 `exec.request_hash`;不等 → **409/422 拒绝钉扎**
  (证据链不能证明结果来自钉扎模型)。
- **过渡(EB-08 v2 落地前的 EB-02 薄片)**:不反构,直接比较——`project_payload` 经
  build_model_from_request 的 `request_hash` 必须等于 `exec.request_hash`,不等即拒。
  这一步不需要 canonical v2,可与 EB-01 薄片同期落地。

analysis_case 持久化字段扩充:`model_hash`(canonical 内容哈希,已有)、`request_hash`
(新)、`resolved_settings`(house/bc/ie_ft_name/samples/seed/EF)、`request_schema_version`、
`engine_fingerprint`(见 2.4)。

### 2.4 引擎指纹(EB-08)

`engine_version()` → `engine_fingerprint()`:`{semver, git_sha, dirty, request_schema_version,
benchmark_corpus_version}`。semver 从 pyproject(**升到非 0.1.0 占位**);git_sha/dirty 运行时
探测(缺 git 时降级为 "unknown",不崩);benchmark_corpus_version = 基准语料的内容哈希或
声明版本。案例钉扎与报告页脚引用完整指纹——数值实现变更后旧案例的指纹不同,重放可辨。

### 2.5 canonical v2(EB-08)

`backend/canonical/models.py` Parameter.kind 扩为七 kind(+exponential/glm/weibull/
periodic_test);typed 字段(gamma/alpha/beta/t0/mttr/test_interval/mission_time)完整承载。
`engine_request.py` 参数重建输出完整 typed dict(非仅 `{value}`);`et_builder.py` 不再强制
probability——按 canonical 记录的 kind 重建。CCF/BC/LFT 设置进 canonical sidecar 或正文
(往返无损)。schema version 升位。JSON/MEF 暂不支持某 kind 时**明确拒绝导出**(不静默固化
Q(t) 为当前概率标量)。

## 3 · 锚点(TDD,先红;tests/backend/test_execution_replay_v2.py)

黄金锚点(评审 §5 阶段 A 首批 + 补强):

| # | 场景 | 期望 |
|---|---|---|
| G1 | **LFT anchor C 三表面逐位**:集成模型 quantify vs CSV vs docx 点结果 | 三处 C3=2e-4、C1=0 逐位一致(此前 CSV C3=5.6e-5、C1=1.44e-4) |
| G2 | **house 报告对拍**:house_states 使 C5=1e-3 的模型 | 报告 C5 = 点计算 C5(此前报告 C5=0) |
| G3 | **集成 uncertainty/importance 拒绝** | 422 UnsupportedIntegratedAnalysis,body 含"v2 候选";**不返回普通 ETA 数字** |
| G4 | **payload/request 不一致拒绝**(EB-02):project_payload PFD=.1、计算 req PFD=.9 | 409/422;绝不 200+钉扎错版本 |
| G5 | **重放逐位**:从 analysis_case 反构执行 → 结果与原 case results 逐位一致 | CCF/LFT/house/Q(t) 全含 |
| G6 | **beta-CCF replay**(EB-08):含 beta CCF 的 canonical 往返 → C2 | .018019(此前 .01) |
| G7 | **Q(t) roundtrip**(EB-08):weibull/periodic_test 参数 canonical 往返 | 无损(此前 ValidationError) |
| G8 | **指纹可辨**:engine_fingerprint 非 0.1.0,含 git_sha;缺 git 降级 unknown 不崩 | 结构断言 |
| G9 | **single scope 零扰动**:非集成、无 house 的既有报告 | 与重构前逐位(回归锁) |

## 4 · 分阶段(每阶段独立可落、可提交)

- **阶段 1 — EB-01 薄片(解报告冻结,最高优先)**:ExecutionInput + run_analysis 分派;
  report 接 house/bc + ie_fault_tree;集成 uncertainty/importance 422。锚点 G1/G2/G3/G9。
  **不含** canonical v2 / 指纹——EB-02 用过渡比较(2.3 过渡段)。此阶段落地即解除裁定
  文档 §4 的报告/导出冻结。
- **阶段 2 — EB-02 钉扎完整性**:request_hash 入案例 + payload/request 不一致拒绝
  (过渡比较版)。锚点 G4 + resolved_settings 持久化。
- **阶段 3 — EB-08 canonical v2 + 指纹 + 反构重放**:七 kind canonical、typed 重建、
  引擎指纹、从 version 反构引擎请求使钉扎"派生"而非"比较"。锚点 G5/G6/G7/G8。

## 5 · v1 非目标(明示,防回退式"兼容")

集成 LFT 的 MC 不确定性与屏障重要度(评审阶段 E / LFT 规格 §6 已记 v2 候选)——本规格
**不实现**,只保证响亮拒绝。checked_set scope 的集成聚合。JSON/MEF 对 Q(t) 的导出(拒绝
即可,不静默固化)。

## 6 · 门禁与评审

每阶段:先红后绿;触引擎/序列语义 → `make benchmark` 24/24(应零差异,结构性:阶段 1 只
改输入透传与分派,不动算术);canonical 往返锁(阶段 3);engine-reviewer(数值/重放语义)
+ domain-reviewer(监管口径:报告数字必须可追溯到钉扎版本)两轮。实现由 Fable 规格锚点
铺就后可交 Opus 机械执行,收口审查回 Fable/评审代理。

## 7 · 评审记录

- **round-0(2026-07-16,规格铸造)**:三断裂逐条对代码核实(EB-01 report_export.py:71
  签名缺 house/ie_ft + schemas.py:126 无 ie_fault_tree;EB-02 app.py:142 独立 canonicalize;
  EB-08 models.py:62 三 kind + engine_request.py:72 仅 value);集成 uncertainty/importance
  引擎侧确不存在(必须拒而非回退);EB-01 薄片(report 透传既有继承的 house_states)确认为
  最便宜止血点。
