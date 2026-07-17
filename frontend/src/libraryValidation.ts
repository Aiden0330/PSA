// 参考库运行时校验(FE-10 / CLAUDE.md 硬约束 #4 落地)。
// 无来源、错单位、越界值、坏结构绝不进入覆盖层或分析。零新依赖(repo 无 zod),手写校验器。
//
// 两层设计:
//  - validateFieldEdit:交互逐格值锁(草稿 → blur/Enter 提交),只校验被编辑字段;
//    保证 -1 / Infinity / PFD>1 / 未知单位 / 清空 citation 逐格无法落库,失败原值不动。
//  - validateLibraryRow / validateOverlayForImport:整行 / 整文件完整性校验,
//    用于导入这个不可信数据入口(事务式:整体通过才提交)。
import { LIBRARY_SECTIONS } from './libraryStore'
import type { LibrarySection, LibraryRow, LibraryOverlay } from './libraryStore'

// 各分区已知单位集(从 bess/reference_data.json 现有条目归纳)。null = 该分区无量纲(无单位)。
// 载荷单位不得静默换算(/cell·yr vs /unit·yr vs /demand)。
export const SECTION_UNITS: Record<LibrarySection, string[] | null> = {
  component_failure_rates: ['/cell·yr', '/unit·yr', '/demand'],
  barrier_effectiveness: null,
  initiating_events: ['/unit·yr'], // 内置口径;IE 编辑器当前不暴露 unit 列,故为「若存在须在集内」
}

export const VALID_GRADES = ['A', 'B', 'C', 'D'] as const
export const MAX_LIBRARY_FILE_BYTES = 2 * 1024 * 1024 // 2MB
export const MAX_LIBRARY_ENTRIES = 10_000

/** 把 number | 有限数字字符串 归一为 number;其余(空串/NaN/非数)→ null。 */
function toNum(v: unknown): number | null {
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const t = v.trim(); if (t === '') return null; const n = Number(t); return Number.isNaN(n) ? null : n }
  return null
}
function isFiniteNonNeg(v: unknown): boolean { const n = toNum(v); return n != null && Number.isFinite(n) && n >= 0 }
function isFiniteInRange(v: unknown, min: number, max: number): boolean { const n = toNum(v); return n != null && Number.isFinite(n) && n >= min && n <= max }

function citationOf(row: LibraryRow): string {
  const src = (row.source ?? {}) as Record<string, unknown>
  return typeof src.citation === 'string' ? src.citation.trim() : ''
}

/** 整行完整性校验:返回首个错误信息或 null(通过)。用于导入与整行断言。 */
export function validateLibraryRow(section: LibrarySection, row: LibraryRow): string | null {
  if (!row || typeof row !== 'object') return '行不是对象'
  if (typeof row.id !== 'string' || !row.id) return '缺少字符串 id'

  // 来源锁(数据溯源硬约束):用户覆盖层每条须有非空 citation。
  const citation = citationOf(row)
  if (!citation) return '来源 citation 必填且非空'

  // 置信等级:仅 A/B/C/D;A/B 需 evidence(citation 已保证非空)。
  if (row.grade !== undefined) {
    if (typeof row.grade !== 'string' || !VALID_GRADES.includes(row.grade as typeof VALID_GRADES[number])) return `置信等级非法:${String(row.grade)}`
    if ((row.grade === 'A' || row.grade === 'B') && !citation) return `${row.grade} 级需现场/证据支撑(evidence 非空)`
  }

  // 分区数值范围 + 单位。
  if (section === 'component_failure_rates') {
    if (!isFiniteNonNeg(row.rate)) return '失效率必须为有限非负数'
    const unit = typeof row.unit === 'string' ? row.unit.trim() : ''
    if (!unit) return '单位必填'
    if (!SECTION_UNITS.component_failure_rates!.includes(unit)) return `未知单位:${unit}(允许 ${SECTION_UNITS.component_failure_rates!.join(' / ')})`
  } else if (section === 'barrier_effectiveness') {
    if (!isFiniteInRange(row.pfd, 0, 1)) return 'PFD 必须为 [0,1] 内有限数'
    if (row.eff !== undefined && row.eff !== '' && !isFiniteInRange(row.eff, 0, 1)) return '有效性 η 必须为 [0,1] 内有限数'
  } else if (section === 'initiating_events') {
    if (!isFiniteNonNeg(row.freq_prior)) return '初因频率必须为有限非负数'
    const unit = typeof row.unit === 'string' ? row.unit.trim() : ''
    if (unit && !SECTION_UNITS.initiating_events!.includes(unit)) return `未知单位:${unit}`
  }
  return null
}

/** 交互逐格值锁:只校验被编辑字段的候选原始输入。返回错误或 null(可提交)。 */
export function validateFieldEdit(section: LibrarySection, _row: LibraryRow, field: string, raw: string): string | null {
  const numFields: Record<string, [number, number] | 'nonneg'> = {
    rate: 'nonneg', freq_prior: 'nonneg', pfd: [0, 1], eff: [0, 1],
  }
  if (field in numFields) {
    const rule = numFields[field]
    const ok = rule === 'nonneg' ? isFiniteNonNeg(raw) : isFiniteInRange(raw, rule[0], rule[1])
    if (!ok) return rule === 'nonneg' ? '必须为有限非负数' : '必须为 [0,1] 内有限数'
    return null
  }
  if (field === 'unit') {
    const set = SECTION_UNITS[section]
    if (set === null) return null
    const u = raw.trim()
    if (section === 'component_failure_rates' && !u) return '单位必填'
    if (u && !set.includes(u)) return `未知单位:${u}(允许 ${set.join(' / ')})`
    return null
  }
  if (field === 'citation') {
    if (!raw.trim()) return '来源 citation 必填且非空'
    return null
  }
  return null // name / url / note 等无约束
}

/** 交互态改置信等级:A/B 需 citation 非空(evidence)。返回错误或 null。 */
export function validateGradeEdit(row: LibraryRow, grade: string): string | null {
  if (!VALID_GRADES.includes(grade as typeof VALID_GRADES[number])) return `置信等级非法:${grade}`
  if ((grade === 'A' || grade === 'B') && !citationOf(row)) return `${grade} 级需现场/证据支撑(来源 citation 非空)`
  return null
}

/** 事务式整体校验:任一分区/条目非法即返回点名错误;通过返回 null。 */
export function validateOverlayForImport(overlay: unknown): string | null {
  if (!overlay || typeof overlay !== 'object') return '覆盖层不是对象'
  const o = overlay as { upsert?: unknown; deleted?: unknown }
  if (!o.upsert || typeof o.upsert !== 'object') return '覆盖层缺少 upsert 对象'
  const upsert = o.upsert as Record<string, unknown>
  const seen = new Set<string>()
  let count = 0
  for (const s of LIBRARY_SECTIONS) {
    const sec = upsert[s]
    if (sec === undefined) continue
    if (typeof sec !== 'object' || sec === null || Array.isArray(sec)) return `分区 ${s} 形状非法(应为 id→行 的对象)`
    for (const [id, row] of Object.entries(sec as Record<string, unknown>)) {
      if (++count > MAX_LIBRARY_ENTRIES) return `条目数超过上限 ${MAX_LIBRARY_ENTRIES}`
      if (!row || typeof row !== 'object') return `分区 ${s} · ${id}:条目非对象`
      if ((row as LibraryRow).id !== id) return `分区 ${s} · ${id}:row.id 与键不一致`
      if (seen.has(id)) return `重复 id:${id}(跨分区)`
      seen.add(id)
      const err = validateLibraryRow(s, row as LibraryRow)
      if (err) return `分区 ${s} · ${id}:${err}`
    }
  }
  if (o.deleted !== undefined) {
    if (typeof o.deleted !== 'object' || o.deleted === null) return 'deleted 形状非法'
    const del = o.deleted as Record<string, unknown>
    for (const s of LIBRARY_SECTIONS) if (del[s] !== undefined && !Array.isArray(del[s])) return `deleted.${s} 应为数组`
  }
  return null
}

/** 供 libraryStore.parseLibraryFile 复用的类型窄化(校验通过后当作 LibraryOverlay)。 */
export type { LibraryOverlay }
