import type { EventTree, Outcome } from '../core/types';

export const OUTCOME_SAFE = 'safe-shutdown';
export const OUTCOME_SMOKE = 'smoke';
export const OUTCOME_LOCAL_FIRE = 'local-fire';
export const OUTCOME_FIRE_SPREAD = 'fire-spread';
export const OUTCOME_EXPLOSION = 'explosion';

const TEMPLATE: EventTree = {
  version: 2,
  id: 'bess-thermal-runaway',
  name: 'BESS 电芯热失控事件树(预置模板)',
  initiatingEvent: {
    id: 'ie-cell-tr',
    name: '单电芯热失控',
    frequency: 0.05,
    grade: 'C',
    source: {
      citation: 'EPRI Battery Energy Storage Fire Incident Database (2023);行业公开统计',
      note: '按 1×10⁻⁷/cell·yr × 5×10⁵ 电芯(约 10 MWh 级电站)估算为系统级频率',
    },
  },
  nodes: [
    {
      id: 'tpl-warning',
      name: '早期预警(AI/气体)并及时处置',
      category: 'warning',
      grade: 'D',
      source: { citation: 'BESS 故障预警算法公开文献综述', note: '示例参考值' },
      branches: [
        { label: '成功', probability: 0.9, target: OUTCOME_SAFE },
        { label: '失败', probability: 0.1, target: 'next' },
      ],
    },
    {
      id: 'tpl-active',
      name: 'BMS 主动保护(过温/过流停机)',
      category: 'active',
      grade: 'D',
      source: { citation: 'IEC 61508 SIL 能力类比', note: 'PFD 10⁻¹–10⁻² 区间取参考值' },
      branches: [
        { label: '成功', probability: 0.95, target: OUTCOME_SMOKE },
        { label: '失败', probability: 0.05, target: 'next' },
      ],
    },
    {
      id: 'tpl-fire-sup',
      name: '舱级消防抑制(气体灭火)',
      category: 'passive',
      grade: 'C',
      source: { citation: 'NFPA 855; FM Global Data Sheet 5-33' },
      branches: [
        { label: '成功', probability: 0.9, target: OUTCOME_LOCAL_FIRE },
        { label: '失败', probability: 0.1, target: 'next' },
      ],
    },
    {
      id: 'tpl-insulation',
      name: '模组/簇间隔热阻隔',
      category: 'passive',
      grade: 'D',
      source: { citation: 'UL 9540A 单元级测试通过设计', note: '示例参考值' },
      branches: [
        { label: '成功', probability: 0.85, target: OUTCOME_LOCAL_FIRE },
        { label: '失败', probability: 0.15, target: 'next' },
      ],
    },
    {
      id: 'tpl-explosion-vent',
      name: '防爆泄压',
      category: 'passive',
      grade: 'D',
      source: { citation: 'NFPA 68 (Deflagration Venting)' },
      branches: [
        { label: '成功', probability: 0.9, target: OUTCOME_FIRE_SPREAD },
        { label: '失败', probability: 0.1, target: 'next' },
      ],
    },
  ],
  outcomes: [
    { id: OUTCOME_SAFE, name: '安全停机', severity: 0, consequenceLevel: 1 },
    { id: OUTCOME_SMOKE, name: '冒烟(可控热失控)', severity: 1, consequenceLevel: 2 },
    { id: OUTCOME_LOCAL_FIRE, name: '局部起火', severity: 2, consequenceLevel: 3 },
    { id: OUTCOME_FIRE_SPREAD, name: '火灾蔓延', severity: 3, consequenceLevel: 4 },
    { id: OUTCOME_EXPLOSION, name: '爆炸', severity: 4, consequenceLevel: 5 },
  ],
  finalFailureOutcomeId: OUTCOME_EXPLOSION,
};

/** 跨领域 LOPA 示例模板(依据《储能部件跨领域可靠性数据综述 v0.2》§7,链式简化) */
const TEMPLATE_LOPA: EventTree = {
  version: 2,
  id: 'bess-lopa-crossdomain',
  name: 'BESS 热失控(跨领域 LOPA 取值)',
  initiatingEvent: {
    id: 'ie-cabin-tr',
    name: '单舱热失控初始事件',
    frequency: 1e-2,
    grade: 'C',
    source: {
      citation: 'DNV GL BESS QRA (2019);跨领域可靠性综述 §7',
      note: '按 10⁴ 颗电芯 × 1×10⁻⁶/颗·年(一般电芯)自下而上构造,落于 DNV 无防护区间 10⁻¹–10⁻²/年',
    },
  },
  nodes: [
    {
      id: 'lopa-detect',
      name: '探测与预警(BMS/气体+响应)',
      category: 'warning',
      grade: 'C',
      source: { citation: 'CCPS LOPA "报警+操作员响应"通用值', note: 'PFD₁=0.1' },
      branches: [
        { label: '成功', probability: 0.9, target: 'c1-controlled' },
        { label: '失败', probability: 0.1, target: 'next' },
      ],
    },
    {
      id: 'lopa-suppress',
      name: '灭火/抑制(湿式喷淋折算)',
      category: 'passive',
      grade: 'C',
      source: { citation: 'NFPA 喷淋统计折算', note: 'PFD₂≈0.1(综合有效率 88–91%)' },
      branches: [
        { label: '成功', probability: 0.9, target: 'c2-vented-fire' },
        { label: '失败', probability: 0.1, target: 'next' },
      ],
    },
    {
      id: 'lopa-vent',
      name: '排爆通风(SIL 2 级)',
      category: 'passive',
      grade: 'C',
      source: {
        citation: 'IEC 61511;DNV GL QRA (2019)',
        note: 'PFD₃=0.01;链式简化:综述原文"探测失败→抑制不可用"的分叉结构可用双树精确复现(树1 IE×0.9 探测成功链,树2 IE×0.1 探测失败链)',
      },
      branches: [
        { label: '成功', probability: 0.99, target: 'c4-cascade-fire' },
        { label: '失败', probability: 0.01, target: 'next' },
      ],
    },
  ],
  outcomes: [
    { id: 'c1-controlled', name: 'C1 受控事件', severity: 0, consequenceLevel: 1 },
    { id: 'c2-vented-fire', name: 'C2 舱内火灾(排气受控)', severity: 1, consequenceLevel: 2 },
    { id: 'c3-deflagration', name: 'C3 火灾+爆燃风险', severity: 2, consequenceLevel: 4 },
    { id: 'c4-cascade-fire', name: 'C4 级联蔓延火灾', severity: 3, consequenceLevel: 4 },
    { id: 'c5-explosion', name: 'C5 舱体爆炸', severity: 4, consequenceLevel: 5 },
  ],
  finalFailureOutcomeId: 'c5-explosion',
};

/** 统一五级终态口径,与默认模板一致,每次调用返回新数组 */
function stdOutcomes(): Outcome[] {
  return [
    { id: OUTCOME_SAFE, name: '安全停机', severity: 0, consequenceLevel: 1 },
    { id: OUTCOME_SMOKE, name: '冒烟(可控热失控)', severity: 1, consequenceLevel: 2 },
    { id: OUTCOME_LOCAL_FIRE, name: '局部起火', severity: 2, consequenceLevel: 3 },
    { id: OUTCOME_FIRE_SPREAD, name: '火灾蔓延', severity: 3, consequenceLevel: 4 },
    { id: OUTCOME_EXPLOSION, name: '爆炸', severity: 4, consequenceLevel: 5 },
  ];
}

/** P14 预置:内短路热失控事件树 */
const TEMPLATE_ISC: EventTree = {
  version: 2,
  id: 'bess-ie-isc',
  name: '内短路热失控事件树(预置)',
  initiatingEvent: {
    id: 'ie-isc',
    name: '电芯内短路致热失控',
    frequency: 0.05,
    grade: 'C',
    source: {
      citation: 'EPRI BESS Failure Incident Database;库条目 cell-thermal-runaway',
      note: '1×10⁻⁷/cell·yr × 5×10⁵ 电芯(约 10 MWh 级)折算系统级频率',
    },
  },
  nodes: [
    {
      id: 'isc-tr-detect',
      name: '热失控多参量检测(气/烟/压)',
      category: 'warning',
      grade: 'C',
      source: { citation: 'Frontiers in Physics (2025);Sandia VOC 验证 (2024)', note: '库条目 warn-tr-multi,PFD 0.05' },
      branches: [
        { label: '成功', probability: 0.95, target: OUTCOME_SAFE },
        { label: '失败', probability: 0.05, target: 'next' },
      ],
    },
    {
      id: 'isc-cooling',
      name: '液冷全速降温',
      category: 'active',
      grade: 'D',
      source: { citation: 'UL 9540A 浸没对照测试 (EticaAG 2023)', note: '库条目 act-liquid-cooling-max,PFD 0.1' },
      branches: [
        { label: '成功', probability: 0.9, target: OUTCOME_SMOKE },
        { label: '失败', probability: 0.1, target: 'next' },
      ],
    },
    {
      id: 'isc-cell-vent',
      name: '电芯防爆阀开阀',
      category: 'passive',
      grade: 'D',
      source: { citation: 'NREL 71248 (2018)', note: '库条目 pas-cell-vent,失效 2%' },
      branches: [
        { label: '成功', probability: 0.98, target: OUTCOME_LOCAL_FIRE },
        { label: '失败', probability: 0.02, target: 'next' },
      ],
    },
    {
      id: 'isc-gas-sup',
      name: '舱级气体灭火',
      category: 'passive',
      grade: 'C',
      source: { citation: 'NFPA 855; FM Global Data Sheet 5-33', note: '库条目 pas-gas-suppression' },
      branches: [
        { label: '成功', probability: 0.9, target: OUTCOME_LOCAL_FIRE },
        { label: '失败', probability: 0.1, target: 'next' },
      ],
    },
  ],
  outcomes: stdOutcomes(),
  finalFailureOutcomeId: OUTCOME_FIRE_SPREAD,
};

/** P14 预置:绝缘失效事件树 */
const TEMPLATE_INSULATION: EventTree = {
  version: 2,
  id: 'bess-ie-insulation',
  name: '绝缘失效事件树(预置)',
  initiatingEvent: {
    id: 'ie-insulation',
    name: '直流侧绝缘失效',
    frequency: 2e-2,
    grade: 'D',
    source: { citation: 'IEEE Std 493-2007;GB 51048-2014', note: '库条目 sys-insulation-fault,推断值' },
  },
  nodes: [
    {
      id: 'ins-imd',
      name: 'IMD 绝缘监测报警',
      category: 'warning',
      grade: 'D',
      source: { citation: 'ABB 白皮书 (2022);GB 51048-2014 第 7 章', note: '库条目 warn-imd,漏检 5%' },
      branches: [
        { label: '成功', probability: 0.95, target: OUTCOME_SAFE },
        { label: '失败', probability: 0.05, target: 'next' },
      ],
    },
    {
      id: 'ins-relay',
      name: '断开主继电器/接触器',
      category: 'active',
      grade: 'D',
      source: { citation: 'IEC 61511-1:2016 SIL 1', note: '库条目 act-main-relay,PFD 0.01' },
      branches: [
        { label: '成功', probability: 0.99, target: OUTCOME_SAFE },
        { label: '失败', probability: 0.01, target: 'next' },
      ],
    },
    {
      id: 'ins-barrier',
      name: '模组/簇间隔热阻隔',
      category: 'passive',
      grade: 'D',
      source: { citation: 'UL 9540A 单元级测试通过设计', note: '库条目 pas-thermal-barrier' },
      branches: [
        { label: '成功', probability: 0.85, target: OUTCOME_LOCAL_FIRE },
        { label: '失败', probability: 0.15, target: 'next' },
      ],
    },
  ],
  outcomes: stdOutcomes(),
  finalFailureOutcomeId: OUTCOME_FIRE_SPREAD,
};

/** P14 预置:电池过充事件树 */
const TEMPLATE_OVERCHARGE: EventTree = {
  version: 2,
  id: 'bess-ie-overcharge',
  name: '电池过充事件树(预置)',
  initiatingEvent: {
    id: 'ie-overcharge',
    name: 'BMS 失效致过充',
    frequency: 1e-2,
    grade: 'C',
    source: { citation: 'EPRI 2024 白皮书(控制系统占 46% 根因)', note: '库条目 sys-bms-overcharge' },
  },
  nodes: [
    {
      id: 'oc-high-temp',
      name: '高温预警(温度阈值)',
      category: 'warning',
      grade: 'D',
      source: { citation: 'IEC 61511 BPCS 类比;Springer (2022)', note: '库条目 warn-high-temp,PFD 0.1' },
      branches: [
        { label: '成功', probability: 0.9, target: OUTCOME_SAFE },
        { label: '失败', probability: 0.1, target: 'next' },
      ],
    },
    {
      id: 'oc-protect',
      name: '过充保护切断(BMS+硬件冗余)',
      category: 'active',
      grade: 'D',
      source: { citation: 'IEC 62619:2022 cl.5.4', note: '库条目 act-overcharge-protect,PFD 0.01' },
      branches: [
        { label: '成功', probability: 0.99, target: OUTCOME_SAFE },
        { label: '失败', probability: 0.01, target: 'next' },
      ],
    },
    {
      id: 'oc-relay',
      name: '断开主继电器/接触器',
      category: 'active',
      grade: 'D',
      source: { citation: 'IEC 61511-1:2016 SIL 1', note: '库条目 act-main-relay,PFD 0.01' },
      branches: [
        { label: '成功', probability: 0.99, target: OUTCOME_SMOKE },
        { label: '失败', probability: 0.01, target: 'next' },
      ],
    },
    {
      id: 'oc-cell-vent',
      name: '电芯防爆阀开阀',
      category: 'passive',
      grade: 'D',
      source: { citation: 'NREL 71248 (2018)', note: '库条目 pas-cell-vent,失效 2%' },
      branches: [
        { label: '成功', probability: 0.98, target: OUTCOME_LOCAL_FIRE },
        { label: '失败', probability: 0.02, target: 'next' },
      ],
    },
  ],
  outcomes: stdOutcomes(),
  finalFailureOutcomeId: OUTCOME_EXPLOSION,
};

/** P14 预置:异常热源事件树 */
const TEMPLATE_EXT_HEAT: EventTree = {
  version: 2,
  id: 'bess-ie-ext-heat',
  name: '异常热源事件树(预置)',
  initiatingEvent: {
    id: 'ie-ext-heat',
    name: '异常外部热源/邻舱火灾',
    frequency: 1e-3,
    grade: 'D',
    source: { citation: 'NFPA 855 (2023);EPRI BESS Failure DB', note: '库条目 sys-external-heat,推断值' },
  },
  nodes: [
    {
      id: 'eh-high-temp',
      name: '高温预警(温度阈值)',
      category: 'warning',
      grade: 'D',
      source: { citation: 'IEC 61511 BPCS 类比;Springer (2022)', note: '库条目 warn-high-temp,PFD 0.1' },
      branches: [
        { label: '成功', probability: 0.9, target: OUTCOME_SAFE },
        { label: '失败', probability: 0.1, target: 'next' },
      ],
    },
    {
      id: 'eh-cooling',
      name: '液冷全速降温',
      category: 'active',
      grade: 'D',
      source: { citation: 'UL 9540A 浸没对照测试 (EticaAG 2023)', note: '库条目 act-liquid-cooling-max,PFD 0.1' },
      branches: [
        { label: '成功', probability: 0.9, target: OUTCOME_SAFE },
        { label: '失败', probability: 0.1, target: 'next' },
      ],
    },
    {
      id: 'eh-immersion',
      name: '浸润式 Pack(浸没式冷却)',
      category: 'passive',
      grade: 'C',
      source: { citation: 'EticaAG UL 9540A 浸没式测试 (2023)', note: '库条目 pas-immersion-pack,阻断失败 2%' },
      branches: [
        { label: '成功', probability: 0.98, target: OUTCOME_SMOKE },
        { label: '失败', probability: 0.02, target: 'next' },
      ],
    },
    {
      id: 'eh-gas-sup',
      name: '舱级气体灭火',
      category: 'passive',
      grade: 'C',
      source: { citation: 'NFPA 855; FM Global Data Sheet 5-33', note: '库条目 pas-gas-suppression' },
      branches: [
        { label: '成功', probability: 0.9, target: OUTCOME_LOCAL_FIRE },
        { label: '失败', probability: 0.1, target: 'next' },
      ],
    },
  ],
  outcomes: stdOutcomes(),
  finalFailureOutcomeId: OUTCOME_FIRE_SPREAD,
};

/**
 * P30 真实案例对标:APS McMicken(2019-04-19,亚利桑那)爆炸事故复现。
 * 反循环原则:仅把 DNV 记录的物理配置事实(无电芯间热障、无泄爆/排风)编码为近失败(0.05),
 * 其余取库通用先验;验证靠"复原缺失装备→C5 频率回落"的反事实对标(见 docs/案例对标-McMicken-2019.md)。
 * 屏障口径 = "TR 已触发,该屏障能否阻止升级到下一后果级"。
 */
const TEMPLATE_MCMICKEN: EventTree = {
  version: 2,
  id: 'bess-case-mcmicken',
  name: 'APS McMicken 2019 对标(真实事故复现)',
  initiatingEvent: {
    id: 'ie-mcm',
    name: '单电芯内短路致热失控',
    frequency: 5e-3,
    grade: 'D',
    source: {
      citation: 'DNV GL《McMicken Battery Energy Storage System Event: Technical Analysis and Recommendations》(2020)',
      note: 'McMicken ~2 MWh LG NMC;DNV:模组内电芯异常析锂→内短触发 TR。频率按内短率×电芯数估算,仅示意;对标重点是条件结构而非 IE 频率',
    },
  },
  nodes: [
    {
      id: 'mcm-detect',
      name: '早期离气探测+联动停机',
      category: 'warning',
      grade: 'D',
      source: { citation: '库条目 warn-offgas-voc;DNV McMicken 报告', note: '口径=TR 已触发时阻止升级,略低于探测可靠性;McMicken 探测有限、未触发有效干预' },
      branches: [
        { label: '成功', probability: 0.9, target: OUTCOME_SAFE },
        { label: '失败', probability: 0.1, target: 'next' },
      ],
    },
    {
      id: 'mcm-bms',
      name: 'BMS 切断/隔离',
      category: 'active',
      grade: 'D',
      source: { citation: '库条目 act-main-relay', note: '单芯 TR 已自持,BMS 切断仅部分阻断模组级联' },
      branches: [
        { label: '成功', probability: 0.9, target: OUTCOME_SMOKE },
        { label: '失败', probability: 0.1, target: 'next' },
      ],
    },
    {
      id: 'mcm-thermal',
      name: '电芯间热障阻断蔓延',
      category: 'passive',
      grade: 'D',
      source: { citation: '库条目 pas-thermal-barrier;DNV McMicken 根因③', note: '设计事实:McMicken 电芯间无热障→近确定级联;0.05 表征装备缺失(反事实复原至库先验 0.85)' },
      branches: [
        { label: '成功', probability: 0.05, target: OUTCOME_LOCAL_FIRE },
        { label: '失败', probability: 0.95, target: 'next' },
      ],
    },
    {
      id: 'mcm-suppress',
      name: '舱级灭火(Novec 1230)',
      category: 'passive',
      grade: 'D',
      source: { citation: '库条目 pas-gas-suppression;DNV McMicken 根因②', note: 'Novec 1230 已喷放但对热失控链无效(洁净剂降温/阻断有限),取 0.3' },
      branches: [
        { label: '成功', probability: 0.3, target: OUTCOME_LOCAL_FIRE },
        { label: '失败', probability: 0.7, target: 'next' },
      ],
    },
    {
      id: 'mcm-vent',
      name: '泄爆/防爆(NFPA 68/69)',
      category: 'passive',
      grade: 'D',
      source: { citation: '库条目 pas-explosion-vent;DNV McMicken 根因④', note: '设计事实:无泄爆/排风,可燃离气积聚→0.05 表征缺失(反事实复原至库先验 0.90)' },
      branches: [
        { label: '成功', probability: 0.05, target: OUTCOME_FIRE_SPREAD },
        { label: '失败', probability: 0.95, target: 'next' },
      ],
    },
    {
      id: 'mcm-response',
      name: '应急响应(避免开门引气)',
      category: 'active',
      grade: 'D',
      source: { citation: '库条目 act-emergency-response;DNV McMicken 根因⑤', note: '人因屏障,库先验 0.7 未 rig;McMicken 实况:消防员开门 2–3 min 内引爆,留待反事实/敏感性体现' },
      branches: [
        { label: '成功', probability: 0.7, target: OUTCOME_FIRE_SPREAD },
        { label: '失败', probability: 0.3, target: 'next' },
      ],
    },
  ],
  outcomes: stdOutcomes(),
  finalFailureOutcomeId: OUTCOME_EXPLOSION,
};

export interface TemplateInfo {
  id: string;
  name: string;
}

const TEMPLATE_MAP = new Map<string, EventTree>([
  [TEMPLATE.id, TEMPLATE],
  [TEMPLATE_LOPA.id, TEMPLATE_LOPA],
  [TEMPLATE_ISC.id, TEMPLATE_ISC],
  [TEMPLATE_INSULATION.id, TEMPLATE_INSULATION],
  [TEMPLATE_OVERCHARGE.id, TEMPLATE_OVERCHARGE],
  [TEMPLATE_EXT_HEAT.id, TEMPLATE_EXT_HEAT],
  [TEMPLATE_MCMICKEN.id, TEMPLATE_MCMICKEN],
]);

export const TEMPLATES: TemplateInfo[] = [
  { id: TEMPLATE.id, name: TEMPLATE.name },
  { id: TEMPLATE_LOPA.id, name: TEMPLATE_LOPA.name },
  { id: TEMPLATE_ISC.id, name: TEMPLATE_ISC.name },
  { id: TEMPLATE_INSULATION.id, name: TEMPLATE_INSULATION.name },
  { id: TEMPLATE_OVERCHARGE.id, name: TEMPLATE_OVERCHARGE.name },
  { id: TEMPLATE_EXT_HEAT.id, name: TEMPLATE_EXT_HEAT.name },
  { id: TEMPLATE_MCMICKEN.id, name: TEMPLATE_MCMICKEN.name },
];

/** 返回模板深拷贝,调用方可安全修改;未知 id 回退默认模板 */
export function createTemplateTree(templateId?: string): EventTree {
  return structuredClone(TEMPLATE_MAP.get(templateId ?? TEMPLATE.id) ?? TEMPLATE);
}

/** P14 多初始事件预置树组的模板 id */
export const MULTI_IE_TEMPLATE_IDS = [
  'bess-ie-isc', 'bess-ie-insulation', 'bess-ie-overcharge', 'bess-ie-ext-heat',
] as const;

/** 多初始事件预置树组(四模板深拷贝,id 重写为运行时唯一值) */
export function createMultiIePresetTrees(): EventTree[] {
  return MULTI_IE_TEMPLATE_IDS.map((tid) => {
    const t = createTemplateTree(tid);
    t.id = `t-${crypto.randomUUID()}`;
    return t;
  });
}
