import type { EventTreeModel, FuncEvent, ConsLevel } from '../../eventtree'
import { buildCascade, CONSEQUENCES } from '../../eventtree'

// 预置 ETA 模板(4c2:自前身工具 docs/reference-assets/templates-eta-claude.ts 逐条迁移)。
// 迁移原则(硬约束 #4):数值/单位/来源/注记逐字保留;分级仅 C/D(内置);频率均为系统级 /yr
// (初因频率语义,无单位换算——注记里的「×电芯数折算」保留为文字,不在代码里再乘)。
// 模板是「可编辑起点」,量化前用户应按项目实测替换取值。
// 结局→后果级映射沿用前身各模板 consequenceLevel:安全 C1/冒烟 C2/局部起火 C3/蔓延 C4/爆炸 C5;
// LOPA 模板结局名与级映射为其自有(见 outcomes 覆盖)。

export type Outcome = 'C1' | 'C2' | 'C3' | 'C4' | 'C5'

export interface TemplateBarrier {
  id: string
  name: string
  category: 'warning' | 'active' | 'passive'
  grade: 'C' | 'D'
  /** 失败分支概率(= 屏障 PFD;前身 branches[失败].probability)。 */
  failProb: number
  /** 该屏障成功时到达的后果级(前身 branches[成功].target 映射)。 */
  successOutcome: Outcome
  /** 来源引用(citation),逐字保留。 */
  source: string
  /** 佐证/口径注记(前身 source.note),并入 evidence 供检视器展示。 */
  note?: string
}

export interface EtaTemplate {
  id: string
  name: string
  category: string
  init: { name: string; frequency: number; grade: 'C' | 'D'; source: string; note?: string }
  barriers: TemplateBarrier[]
  /** 全部屏障失败时的末端后果级。 */
  finalOutcome: Outcome
  /** C1..C5 → 终态文字内涵(前身 outcomes 名称);缺省沿用标准五级。 */
  outcomeNames?: Partial<Record<Outcome, string>>
}

// 前身 stdOutcomes 五级终态口径(多数模板共用)
const STD_OUTCOMES: Record<Outcome, string> = {
  C1: '安全停机', C2: '冒烟(可控热失控)', C3: '局部起火', C4: '火灾蔓延', C5: '爆炸',
}

const B = (id: string, name: string, category: TemplateBarrier['category'], grade: 'C' | 'D',
           failProb: number, successOutcome: Outcome, source: string, note?: string): TemplateBarrier =>
  ({ id, name, category, grade, failProb, successOutcome, source, note })

export const ETA_TEMPLATES: EtaTemplate[] = [
  {
    id: 'bess-thermal-runaway', name: 'BESS 电芯热失控(通用预置)', category: '通用',
    init: { name: '单电芯热失控', frequency: 0.05, grade: 'C',
      source: 'EPRI Battery Energy Storage Fire Incident Database (2023);行业公开统计',
      note: '按 1×10⁻⁷/cell·yr × 5×10⁵ 电芯(约 10 MWh 级电站)估算为系统级频率' },
    barriers: [
      B('warning', '早期预警(AI/气体)并及时处置', 'warning', 'D', 0.1, 'C1', 'BESS 故障预警算法公开文献综述', '示例参考值'),
      B('active', 'BMS 主动保护(过温/过流停机)', 'active', 'D', 0.05, 'C2', 'IEC 61508 SIL 能力类比', 'PFD 10⁻¹–10⁻² 区间取参考值'),
      B('fire-sup', '舱级消防抑制(气体灭火)', 'passive', 'C', 0.1, 'C3', 'NFPA 855; FM Global Data Sheet 5-33'),
      B('insulation', '模组/簇间隔热阻隔', 'passive', 'D', 0.15, 'C3', 'UL 9540A 单元级测试通过设计', '示例参考值'),
      B('explosion-vent', '防爆泄压', 'passive', 'D', 0.1, 'C4', 'NFPA 68 (Deflagration Venting)'),
    ],
    finalOutcome: 'C5',
  },
  {
    id: 'bess-lopa-crossdomain', name: 'BESS 热失控(跨领域 LOPA 取值)', category: 'LOPA',
    init: { name: '单舱热失控初始事件', frequency: 1e-2, grade: 'C',
      source: 'DNV GL BESS QRA (2019);跨领域可靠性综述 §7',
      note: '按 10⁴ 颗电芯 × 1×10⁻⁶/颗·年(一般电芯)自下而上构造,落于 DNV 无防护区间 10⁻¹–10⁻²/年' },
    barriers: [
      B('detect', '探测与预警(BMS/气体+响应)', 'warning', 'C', 0.1, 'C1', 'CCPS LOPA "报警+操作员响应"通用值', 'PFD₁=0.1'),
      B('suppress', '灭火/抑制(湿式喷淋折算)', 'passive', 'C', 0.1, 'C2', 'NFPA 喷淋统计折算', 'PFD₂≈0.1(综合有效率 88–91%)'),
      B('vent', '排爆通风(SIL 2 级)', 'passive', 'C', 0.01, 'C4', 'IEC 61511;DNV GL QRA (2019)',
        'PFD₃=0.01;链式简化:综述原文"探测失败→抑制不可用"的分叉结构可用双树精确复现(树1 IE×0.9 探测成功链,树2 IE×0.1 探测失败链)'),
    ],
    finalOutcome: 'C5',
    outcomeNames: { C1: 'C1 受控事件', C2: 'C2 舱内火灾(排气受控)', C3: 'C3 火灾+爆燃风险', C4: 'C4 级联蔓延火灾', C5: 'C5 舱体爆炸' },
  },
  {
    id: 'bess-ie-isc', name: '内短路热失控事件树(预置)', category: '初因',
    init: { name: '电芯内短路致热失控', frequency: 0.05, grade: 'C',
      source: 'EPRI BESS Failure Incident Database;库条目 cell-thermal-runaway',
      note: '1×10⁻⁷/cell·yr × 5×10⁵ 电芯(约 10 MWh 级)折算系统级频率' },
    barriers: [
      B('tr-detect', '热失控多参量检测(气/烟/压)', 'warning', 'C', 0.05, 'C1', 'Frontiers in Physics (2025);Sandia VOC 验证 (2024)', '库条目 warn-tr-multi,PFD 0.05'),
      B('cooling', '液冷全速降温', 'active', 'D', 0.1, 'C2', 'UL 9540A 浸没对照测试 (EticaAG 2023)', '库条目 act-liquid-cooling-max,PFD 0.1'),
      B('cell-vent', '电芯防爆阀开阀', 'passive', 'D', 0.02, 'C3', 'NREL 71248 (2018)', '库条目 pas-cell-vent,失效 2%'),
      B('gas-sup', '舱级气体灭火', 'passive', 'C', 0.1, 'C3', 'NFPA 855; FM Global Data Sheet 5-33', '库条目 pas-gas-suppression'),
    ],
    finalOutcome: 'C4',
  },
  {
    id: 'bess-ie-insulation', name: '绝缘失效事件树(预置)', category: '初因',
    init: { name: '直流侧绝缘失效', frequency: 2e-2, grade: 'D',
      source: 'IEEE Std 493-2007;GB 51048-2014', note: '库条目 sys-insulation-fault,推断值' },
    barriers: [
      B('imd', 'IMD 绝缘监测报警', 'warning', 'D', 0.05, 'C1', 'ABB 白皮书 (2022);GB 51048-2014 第 7 章', '库条目 warn-imd,漏检 5%'),
      B('relay', '断开主继电器/接触器', 'active', 'D', 0.01, 'C1', 'IEC 61511-1:2016 SIL 1', '库条目 act-main-relay,PFD 0.01'),
      B('barrier', '模组/簇间隔热阻隔', 'passive', 'D', 0.15, 'C3', 'UL 9540A 单元级测试通过设计', '库条目 pas-thermal-barrier'),
    ],
    finalOutcome: 'C4',
  },
  {
    id: 'bess-ie-overcharge', name: '电池过充事件树(预置)', category: '初因',
    init: { name: 'BMS 失效致过充', frequency: 1e-2, grade: 'C',
      source: 'EPRI 2024 白皮书(控制系统占 46% 根因)', note: '库条目 sys-bms-overcharge' },
    barriers: [
      B('high-temp', '高温预警(温度阈值)', 'warning', 'D', 0.1, 'C1', 'IEC 61511 BPCS 类比;Springer (2022)', '库条目 warn-high-temp,PFD 0.1'),
      B('protect', '过充保护切断(BMS+硬件冗余)', 'active', 'D', 0.01, 'C1', 'IEC 62619:2022 cl.5.4', '库条目 act-overcharge-protect,PFD 0.01'),
      B('relay', '断开主继电器/接触器', 'active', 'D', 0.01, 'C2', 'IEC 61511-1:2016 SIL 1', '库条目 act-main-relay,PFD 0.01'),
      B('cell-vent', '电芯防爆阀开阀', 'passive', 'D', 0.02, 'C3', 'NREL 71248 (2018)', '库条目 pas-cell-vent,失效 2%'),
    ],
    finalOutcome: 'C5',
  },
  {
    id: 'bess-ie-ext-heat', name: '异常热源事件树(预置)', category: '初因',
    init: { name: '异常外部热源/邻舱火灾', frequency: 1e-3, grade: 'D',
      source: 'NFPA 855 (2023);EPRI BESS Failure DB', note: '库条目 sys-external-heat,推断值' },
    barriers: [
      B('high-temp', '高温预警(温度阈值)', 'warning', 'D', 0.1, 'C1', 'IEC 61511 BPCS 类比;Springer (2022)', '库条目 warn-high-temp,PFD 0.1'),
      B('cooling', '液冷全速降温', 'active', 'D', 0.1, 'C1', 'UL 9540A 浸没对照测试 (EticaAG 2023)', '库条目 act-liquid-cooling-max,PFD 0.1'),
      B('immersion', '浸润式 Pack(浸没式冷却)', 'passive', 'C', 0.02, 'C2', 'EticaAG UL 9540A 浸没式测试 (2023)', '库条目 pas-immersion-pack,阻断失败 2%'),
      B('gas-sup', '舱级气体灭火', 'passive', 'C', 0.1, 'C3', 'NFPA 855; FM Global Data Sheet 5-33', '库条目 pas-gas-suppression'),
    ],
    finalOutcome: 'C4',
  },
  {
    id: 'bess-case-mcmicken', name: 'APS McMicken 2019 对标(真实事故复现)', category: '案例对标',
    init: { name: '单电芯内短路致热失控', frequency: 5e-3, grade: 'D',
      source: 'DNV GL《McMicken Battery Energy Storage System Event: Technical Analysis and Recommendations》(2020)',
      note: 'McMicken ~2 MWh LG NMC;DNV:模组内电芯异常析锂→内短触发 TR。频率按内短率×电芯数估算,仅示意;对标重点是条件结构而非 IE 频率。反循环原则:仅把 DNV 记录的物理配置事实(无电芯间热障、无泄爆/排风)编码为近失败,其余取库通用先验;详见 docs/案例对标-McMicken-2019.md' },
    barriers: [
      B('detect', '早期离气探测+联动停机', 'warning', 'D', 0.1, 'C1', '库条目 warn-offgas-voc;DNV McMicken 报告', '口径=TR 已触发时阻止升级,略低于探测可靠性;McMicken 探测有限、未触发有效干预'),
      B('bms', 'BMS 切断/隔离', 'active', 'D', 0.1, 'C2', '库条目 act-main-relay', '单芯 TR 已自持,BMS 切断仅部分阻断模组级联'),
      B('thermal', '电芯间热障阻断蔓延', 'passive', 'D', 0.95, 'C3', '库条目 pas-thermal-barrier;DNV McMicken 根因③', '设计事实:McMicken 电芯间无热障→近确定级联;失败率 0.95 表征装备缺失(反事实复原至库先验 0.85 成功/0.15 失败)'),
      B('suppress', '舱级灭火(Novec 1230)', 'passive', 'D', 0.7, 'C3', '库条目 pas-gas-suppression;DNV McMicken 根因②', 'Novec 1230 已喷放但对热失控链无效(洁净剂降温/阻断有限),成功率取 0.3(失败 0.7)'),
      B('vent', '泄爆/防爆(NFPA 68/69)', 'passive', 'D', 0.95, 'C4', '库条目 pas-explosion-vent;DNV McMicken 根因④', '设计事实:无泄爆/排风,可燃离气积聚→失败率 0.95 表征缺失(反事实复原至库先验 0.90 成功/0.10 失败)'),
      B('response', '应急响应(避免开门引气)', 'active', 'D', 0.3, 'C4', '库条目 act-emergency-response;DNV McMicken 根因⑤', '人因屏障,库先验 0.7 未 rig;McMicken 实况:消防员开门 2–3 min 内引爆,留待反事实/敏感性体现'),
    ],
    finalOutcome: 'C5',
  },
]

/** 稳定 fe id:模板前缀 + 屏障 id,非字母数字转下划线并大写(引擎内唯一性)。 */
function feId(templateId: string, barrierId: string): string {
  return (templateId.replace(/^bess-?/, '') + '_' + barrierId).replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()
}

/** 把预置模板转成可编辑的 EventTreeModel(级联结构 + 逐屏障成功后果 + 逐屏障/初因溯源 + 终态文字)。 */
export function templateToEtaModel(t: EtaTemplate): EventTreeModel {
  const fes: FuncEvent[] = t.barriers.map((b) => ({
    id: feId(t.id, b.id),
    label: b.name,
    failProb: b.failProb,
    grade: b.grade,
    source: b.source,
    ...(b.note ? { evidence: b.note } : {}),
  }))
  // consAtDepth 长度 = n+1:depth d 成功叶 = 屏障 d 的成功后果;末端全失败 = finalOutcome
  const consAtDepth = [...t.barriers.map((b) => b.successOutcome), t.finalOutcome]
  const names = { ...STD_OUTCOMES, ...(t.outcomeNames ?? {}) }
  return {
    initEvent: t.init.name,
    initFreq: t.init.frequency,
    initFreqSource: 'manual',
    functionalEvents: fes,
    root: buildCascade(fes, consAtDepth),
    // 终态文字随模板带入(defect 4/R1):写现代 consequences(展示路径 consText 读取的字段),
    // 并留 consequenceDefs 兼容旧序列化——建页即正确,不再落回默认口径。
    consequences: CONSEQUENCES.map((c) => ({ id: c, desc: names[c as ConsLevel], level: c as ConsLevel })),
    consequenceDefs: names,
    initSource: t.init.source,                  // 初因溯源随模型带入(defect 2:证据链首环)
    initGrade: t.init.grade,
    ...(t.init.note ? { initEvidence: t.init.note } : {}),
  }
}

export interface TemplateInfo { id: string; name: string; category: string }
export const listTemplates = (): TemplateInfo[] =>
  ETA_TEMPLATES.map((t) => ({ id: t.id, name: t.name, category: t.category }))

export const getTemplate = (id: string): EtaTemplate | undefined => ETA_TEMPLATES.find((t) => t.id === id)
