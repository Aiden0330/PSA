# 参考数据来源校核报告(builtin 参考库溯源评审)

- **日期**:2026-07-08
- **对象**:`bess/reference_data.json`(v0.2,内置参考库),及其量化消费链 `bess/scenarios.json` / `bess/scenarios.py` / `bess/tr_model_data.json`
- **评审依据**:`.claude/skills/eta-reference-data/SKILL.md`(分级/单位/口径规则)、`.claude/skills/regulatory-traceability/SKILL.md`(证据链标准)、`.claude/skills/bess-tr-model/`(屏障物理与先验出处)、`tests/test_library.py`(守护测试)
- **性质**:只读评审,未改动任何源文件。本报告为 Phase 2 存储/审计 ADR 输入,对应 ROADMAP 事项「参考数据来源校核」。
- **评审口径**:五镜头 ——① citation 可定位性 ②来源是否支撑该数值/该单位/该定级 ③分级规则符合性 ④note 质量(D 级推断逻辑;预警类口径/误报率/提前量)⑤内部一致性(去重残留、单位、家族量级)。

---

## 一、概览统计

### 1.1 条目规模与分级分布

| 分区 | 条目数 | C 级 | D 级 | 无 grade |
|---|---|---|---|---|
| component_failure_rates(器件失效率) | 41 | 11 | 30 | 0 |
| barrier_effectiveness(屏障有效性) | 51 | 21 | 30 | 0 |
| initiating_events(初因频率) | 5 | 0 | 0 | **5** |
| 合计 | **97** | 32 | 60 | 5 |

守护测试(`tests/test_library.py`)现状:citation 非空、pfd∈(0,1)、rate/freq>0、grade∈{C,D} 均通过 —— 但 **grade 检查不覆盖 initiating_events 分区**,IE 五条无 grade 字段而测试静默放行(见 F1)。

### 1.2 问题按类型计数

| 类型 | 计数 | 说明 |
|---|---|---|
| ① citation 不可定位(缺来源名+年份) | ≈28 条 | 13 条匿名 FMEA 批次 + 8 条电芯分档"公开文献/综述"+ warn-threshold、B_GAS_DET、sup-aerosol、sup-pack-direct、warn-consistency-slow、warn-isc-progressive、act-liquid-cooling-max;其中 1 条为 C 级(cell-tr-typical) |
| ② 来源不支撑数值/单位/口径 | ≈16 条 | 含全部 5 条 IE(事故报告不含频率)、B_OFFGAS、B_SPACING、B_SUPPRESS、B_DEFLAG(η 挂错屏障)、pas-immersion-pack、cell-lfp-fresh、CFR_CELL_TR(EPRI 不发布 /cell·yr)、cell-tr-premium、lopa-flame-arrester(与源表值不符,偏保守) |
| ③ 分级违规或偏高 | 7–9 条 + IE×5 | C 级应降 D:B_OFFGAS、B_SPACING、B_SUPPRESS、pas-immersion-pack、sys-bms-overcharge、cell-tr-typical、cell-lfp-fresh(cell-tr-premium/defective 边界);IE 无级 |
| ④ note 质量缺陷 | D 无推断逻辑 5 条;预警口径缺失 12/15;误报率 0/15 | B_GAS_DET、pas-explosion-vent 完全无 note;warn-threshold、pas-thermal-barrier、pas-vent 仅"示例参考值"占位 |
| ⑤ 内部一致性 | 家族量级分歧 6 组;双源真值 2 处;陈旧交叉引用 2 处;库外硬编码矛盾 1 处 | 详见 F3/F9/F13 |
| 厂商来源违规(既定规则:厂商宣称不作证据) | 5 条 | warn-offgas-voc、warn-imd、act-main-relay、act-liquid-cooling-max、pas-immersion-pack |

**总体画像**:约 60% 条目(全部 D 级 + IE)本质是推断/类比值,这与"演示与初步筛查"定位及免责声明一致、可辩护;真正危险的是少数 **C 级标签下的推断值** 和 **无口径的载荷条目**(IE、B_OFFGAS)—— 评审人会先抽查这些。

---

## 二、按严重度排序的发现

判定用语:**[错误]** = 现状不可辩护,须改;**[须记录]** = 可辩护,但推断/口径必须显式写入条目才能过评审。

### 高危(直接影响载荷数字的可辩护性)

**F1 [错误] initiating_events 全部 5 条:无 grade、无 unit、引用不支撑数值**
- 条目:`IE_ISC`(1e-3)、`IE_COOLANT`(1e-3)、`IE_OVERCHARGE`(1e-3)、`IE_EXT_FIRE`(5e-4)、`IE_MECH_WATER`(5e-4)。全部被 5 个内置场景直接用作序列频率乘数(`scenarios.py:77`)。
- 问题:(a) 频率无单位字段——/unit·yr?/舱·yr?/site·yr?口径未声明,而"单位是载荷"是本库第一硬规则;(b) 无 grade,`test_grade_present_and_valid` 只查两个分区,IE 静默豁免;(c) citation 均为事故调查/标准(McMicken、Victorian Big Battery、韩国联合调查、NFPA 855)——事故报告给机理不给频率,标准不含频率,来源不支撑数值;(d) 数值推导不在 note 中(IE_ISC=1e-3 其实与库内 1e-7/cell·yr × 10⁴ cells 的乘积维度映射自洽,但这条推导链没写下来,评审时答不出"1e-3 哪来的")。
- 建议修正:为 IE 分区补 `unit`("/unit·yr")与 `grade`(按现状全部 D),note 写明推导(IE_ISC:cell 率 × 电芯数的产品维度映射;IE_OVERCHARGE:韩国 23 起/约 1490 站·2 年 ≈ 7.7e-3/站·yr 全因 → 过充子集取 1e-3 的拆分逻辑);把 `test_grade_present_and_valid` 扩到 IE 分区。

**F2 [错误] `B_OFFGAS`(pfd 0.01,C):定级、数值、口径三重不可辩护——且方向为非保守**
- 载荷:4/5 场景的首分支(SC_ISC/SC_COOLANT/SC_MECH_WATER 首位,SC_OVERCHARGE 次位),其 PFD 是所有 C2+ 序列的公共乘数,**取低即系统性低估严重后果频率**。
- 问题:(a) citation "IEEE/CCPS LOPA; UL 9540A 排气特性研究"——UL 9540A 排气研究表征气体成分,不含探测可靠性,支撑不了任何 PFD;真实链条(经网络核验,见 §四-1)是 Moa & Go 2023 转引 Gully 2019(DNV GL)的过程工业式表值,属跨行业移植 → 按本库规则(类比/推断)应为 **D 并在 note 记推断逻辑**,不是 C;(b) 与库内全部 BESS 专项探测条目冲突:warn-offgas-voc 0.05、warn-gas-voc-early 0.05(Sandia 实测)、warn-tr-multi 0.05、B_GAS_DET/warn-gas-h2 0.07——同一物理功能自家库给 0.05–0.07,唯独载荷条目给 0.01,低 5–7 倍无解释;(c) 与自己的分解树矛盾:SC_ISC 中 `offgas_shared` 故障树给出 1−(1−0.008)(1−0.06)≈**0.068**,同一屏障跨场景差 6.8 倍(见 F3);(d) 预警类条目 note 无事件级召回口径、无误报率(有提前量)。
- 建议修正:重锚到 0.05 档(与 Sandia 实测族对齐)或保守取 LOPA 报警+操作员 0.1;降 D 并写明移植链;若坚持 0.01 必须给出 BESS 专项事件级召回证据。同步修 SC_ISC 分解树参数使两条路径一致。

**F3 [错误] `bess/scenarios.py:36-61` 四个硬编码故障树参数绕过参考库治理,且与库内条目自相矛盾**
- 参数:`BMS_SENSOR_FAIL`=0.03、`BMS_LOGIC_FAIL`=0.01、`BMS_CONTACTOR_FAIL`=0.06、`OFFGAS_DET_FAIL`=0.008,citation 为裸字符串,无 grade、无 unit、无 note,不进参考库、不受守护测试与去重规则约束——违反证据链标准"报告数字→数据条目(值+单位+级+citation)"的链条(这些数字直接进 SC_ISC/SC_OVERCHARGE 的序列频率)。
- 内部矛盾:`BMS_CONTACTOR_FAIL`=0.06 标注"OREDA/exida 接触器拒动",而库内 `CFR_CONTACTOR`=**0.001/demand** 引用同一来源——同一来源两个数字差 **60 倍**。0.06/demand 的接触器拒动率没有任何手册支撑;0.001/demand 才是 OREDA/exida 量级。(0.06 疑为凑 B_BMS≈0.1 的分配值:0.03∨0.01∨0.06≈0.097。)
- 建议修正:把四个参数迁入 reference_data.json 作正式条目(grade/unit/note 齐备),分解树按 id 引用;接触器取 1e-3/demand 档后 B_BMS 分解值会掉到 ≈0.04,若要维持 0.1 总值,须显式说明其余部分(逻辑/软件/整定)的分配依据,而不是把差额塞给接触器。

**F4 [错误] `pas-immersion-pack`(pfd 0.02,C):厂商单次测试定 C 级 + n=1 推 PFD 0.02,双重不可辩护**
- 问题:(a) citation 与 url 均为 EticaAG(被测产品厂商)自发布页面,违反"厂商宣称不作证据"既定规则;网络核验(§四-8):测试存在,但正式 UL 9540A 传播数据来自**移除浸没液**的配置,带液配置只是"115 min 未触发排气"的单次结果;(b) 单次成功试验在统计上支撑不了 PFD=0.02(n=1 零失败的 Jeffreys 后验均值 ≈0.25,90% 上限更高)——0.02 是工程先验,不是该测试的统计结论;(c) 定级规则允许"UL 9540A 第三方报告"为 C,但可引用物应是第三方出具的测试报告本身(含编号),不是厂商营销页。
- 建议修正:降 D;citation 改为具体 UL 9540A 报告(如可获得)+ ACS Appl. Energy Mater. 2023 文献;note 改写为"单次测试佐证机理,0.02 为工程先验,须多次试验/现场数据贝叶斯更新"。

**F5 [错误+须记录] `B_DEFLAG`(pfd 0.1 + eff 0.953,C):η 挂错屏障;eff 被量化器静默忽略(非保守);与 `pas-explosion-vent` 同值不同级**
- η 错挂:网络核验(§四-1/3)确认 η=0.953 在 Moa & Go 2023 / Landucci 2017 中是**主动灭火(Active Fire Suppression)**在过程设施骨牌场景下的有效性,不是泄爆/防爆装置的;bess-tr-model 技能自己的先验表也把 η=0.953 记在"主动灭火"行。挂到 B_DEFLAG(舱内泄爆/防爆)是移植错位。
- eff 被忽略:`scenarios.py:97` 只读 `pfd`,eff 不参与量化;tr_model_data.json 声明的"三结果分支(启动且有效/未启动/启动无效)"未实现。若 eff 语义成立,当前二叉模型把"启动但无效"(0.9×0.047≈4.2%)计入成功,等效失效概率应为 ≈0.142 而非 0.1,**低估约 1.4 倍,非保守**。
- 一致性:`pas-explosion-vent`(NFPA 68 泄爆板)同为 0.1 却是 D 级——同功能同值不同级,暴露 B_DEFLAG 的 C 属定级偏高(LOPA/DNV 移植 → 按规则应 D)。
- 建议修正:eff=0.953 移到主动灭火条目(B_SUPPRESS/pas-fk-clean-agent)或删除;B_DEFLAG 降 D 并 note 写明 LOPA 移植;三结果分支要么实现、要么在模型假设中声明"未建模启动无效,方向非保守"。

### 中危(定级/来源纪律问题,数值多在合理量级)

**F6 [错误] C 级标签下的标准/推断值(标准不含统计,不能支撑 C)**
- `B_SPACING`(0.1,C,"NFPA 855 默认 ≥3ft/914mm"):标准给的是间距要求,不是失效概率;0.1 是假设 → 降 D + 推断 note。载荷条目(3 场景)。
- `B_SUPPRESS`(0.1,C,"NFPA 855; FM Global 数据表 5-33"):两者均为设计/安装文件,不含 PFD 统计;数值实为 LOPA 通用档 → 降 D,或改引 NFPA 灭火有效性统计(§四-6 已验证该统计存在,可支撑 C 但数值口径要对齐)。
- `sys-bms-overcharge`(0.01,C):EPRI 白皮书真实(§四-4),但 0.2 次/GW·yr(全因)→ 1%/unit·yr(过充)的"工程折算"是多步推断且算术不透明(按 3–5 MWh 舱折算应 ≈1e-3/unit·yr 量级,现值偏保守 10 倍)→ 降 D,note 写明折算假设;或把折算式写全保 C 的引用部分。
- `cell-tr-typical`(1e-6,C,"行业通用引用值(跨领域可靠性综述表 3)"):citation 无作者/年份/出处,不可定位——C 级必须可定位 → 补齐(疑即 Moa & Go 2023 一类综述)或降 D。
- `cell-lfp-fresh`(1e-7,C):EPRI 数据库不发布 /cell·yr 口径(§四-4),"0.1–1 ppm/电芯·年"归属 EPRI 不成立;且 citation 含内部技能文档("eta-data-cells 分档示范")——内部文档不是来源 → 改归属(行业 ppm 级共识的真实出处)或降 D。同理 `CFR_CELL_TR` 的 note 将 ppm 级归 EPRI 属来源错位(数值量级本身是行业共识,可辩护,但归属要改)。
- `cell-tr-premium`(1e-7,C,"Battery University BU-304a; American Clean Power(2012 年估计)"):American Clean Power 2021 年才成立,"2012 年估计"归属时代错位;Battery University 为二手汇编,C 级边界 → 修正归属(US DOE/行业估计的原始出处)并考虑降 D。

**F7 [错误] 厂商来源作证据(既定规则违规),共 5 条**
- `warn-offgas-voc`:首引"Honeywell Li-ion Tamer 产品验证"(厂商自证)。修正路径现成:Sandia 2024 JES 论文(§四-7)恰好第三方测试了 Li-ion Tamer——换引即可,值可保留。
- `warn-imd`:首引 ABB 白皮书(厂商)。GB 51048 只支撑功能要求不含数值 → 保 D,citation 换为独立文献或 note 明示"暂无第三方来源,纯推断"。
- `act-main-relay`:引 eInfochips 博客(厂商服务商)。IEC 61511 SIL1 类比即可自洽,删博客引。
- `act-liquid-cooling-max`:引 EticaAG 页面 +"ScienceDirect 2023"(无作者题名)。补具体文献或改纯推断表述。
- `pas-immersion-pack`:见 F4。

**F8 [错误] 13 条匿名"储能系统基本事件失效率分配表(2026-06,行业 FMEA)"批次:出处外部不可核验**
- 条目:`bmic-chip-fault`、`volt-sample-fault`、`bcu-board-hw`、`rpcb-device-short`、`rpcb-arc`、`bmu-board-short`、`liquid-ctrl-logic`、`coolant-pipe-corrosion`、`heat-exchanger-fault`、`coolant-pump-fault`、`cold-plate-corrosion`、`temp-sensor-outlet`、`temp-sensor-inlet`(另 `pack-cell-inconsistency`、`pack-busbar-break`、`busbar-virtual-joint`、`enclosure-water-ingress`、`lightning-strike` 同源,共 18 条同 citation)。
- 问题:"分配表"无机构、无文档号、无发布形态——评审人问"谁的表?"无法回答;三位有效数字(2.96e-6、1.75e-5、7.84e-6…)呈虚假精度;若该表实为某厂商内部 FMEA 分配,则按规则属 B 类(仅用户层),**根本不允许进 builtin**。
- 建议修正:二选一——(a) 补全出处(机构+文档名+版本),保 D;(b) 移出 builtin 到用户层。保留时 note 加"分配值非实测,精度为表内原样,不代表统计置信"。

**F9 [须记录] 家族量级分歧与双源真值(去重后残留的一致性缺口)**
- `IE_OVERCHARGE` 1e-3 vs `sys-bms-overcharge` 1e-2:同语义差 10 倍,无交叉引用说明。
- `IE_EXT_FIRE` 5e-4 vs `sys-external-heat` 1e-3:差 2 倍。
- `IE_MECH_WATER` 5e-4 vs `sys-mechanical-abuse` 1e-4 + `enclosure-water-ingress` 1.8e-6:差约 4 倍。
- `IE_COOLANT` 1e-3 vs `cooling-water-loss` 0.1 / `CFR_COOLANT` 0.088:差 100 倍——实际隐含 P(电弧/外短|泄漏)≈0.01 的条件概率,从未写下。
- `B_RESPONSE`:reference_data.json 0.3 vs tr_model_data.json pfd_prior 0.10——两处真值,量化走库值 0.3(更保守,方向对),但 tr_model_data 已陈旧。IE 五条频率同样在两文件重复维护。
- `B_SUPPRESS` 0.1/C vs `pas-fk-clean-agent` 0.15/C:同为 FK-5-1-12,值不同、无互引,近重复。
- 建议修正:每组在 note 中互引并写明关系(总率 vs 子集、条件概率、层级差);tr_model_data.json 的 pfd_prior 与库值同步或声明"以 reference_data 为准";FK 两条按 2026-06-26 去重先例合并或明确分工(泛指舱级 vs 专项)。

**F10 [须记录] `act-overcharge-protect`(0.01,D):冗余降额未计 CCF,独立性假设未声明**
- note "软件层 PFD≈0.1,叠加独立硬件截止冗余降至 0.01" 隐含完全独立;若 β≈10%,系统 PFD ≈ 0.1×0.1 + 0.1×0.1 ≈ 0.02,现值偏乐观约 2 倍,方向非保守。D 级推断已记录,故为"须记录":note 补"未计共因,β=0.1 时约 0.02"或直接取 0.02。

### 低危(文档纪律,不改数值)

**F11 [须记录] 预警类口径缺失面广**:15 条 warning 类中仅 3 条(`warn-gas-voc-early`、`warn-consistency-slow`、`warn-isc-progressive`)显式写"事件级(召回)口径";**误报率 0/15 记录**(SKILL 要求记 note);`B_AI_WARN`、`B_GAS_DET`、`warn-threshold`、`warn-high-temp`、`warn-imd`、`warn-vesda-smoke`、`warn-flame-detector`、`lopa-alarm-operator` 等口径/误报率/提前量三缺一或全缺。建议按 data-warning.md 推荐格式批量补 note。
**F12 [错误(规则)] D 级无推断逻辑**:`B_GAS_DET`、`pas-explosion-vent` 完全无 note;`warn-threshold`、`pas-thermal-barrier`、`pas-vent` 仅"示例参考值"占位——违反"D 级推断逻辑写入 note"硬规则,逐条补写。
**F13 [须记录] 陈旧交叉引用与遗留痕迹**:`pas-fk-clean-agent` note 引"pas-gas-suppression(0.9)"——该 id 已在去重中更名(现 `B_SUPPRESS`);`liquid-ctrl-logic` note 引"liquid-cooling-loss"——库内实际 id 为 `cooling-water-loss`/`CFR_COOLANT`;`meta.extends` 仍写"D:/ETA_claude" Windows 路径。
**F14 [须记录] `lopa-flame-arrester`(0.1,C)与 CCPS LOPA 表值(阻火器典型 1e-2)不符**——方向保守,允许,但 note 须写"较 LOPA 表值保守取 0.1 的理由",否则是"引用了却不照引"的口实。
**F15 [须记录] `vent-sil2` 类别标为 passive**,但 SIL 定级只适用于仪表化(主动)功能——category 应为 active,否则下游探测/CCF 处理口径错位。
**F16 [须记录] `CFR_CONTACTOR` 单位 /demand 混在失效率分区**(其余为 /cell·yr、/unit·yr)——单位显式、不算违规,但产品维度映射与年化换算的消费方须防混用;note 可加"per-demand,勿年化"。`CFR_BMS` 引 NPRD(非电子件手册)支撑"电子模块"量级,宜改 EPRD 或 IEEE 493 主引。

---

## 三、场景引用条目溯源状态表(载荷条目)

5 个内置场景(SC_ISC/SC_OVERCHARGE/SC_COOLANT/SC_EXT_FIRE/SC_MECH_WATER)的量化仅消费下列数字(`bess/scenarios.py`):

| id | 用于场景数 | 值/单位 | grade | citation 可定位 | 来源支撑数值 | 口径/note | 判定 |
|---|---|---|---|---|---|---|---|
| B_OFFGAS | 4(首分支×3) | pfd 0.01 | C | 部分(真实链为 Moa&Go→Gully,未写) | **否**(跨行业移植+与家族矛盾) | 缺口径/误报率 | **修正**(F2) |
| B_BMS | 4 | pfd 0.1 | D | 是(Gully 2019 DNV GL,已核验存在) | 是(先验,类比) | 有 note ✓ | 可辩护 |
| B_THERMAL | 5 | pfd 0.1 | D | 是(Gully 2019;UL 9540A) | 是(先验,类比) | 有 note ✓ | 可辩护 |
| B_DEFLAG | 5 | pfd 0.1(eff 0.953 未用) | C | 是 | PFD 部分;**η 挂错屏障** | 有 note | **修正**(F5) |
| B_SPACING | 3 | pfd 0.1 | C | 是(NFPA 855) | **否**(标准无概率) | note 单薄 | **修正**(F6) |
| B_RESPONSE | 2 | pfd 0.3 | D | 是(McMicken/NFPA 855/LOPA) | 是(人因推断,逻辑完整) | 优秀 ✓ | 可辩护(与 tr_model_data 0.1 双源须同步,F9) |
| IE_ISC | 1 | 1e-3(无单位) | 无 | 事故报告可定位 | **否**(报告无频率) | 推导缺失 | **修正**(F1) |
| IE_COOLANT | 1 | 1e-3(无单位) | 无 | 同上 | **否** | 缺条件概率链 | **修正**(F1/F9) |
| IE_OVERCHARGE | 1 | 1e-3(无单位) | 无 | 同上 | **否** | 与 sys-bms-overcharge 差 10× | **修正**(F1/F9) |
| IE_EXT_FIRE | 1 | 5e-4(无单位) | 无 | NFPA 855 可定位 | **否** | 与 sys-external-heat 差 2× | **修正**(F1/F9) |
| IE_MECH_WATER | 1 | 5e-4(无单位) | 无 | 事故报告可定位 | **否** | 家族差 4× | **修正**(F1/F9) |

**库外载荷参数**(`scenarios.py` 硬编码,SC_ISC/SC_OVERCHARGE):

| 参数 | 值 | 治理状态 | 判定 |
|---|---|---|---|
| BMS_SENSOR_FAIL | 0.03 | 裸字符串引用,无 grade/unit/note | 迁入库(F3) |
| BMS_LOGIC_FAIL | 0.01 | 同上 | 迁入库(F3) |
| BMS_CONTACTOR_FAIL | 0.06 | 同上;**与 CFR_CONTACTOR(1e-3/demand,同引 OREDA/exida)矛盾 60×** | **修正**(F3) |
| OFFGAS_DET_FAIL | 0.008 | 同上;组合后 B_OFFGAS≈0.068 vs 库值 0.01 | **修正**(F2/F3) |

---

## 四、网络核验结果(8 项)

1. **Moa & Go (2023), "Large-scale energy storage system: safety and risk assessment", Sustainable Energy Research 10:13** — 存在(DOI 10.1186/s40807-023-00082-z)。全文确认含屏障 PFD 表(Table 8),主要转引 Gully (2019);并明确"Active Fire Suppression 的有效性 η=0.953"归 Landucci et al. (2017)。→ B_* 先验链条真实,但属过程工业/骨牌场景移植;η 的归属对象是主动灭火,不是泄爆(支撑 F2/F5)。
2. **Gully, B. (2019), DNV GL "Technical reference for li-ion battery explosion risk and fire suppression"** — 经 Moa & Go 引文确认存在。B_BMS/B_THERMAL 的"DNV/Gully 2019"引用成立(建议 citation 补全为该题名)。
3. **Landucci et al. (2017)(骨牌场景缓解屏障风险评估文献族)** — 存在(Reliability Engineering & System Safety 系列,如 10.1016/j.ress.2015.03.023 及 2017 篇);0.953 未在公开页面直接见到,经 Moa & Go 转引确认;对象为过程设施主动灭火系统(支撑 F5)。
4. **EPRI "Insights from EPRI's BESS Failure Incident Database"(2024-05-10 白皮书,含 storagewiki)** — 存在:81 起事件、26 起可定根因;控制系统+BOS 占 89%(其中控制系统 46%,与 `sys-bms-overcharge` note 的 46% 一致);电芯本体占比小;失效率大幅下降的表述成立。**EPRI 不发布 /cell·yr 口径的电芯失效率** → CFR_CELL_TR/cell-lfp-fresh 把 ppm/电芯·年归 EPRI 不成立(支撑 F6)。
5. **DOI 10.1007/s40789-022-00494-0(warn-high-temp / act-overcharge-protect 所引 Springer 链接)** — **真实存在**:See, K.W. et al. (2022) "Critical review and functional safety of a battery management system for large-scale lithium-ion battery pack technologies", International Journal of Coal Science & Technology 9:36。发表在煤炭学刊属意外但为真——伪造嫌疑排除;该文支撑定性 BMS 功能安全论述,不含 PFD 数值,两条目按 D 级推断使用是成立的。
6. **NFPA 灭火系统有效性统计(Ahrens/Hall,"U.S. Experience with Sprinklers and Other Fire Protection Extinguishing Equipment",2009,基于 2003–2006 数据)** — 验证:干粉 58%、CO₂ 84%、泡沫 82%、喷淋有效 91%(88–96% 区间)。→ `nfpa-dry-chem` 0.42、`nfpa-co2` 0.16、`nfpa-foam` 0.18、`B_WATER` 0.12 数值与来源吻合,C 级成立;场所口径为一般建筑而非 BESS,条目 note 已含"须按 UL 9540A 校核"提示 ✓。
7. **Sandia 2024 气体探测测试** — 存在:Sandia 团队 2024-02 发表于 J. Electrochem. Soc.("Early Detection of Li-Ion Battery Thermal Runaway Using Commercial Diagnostic Technologies", 10.1149/1945-7111/ad2440),第三方测试了 Li-ion Tamer(VOC)等商用探测手段。→ `warn-gas-voc-early`/`warn-tr-multi` 的 Sandia 引用有实体,建议 citation 落到该论文(作者/期刊/DOI);"8.5 min 提前量"具体数字未能在公开摘要层核验,引用时注明出处页码。NevadaNano 自有材料为厂商来源,不宜单独作证据。
8. **EticaAG UL 9540A 浸没式测试** — 测试存在但为厂商自发布:带浸没液加热 115 min 起始电芯未排气;**正式 UL 9540A 传播数据来自移除浸没液的配置**;"危害评分 0.206 vs 0.955"未在公开页核验。→ 单次厂商发布测试不能支撑 C 级与 PFD 0.02(支撑 F4)。

主要来源:[Moa & Go 2023](https://link.springer.com/article/10.1186/s40807-023-00082-z) · [EPRI 白皮书](https://restservice.epri.com/publicdownload/000000003002030360/0/Product) · [EPRI Storage Wiki](https://storagewiki.epri.com/index.php/BESS_Failure_Incident_Database) · [EPRI/PNNL/TWAICE 通稿](https://www.globenewswire.com/news-release/2024/05/15/2882515/0/en/BESS-Failures-Study-by-EPRI-PNNL-and-TWAICE-Shows-Quality-Assurance-and-Battery-Monitoring-Could-Prevent-Majority-of-Failures.html) · [See et al. 2022](https://link.springer.com/article/10.1007/s40789-022-00494-0) · [NFPA 喷淋报告 PDF](https://nfsa.org/wp-content/uploads/2019/07/US_experience_with_sprinklers_2009.pdf) · [Risk Logic 统计摘录](https://risklogic.com/fire-protection-statistics/) · [Sandia LabNews](https://www.sandia.gov/labnews/2024/10/31/detecting-battery-failures-quicker/) · [JES 论文](https://iopscience.iop.org/article/10.1149/1945-7111/ad2440) · [EticaAG 测试页 1](https://eticaag.com/first-ul9540a-testing-immersion-cooled-battery/) · [EticaAG 测试页 2](https://eticaag.com/ul9540a-immersion-cooling-propagation/) · [Landucci 2015 RESS](https://www.sciencedirect.com/science/article/abs/pii/S0951832015000897) · [Khakzad/Landucci/Reniers 2017](https://www.sciencedirect.com/science/article/abs/pii/S0951832016305828)

---

## 五、结论

**今天能否面对外部评审?——作为"演示与初步筛查"库,可以;作为正式 QRA 数字来源,不可以。** 免责声明在位、41+51+5 全员有 citation、D 级多数条目推断逻辑成文、去重与守护测试机制存在——骨架是监管友好的,多数 D 级条目属"可辩护但须记录"。但评审人前 30 分钟会抽中的恰是现状最弱处:**五条初因频率无单位无级、引用不支撑数值;首分支 B_OFFGAS 的 0.01 比自家库内实测族低 5–7 倍且方向非保守;两个场景的序列频率里混着四个绕过治理、与库内同源条目矛盾 60 倍的硬编码参数**。这三处任一被问到,证据链就断在第一环。修正它们不需要新数据,只需要把已经存在的推导链和真实出处写进条目。

**Top 5 修正(按优先级):**
1. **IE 分区补齐治理**(F1):5 条补 unit/grade/推导 note(显式 cell→system 乘积维度映射与事故统计拆分逻辑),守护测试扩展到 IE 分区;同时消解与 sys-* 家族的 10×/2×/4×/100× 分歧(F9,互引+条件概率写明)。
2. **B_OFFGAS 重锚**(F2):对齐 0.05 档(Sandia 实测族)或保守 0.1;降 D 并写明 Moa&Go→Gully 移植链与事件级口径;同步 SC_ISC 分解树,使同一屏障跨场景一致。
3. **收编 scenarios.py 硬编码参数**(F3):四参数迁入参考库(grade/unit/note 齐备),接触器改 OREDA 量级并重述 B_BMS 分解的分配依据。
4. **清理厂商来源 5 条 + pas-immersion-pack 降级**(F4/F7):Li-ion Tamer 换引 Sandia JES 2024 第三方测试;EticaAG/ABB/eInfochips 引文替换或明示纯推断;n=1 不再冒充统计。
5. **C 级复核批次**(F5/F6):B_SPACING、B_SUPPRESS、sys-bms-overcharge、cell-tr-typical、cell-lfp-fresh(及 cell-tr-premium 归属)降 D 或补可定位统计源;η=0.953 移回主动灭火条目;B_DEFLAG 三结果分支实现或在模型假设中声明省略方向。

修正后 C 级占比会下降、D 级上升——这是诚实化,不是退步:配合免责声明、贝叶斯升级通道(D/C→A)与本报告的核验记录,降级后的库反而更可辩护。次一级整改(F8 匿名 FMEA 批次出处、F11 预警口径批量补 note、F12 D 级空 note、F13 陈旧引用)建议随 Phase 2 存储/审计 ADR 的数据 pedigree 附录一并落实。
