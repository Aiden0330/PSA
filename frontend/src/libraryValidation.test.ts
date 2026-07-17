import { describe, it, expect } from 'vitest'
import {
  validateLibraryRow, validateFieldEdit, validateOverlayForImport,
  SECTION_UNITS, MAX_LIBRARY_ENTRIES,
} from './libraryValidation'
import type { LibraryRow } from './libraryStore'

const comp = (o: Partial<LibraryRow> = {}): LibraryRow =>
  ({ id: 'c1', name: '电芯', failure_mode: 'TR', rate: 1e-7, unit: '/cell·yr', grade: 'D', source: { citation: 'x' }, ...o })
const barr = (o: Partial<LibraryRow> = {}): LibraryRow =>
  ({ id: 'b1', name: 'CID', category: 'cell', pfd: 0.1, grade: 'D', source: { citation: 'z' }, ...o })
const ie = (o: Partial<LibraryRow> = {}): LibraryRow =>
  ({ id: 'i1', label: '内短', category: 'cell', freq_prior: 1e-3, source: { citation: 'w' }, ...o })

describe('validateLibraryRow — 数值有限 + 分区范围', () => {
  it('合法行通过', () => {
    expect(validateLibraryRow('component_failure_rates', comp())).toBeNull()
    expect(validateLibraryRow('barrier_effectiveness', barr())).toBeNull()
    expect(validateLibraryRow('initiating_events', ie())).toBeNull()
  })
  it('负数 rate 拒绝', () => {
    expect(validateLibraryRow('component_failure_rates', comp({ rate: -1e-7 }))).toMatch(/非负/)
  })
  it('Infinity 拒绝(器件率 / 初因频率)', () => {
    expect(validateLibraryRow('component_failure_rates', comp({ rate: Infinity }))).toMatch(/有限|非负/)
    expect(validateLibraryRow('initiating_events', ie({ freq_prior: Infinity }))).toMatch(/有限|非负/)
  })
  it('PFD>1 拒绝, PFD<0 拒绝', () => {
    expect(validateLibraryRow('barrier_effectiveness', barr({ pfd: 1.5 }))).toMatch(/\[0,1\]|PFD/)
    expect(validateLibraryRow('barrier_effectiveness', barr({ pfd: -0.1 }))).toMatch(/\[0,1\]|PFD/)
  })
  it('有效性 η 越界拒绝', () => {
    expect(validateLibraryRow('barrier_effectiveness', barr({ eff: 2 }))).toMatch(/η|\[0,1\]/)
  })
  it('NaN 拒绝', () => {
    expect(validateLibraryRow('component_failure_rates', comp({ rate: NaN }))).not.toBeNull()
  })
})

describe('validateLibraryRow — citation / unit / grade 锁', () => {
  it('空 citation 拒绝', () => {
    expect(validateLibraryRow('component_failure_rates', comp({ source: { citation: '' } }))).toMatch(/citation|来源/)
    expect(validateLibraryRow('barrier_effectiveness', barr({ source: { citation: '  ' } }))).toMatch(/citation|来源/)
  })
  it('缺 source 对象拒绝', () => {
    const r = comp(); delete (r as Record<string, unknown>).source
    expect(validateLibraryRow('component_failure_rates', r)).toMatch(/citation|来源/)
  })
  it('空单位拒绝(器件失效率)', () => {
    expect(validateLibraryRow('component_failure_rates', comp({ unit: '' }))).toMatch(/单位/)
  })
  it('未知单位拒绝, 不静默换算 /cell·yr↔/unit·yr', () => {
    expect(validateLibraryRow('component_failure_rates', comp({ unit: '/yr' }))).toMatch(/单位|未知/)
    expect(SECTION_UNITS.component_failure_rates).toContain('/cell·yr')
    expect(SECTION_UNITS.component_failure_rates).toContain('/unit·yr')
    expect(SECTION_UNITS.component_failure_rates).toContain('/demand')
  })
  it('屏障分区无单位约束(barrier 无 unit 字段亦通过)', () => {
    expect(SECTION_UNITS.barrier_effectiveness).toBeNull()
    expect(validateLibraryRow('barrier_effectiveness', barr())).toBeNull()
  })
  it('初因单位若存在须在集内, 缺省(UI 不暴露)允许', () => {
    expect(validateLibraryRow('initiating_events', ie())).toBeNull()
    expect(validateLibraryRow('initiating_events', ie({ unit: '/unit·yr' }))).toBeNull()
    expect(validateLibraryRow('initiating_events', ie({ unit: '/bad' }))).toMatch(/单位|未知/)
  })
  it('非法置信等级拒绝', () => {
    expect(validateLibraryRow('component_failure_rates', comp({ grade: 'X' }))).toMatch(/置信/)
  })
  it('A/B 级需 evidence(citation) 非空', () => {
    expect(validateLibraryRow('barrier_effectiveness', barr({ grade: 'A', source: { citation: '' } }))).not.toBeNull()
    expect(validateLibraryRow('barrier_effectiveness', barr({ grade: 'A', source: { citation: '现场 N=100,k=1' } }))).toBeNull()
  })
})

describe('validateFieldEdit — 交互逐格值锁(草稿提交)', () => {
  it('数值格:负/Infinity/PFD>1/空 拒绝, 合法通过', () => {
    expect(validateFieldEdit('barrier_effectiveness', barr(), 'pfd', '1.5')).not.toBeNull()
    expect(validateFieldEdit('barrier_effectiveness', barr(), 'pfd', '')).not.toBeNull()
    expect(validateFieldEdit('barrier_effectiveness', barr(), 'pfd', '0.3')).toBeNull()
    expect(validateFieldEdit('component_failure_rates', comp(), 'rate', '-1')).not.toBeNull()
    expect(validateFieldEdit('component_failure_rates', comp(), 'rate', '2e-8')).toBeNull()
  })
  it('单位格:未知拒绝, 已知通过', () => {
    expect(validateFieldEdit('component_failure_rates', comp(), 'unit', '/yr')).not.toBeNull()
    expect(validateFieldEdit('component_failure_rates', comp(), 'unit', '/unit·yr')).toBeNull()
  })
  it('citation 格:清空拒绝, 非空通过', () => {
    expect(validateFieldEdit('barrier_effectiveness', barr(), 'citation', '')).not.toBeNull()
    expect(validateFieldEdit('barrier_effectiveness', barr(), 'citation', 'EPRI 2024')).toBeNull()
  })
  it('name / url / note 无约束', () => {
    expect(validateFieldEdit('component_failure_rates', comp(), 'name', '任意')).toBeNull()
    expect(validateFieldEdit('barrier_effectiveness', barr(), 'url', '')).toBeNull()
  })
})

describe('validateOverlayForImport — 事务式整体校验', () => {
  type Overlay = { upsert: Record<string, Record<string, LibraryRow>>; deleted: Record<string, string[]> }
  const good = (): Overlay => ({
    upsert: { component_failure_rates: { c1: comp() }, barrier_effectiveness: {}, initiating_events: {} },
    deleted: { component_failure_rates: [], barrier_effectiveness: [], initiating_events: [] },
  })
  it('合法覆盖层通过', () => { expect(validateOverlayForImport(good())).toBeNull() })
  it('越界值点名拒绝(带分区+id)', () => {
    const o = good(); o.upsert.barrier_effectiveness = { b1: barr({ pfd: 5 }) }
    expect(validateOverlayForImport(o)).toMatch(/barrier_effectiveness.*b1/)
  })
  it('row.id 与键不一致拒绝', () => {
    const o = good(); o.upsert.component_failure_rates = { c1: comp({ id: 'other' }) }
    expect(validateOverlayForImport(o)).toMatch(/id|不一致/)
  })
  it('跨分区重复 id 拒绝', () => {
    const o = good()
    o.upsert.barrier_effectiveness = { c1: barr({ id: 'c1' }) }
    expect(validateOverlayForImport(o)).toMatch(/重复|c1/)
  })
  it('分区形状非法拒绝', () => {
    const o = good() as unknown as Record<string, Record<string, unknown>>
    o.upsert.component_failure_rates = [] as unknown as Record<string, unknown>
    expect(validateOverlayForImport(o)).toMatch(/形状|分区/)
  })
  it('超过条目上限拒绝', () => {
    const o = good()
    const sec: Record<string, LibraryRow> = {}
    for (let i = 0; i <= MAX_LIBRARY_ENTRIES; i++) sec['k' + i] = comp({ id: 'k' + i })
    o.upsert.component_failure_rates = sec
    expect(validateOverlayForImport(o)).toMatch(/上限|超过/)
  })
  it('非对象拒绝', () => {
    expect(validateOverlayForImport(null)).not.toBeNull()
    expect(validateOverlayForImport('x')).not.toBeNull()
  })
})
