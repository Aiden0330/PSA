// FMEA/RPN 纯逻辑 + 可配置映射
// S×O×D 各维度 1–10;RPN=S*O*D;AP 按阈值给出优先级;mustPrioritize=S≥9。
// 映射(MappingConfig)从 DEFAULT_MAPPING 派生,运行时可由 UI 覆盖(见 mappingStore.ts)。

export interface FmeaRow {
  id: string
  object: string
  mode: string
  S: number  // 严重度  1-10
  O: number  // 发生度  1-10
  D: number  // 可探测度  1-10
  source?: string
}

// ── RPN / AP / 标记 ──────────────────────────────────────────────
export function rpn(r: FmeaRow): number {
  return r.S * r.O * r.D
}

export type ApLevel = '高' | '中' | '低'

export function ap(r: FmeaRow): ApLevel {
  const v = rpn(r)
  if (v >= 200) return '高'
  if (v >= 80)  return '中'
  return '低'
}

export function mustPrioritize(r: FmeaRow): boolean {
  return r.S >= 9
}

// ── 可配置映射 ──────────────────────────────────────────────────
/** 频率分档:freqPerYr ≥ th → o(按 th 降序求第一个满足项;均不满足用 freqFloorO) */
export interface FreqBin { th: number; o: number }

export interface MappingConfig {
  /** 后果等级 C1-C5 → 严重度 S */
  consequenceToS: Record<string, number>
  /** 频率(次/年)→ 发生度 O 的对数分档 */
  freqToO: FreqBin[]
  /** 低于所有分档阈值时的 O */
  freqFloorO: number
  /** 探测难度(1-5)→ 可探测度 D */
  detectionToD: Record<string, number>
  /** 无探测信息时的缺省 D */
  detectionDefaultD: number
  /** 屏障 category(warning/active/passive)→ 严重度 S */
  barrierCategoryToS: Record<string, number>
  /** 屏障无匹配 category 时的缺省 S */
  barrierDefaultS: number
  /** 器件失效缺省 S(器件库无 category 字段,统一缺省) */
  componentDefaultS: number
}

export const DEFAULT_MAPPING: MappingConfig = {
  consequenceToS: { C1: 2, C2: 4, C3: 6, C4: 8, C5: 10 },
  freqToO: [
    { th: 1e-1, o: 9 },
    { th: 1e-2, o: 7 },
    { th: 1e-3, o: 5 },
    { th: 1e-4, o: 4 },
    { th: 1e-5, o: 3 },
  ],
  freqFloorO: 2,
  detectionToD: { '1': 2, '2': 4, '3': 6, '4': 8, '5': 10 },
  detectionDefaultD: 6,
  // 越深的纵深防御层失效→下游可用防护越少→后果越重:warning < active < passive
  barrierCategoryToS: { warning: 6, active: 8, passive: 9 },
  barrierDefaultS: 7,
  componentDefaultS: 6,
}

/** 后果等级 → S;未知等级回退 C3(或 6) */
export function consequenceToS(cfg: MappingConfig, level: string): number {
  const v = cfg.consequenceToS[level]
  if (v != null) return v
  return cfg.consequenceToS.C3 ?? 6
}

/** 频率(次/年)→ O */
export function freqToO(cfg: MappingConfig, freqPerYr: number): number {
  const bins = [...cfg.freqToO].sort((a, b) => b.th - a.th)
  for (const b of bins) {
    if (freqPerYr >= b.th) return b.o
  }
  return cfg.freqFloorO
}

/** 探测难度(1-5,来自 DetectionInfo.difficulty)→ D;缺省/非法→ detectionDefaultD */
export function detectionToD(cfg: MappingConfig, difficulty?: number): number {
  if (difficulty == null || !Number.isFinite(difficulty)) return cfg.detectionDefaultD
  const d = Math.max(1, Math.min(5, Math.round(difficulty)))
  const v = cfg.detectionToD[String(d)]
  return v != null ? v : cfg.detectionDefaultD
}

/** 屏障 category → S;未知/缺省→ barrierDefaultS */
export function barrierS(cfg: MappingConfig, category?: string): number {
  if (category && cfg.barrierCategoryToS[category] != null) return cfg.barrierCategoryToS[category]
  return cfg.barrierDefaultS
}

/** 器件 → S;器件库无 category,统一用 componentDefaultS */
export function componentS(cfg: MappingConfig): number {
  return cfg.componentDefaultS
}

// ── S×D 矩阵分区 ──────────────────────────────────────────────
export type SxDZone = 'low' | 'mid' | 'high'

/**
 * 给出当前行的 S×D 风险分区(用于矩阵底图着色)。
 * 把 S、D (1-10) 各映射到 1-5 档:band = ceil(x/2)。
 * S_band × D_band 乘积:≥16 → high;8-15 → mid;<8 → low。
 */
export function sxdCell(S: number, D: number): SxDZone {
  const sb = Math.ceil(S / 2)
  const db = Math.ceil(D / 2)
  const prod = sb * db
  if (prod >= 16) return 'high'
  if (prod >= 8)  return 'mid'
  return 'low'
}
