import { describe, expect, it } from 'vitest'
import { ETA_TEMPLATES, getTemplate, listTemplates, templateToEtaModel } from './etaTemplates'
import { consequenceTotals, consText, isCascade } from '../../eventtree'

describe('etaTemplates 迁移', () => {
  it('7 个模板全部保留;分级仅 C/D(硬约束 #4)', () => {
    expect(ETA_TEMPLATES).toHaveLength(7)
    for (const t of ETA_TEMPLATES) {
      expect(['C', 'D']).toContain(t.init.grade)
      expect(t.init.source.length).toBeGreaterThan(4)          // 每条初因有来源
      for (const b of t.barriers) {
        expect(['C', 'D']).toContain(b.grade)
        expect(b.source.length).toBeGreaterThan(4)             // 每条屏障有来源
        expect(b.failProb).toBeGreaterThanOrEqual(0)
        expect(b.failProb).toBeLessThanOrEqual(1)
      }
    }
  })

  it('converter:级联结构 + 初因/屏障映射 + 溯源(含初因)保留', () => {
    const t = getTemplate('bess-ie-isc')!
    const m = templateToEtaModel(t)
    expect(m.initEvent).toBe('电芯内短路致热失控')
    expect(m.initFreq).toBe(0.05)
    expect(m.initFreqSource).toBe('manual')
    // defect 2:初因溯源随模型带入(证据链首环不断)
    expect(m.initGrade).toBe('C')
    expect(m.initSource).toContain('EPRI BESS Failure Incident Database')
    expect(m.initEvidence).toContain('折算系统级频率')
    // defect 4/R1:终态文字随模板带入,且**展示路径**(consText 读 consequences)即刻正确,
    // 建页无需 save/reload normalize —— 断言展示函数,而非仅字段
    expect(consText(m, 'C2')).toBe('冒烟(可控热失控)')
    expect(consText(m, 'C1')).toBe('安全停机')
    expect(isCascade(m)).toBe(true)                            // 标准级联(可加屏障/重排)
    expect(m.functionalEvents).toHaveLength(4)
    const first = m.functionalEvents[0]
    expect(first.label).toBe('热失控多参量检测(气/烟/压)')
    expect(first.failProb).toBe(0.05)                          // = 失败分支概率
    expect(first.grade).toBe('C')
    expect(first.source).toContain('Frontiers in Physics')
    expect(first.evidence).toContain('warn-tr-multi')
    expect(first.id).toMatch(/^[A-Z0-9_]+$/)                   // 稳定大写 id
  })

  it('LOPA 逐字忠实(domain-reviewer 缺陷#1 守护:3 屏障,不得杜撰)', () => {
    const t = getTemplate('bess-lopa-crossdomain')!
    expect(t.barriers).toHaveLength(3)                         // 前身仅 3 层,非 4
    const vent = t.barriers[2]
    expect(vent.name).toBe('排爆通风(SIL 2 级)')
    expect(vent.failProb).toBe(0.01)                           // PFD₃=0.01(SIL 2),非 0.1
    expect(vent.grade).toBe('C')                               // 非 D
    expect(vent.successOutcome).toBe('C4')                     // c4-cascade-fire,非 C3
    expect(vent.source).toContain('IEC 61511')
    expect(vent.note).toContain('双树精确复现')                 // 独立性口径注记保留
    const supp = t.barriers[1]
    expect(supp.source).toBe('NFPA 喷淋统计折算')
    expect(supp.note).toContain('88–91%')
    // LOPA 自有终态名(展示路径即刻正确)
    const m = templateToEtaModel(t)
    expect(consText(m, 'C1')).toBe('C1 受控事件')
    expect(consText(m, 'C5')).toBe('C5 舱体爆炸')
  })

  it('末端全失败 → finalOutcome;屏障成功 → 各自后果级', () => {
    const m = templateToEtaModel(getTemplate('bess-ie-isc')!)
    // 全失败脊末端 = C4(finalOutcome);逐屏障成功 = C1/C2/C3/C3
    const totals = consequenceTotals(m)
    expect(totals.C4).toBeGreaterThan(0)                       // 末端后果存在
    expect(Object.keys(totals).sort()).toEqual(['C1', 'C2', 'C3', 'C4'])
  })

  it('McMicken:高失败率屏障(装备缺失)正确落为 failProb', () => {
    const m = templateToEtaModel(getTemplate('bess-case-mcmicken')!)
    const thermal = m.functionalEvents.find((f) => f.label.includes('热障'))!
    expect(thermal.failProb).toBe(0.95)                        // 无热障 → 近确定失败
    const vent = m.functionalEvents.find((f) => f.label.includes('泄爆'))!
    expect(vent.failProb).toBe(0.95)
    expect(m.functionalEvents).toHaveLength(6)
  })

  it('listTemplates 摘要', () => {
    const info = listTemplates()
    expect(info).toHaveLength(7)
    expect(info.map((i) => i.id)).toContain('bess-case-mcmicken')
    expect(info.every((i) => i.category)).toBe(true)
  })
})
