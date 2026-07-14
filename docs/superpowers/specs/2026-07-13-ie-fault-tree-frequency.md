# 初因事件故障树量化(手动/FTA 双通道)实施规格

*2026-07-13 · 状态:实施中 · 用户指令:"initial events should also be connected with FTA
like other nodes in ETA … make sure initial events can be built through FTA or manually input" ·
对标:RiskSpectrum/SAPHIRE/CAFTA-FRANX 的初因故障树(支持系统初因的标准做法);
对标账本此前**漏记**此 gap*

## 0 · 盲区发现(领地实况,非读文档)

| 事实 | 位置 | 含义 |
|---|---|---|
| `initFreqSource: 'manual'\|'product'\|'ft'` 全链路已预留 | eventtree.ts:31 / canonical models.py:115 | 枚举值三层都合法,但 'ft' 无计算语义 |
| **在产量纲 bug**:'ft' 路径把 `__init__` 树喂给**概率**端点,结果标成 /yr | EtaWorkbench.tsx:109(`quantify(...).probability` → `INIT_FREQ_KEY`)、EtInspector.tsx:181(“顶事件概率…/yr”) | OR 门按 1−Π(1−q) 算(频率应为 Σ)、AND 门得 1/yr² 无意义、结果封顶 1;正是硬约束 #4 禁止的静默换算 |
| 引擎 `Parameter.kind='frequency'` 存在但 `unavailability()` 原样返回值 | parameters.py:39-40 | 频率参数误入概率通道时**静默**通过——反向的同一颗雷 |
| `et_builder` 把请求参数全部强制 `kind:"probability"` | et_builder.py:29 | ET 请求通道无 kind 透传(v1 不需:见 §2 可分离设计) |
| canonical 已存全部 fts 故障树(含无挂接的 `__init__`)+ Parameter.kind 三值 | convert.py:102 / models.py:63 | **契约零改动**即可持久化 |
| 派生缓存架构完备:`INIT_FREQ_KEY` compose/strip 与屏障 linkFt PFD 同构 | derived.ts | 只需把喂给缓存的数从"概率"换成"频率" |

## 1 · 方法(行业标准,与 RS/SAPHIRE 一致)

**每个最小割集恰好一个频率事件**:割集频率 = 初因率(/yr)× Π(使能概率);
顶事件频率 F = Σ 割集频率(频率的并即求和,标准方法;对共享使能事件为保守方向)。
违反规则(0 个或 ≥2 个频率事件)→ **响亮报错**,绝不静默近似(AND(f,f)=1/yr² 无意义)。

**可分离设计(v1)**:F_IE 独立于屏障树计算,序列频率 = F_IE × P_exact(路径)——
与现有屏障 linkFt 的派生缓存架构 1:1 同构(composed 标量进 ET/报告管线,契约零改动)。
**独立性护栏**:`__init__` 树与任何屏障树共享基本事件时,前端在量化前**拒绝并解释**
(共享失效使独立性假设破坏,方向可能非保守——正确处理需 IE 树并入序列割集,
记入对标账本作为将来的完整 LFT 集成项)。

## 2 · 实施(TDD,一任务一提交)

1. **引擎** `psaengine/quantify/frequency.py::fault_tree_frequency(model, ft_name, cutoff=0, limit_order=None)`
   → `{frequency, cutsets:[{events, order, frequency, initiator}]}`;复用 minimal_cutsets 的
   MCS 枚举;逐割集分拣 kind:frequency=1 校验(违规 `FrequencyRuleError` 列出割集);
   使能事件走 `unavailability()`(probability/rate 均可)。
   **量纲护栏**:`Parameter.unavailability()` 对 kind='frequency' 改为 raise
   ("frequency parameter in probability context")——概率通道反向误用同样响亮。
   锚点:OR(f₁,f₂)=f₁+f₂(非 1−Π);AND(f,q)=f·q;AND(f,f)→raise;纯概率树→raise;
   OR(AND(f₁,q),AND(f₂,q))=(f₁+f₂)q;rate 使能 λ·MTTR;截断。⇒ `make benchmark` + engine-reviewer。
2. **后端** `POST /api/ft/frequency` `{model, fault_tree, cutoff?}` →
   `{frequency, cutsets, initiators}`;规则违规 → 400 中文 detail;charset。
   canonical 往返锁测:initFreqSource='ft' + `__init__` 树 + frequency 参数无损 + 哈希稳定。
3. **前端**:api.ts `ftFrequency()`(detail-aware);`attachStarterIeFt`(种子 = 单频率事件,
   取现 initFreq → 迁移零意外);BarrierFtModal `frequencyMode`(ftName='__init__' 时:
   调色板"＋频率初因事件",Inspector 参数 kind 选择器 频率(/yr)/概率(使能),量纲徽章);
   `onInitFtClose` 改调 ftFrequency + **共享基本事件 lint**(param_ref 交集→onError 拒绝);
   EtInspector 'ft' 段改为"初因频率(已量化)F = …/yr · n 割集"+规则一行说明。
   toEngineRequest/报告管线不动(composed 标量)。
4. **收口**:verify-psa(py+benchmark+fe+preview 实测)、bundle、ROADMAP、
   对标账本新行(initiating-event fault trees ✅ at-parity;完整序列级 LFT 集成记 future)。

## 2.5 · engine-review 结论(两轮,2026-07-13)

**Round-1 FAIL(6 项)→ 整改(cedacf9)→ Round-2 PASS。** 已修:F1 非相干门(NOT/XOR)
静默错数(曾 +67% 无警告,UI 可达)→ 引擎在**规范化后**的图上拒绝(只拒逻辑上活的
非相干,house 常量消解掉的分支不误伤——审查确认比原始树扫描语义更优);F2 `limit_order`
先截断后校验(规则逃逸+头条静默低估)→ **整体移除**(截断咬的是头条数字本身,与概率
通道不同);F3 独立性 lint 双侧化 + onFtEdited 不再吞错;F4/R-1 负 λ 与负时间参数
(mttr/test_interval/mission_time → q<0)均源头拒绝;F5 保守性归因更正(见 §1 与模块
docstring:共享**初因**才超算,共享使能精确);F6 规则定义在最小化后割集(吸收不改函数)。

**已知限制(诚实记录):**
- **Load-time 独立性残留(review F3/R-2)**:lint 在两条编辑路径(初因树/屏障树模态关闭)
  生效;**已保存的**共享事件项目载入后、触碰任一模态前,序列量化沿用陈旧 composed F_IE
  且无警告。将来补 compose 时或载入时 lint。
- Σ-of-MCS 对共享初因保守(可超物理上界,非稀有使能域);逐初因精确模式记对标账本。
- 频率参数进 MEF 导出(`save_mef_xml`)会撞 unavailability 护栏——MEF 目前只进不出,
  出货 MEF 导出时频率参数需专门映射(review 提示的潜雷)。
- 陈旧客户端若仍发 `limit_order`,pydantic 忽略额外字段 → 得到未截断(更大、保守)的 F。

## 3 · 验收

- 引擎锚点全过;既有 benchmark 24/24 不变;概率通道对频率参数响亮拒绝(新护栏测试)。
- API:合法树返回 F 与割集;双频率割集/无频率树 → 400;utf-8。
- 前端:源=ft 时挂树→关模态→检视器显示频率(Σ 语义,非概率);共享事件被 lint 拒绝;
  序列频率 = F_IE × P(preview 实测对照手算);手动/乘积两源行为逐位不变。
- 往返:ft 源项目 保存→读档→再量化 一致;报告页脚证据链不受影响。
