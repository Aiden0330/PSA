import { describe, it, expect } from 'vitest'
import {
  rpn, ap, mustPrioritize, sxdCell,
  consequenceToS, freqToO, detectionToD, barrierS, componentS,
  DEFAULT_MAPPING,
} from './fmea'
import type { FmeaRow, MappingConfig } from './fmea'
import { applyOverlay } from './mappingStore'

const M = DEFAULT_MAPPING

function row(S: number, O: number, D: number): FmeaRow {
  return { id: 'r1', object: '测试对象', mode: '失效', S, O, D }
}

describe('rpn', () => {
  it('= S*O*D', () => {
    expect(rpn(row(5, 4, 3))).toBe(60)
    expect(rpn(row(10, 10, 10))).toBe(1000)
    expect(rpn(row(1, 1, 1))).toBe(1)
  })
})

describe('ap', () => {
  it('RPN≥200 → 高', () => {
    expect(ap(row(10, 10, 2))).toBe('高')  // 200
    expect(ap(row(10, 10, 10))).toBe('高') // 1000
  })
  it('RPN 80-199 → 中', () => {
    expect(ap(row(4, 5, 4))).toBe('中')   // 80
    expect(ap(row(9, 3, 7))).toBe('中')   // 189 < 200 → 中
  })
  it('RPN 80 边界', () => {
    expect(ap(row(4, 4, 5))).toBe('中')   // 80
    expect(ap(row(4, 4, 4))).toBe('低')   // 64
  })
  it('RPN<80 → 低', () => {
    expect(ap(row(2, 3, 4))).toBe('低')   // 24
    expect(ap(row(1, 1, 1))).toBe('低')   // 1
  })
  it('RPN 199 边界 → 中', () => {
    // 找一个 RPN=199 的组合不容易,用接近值
    expect(ap(row(10, 5, 4))).toBe('高')  // 200 → 高
    expect(ap(row(10, 5, 3))).toBe('中')  // 150 → 中
  })
})

describe('mustPrioritize', () => {
  it('S≥9 → true', () => {
    expect(mustPrioritize(row(9, 1, 1))).toBe(true)
    expect(mustPrioritize(row(10, 1, 1))).toBe(true)
  })
  it('S<9 → false(即使 RPN 很高)', () => {
    expect(mustPrioritize(row(8, 10, 10))).toBe(false)
    expect(mustPrioritize(row(1, 1, 1))).toBe(false)
  })
})

describe('consequenceToS', () => {
  it('C1-C5 分别映射到 2/4/6/8/10', () => {
    expect(consequenceToS(M, 'C1')).toBe(2)
    expect(consequenceToS(M, 'C2')).toBe(4)
    expect(consequenceToS(M, 'C3')).toBe(6)
    expect(consequenceToS(M, 'C4')).toBe(8)
    expect(consequenceToS(M, 'C5')).toBe(10)
  })
  it('未知等级 → 回退 C3(6)', () => {
    expect(consequenceToS(M, 'K1')).toBe(6)
    expect(consequenceToS(M, '')).toBe(6)
  })
  it('随自定义配置改变', () => {
    const cfg: MappingConfig = { ...M, consequenceToS: { ...M.consequenceToS, C5: 9 } }
    expect(consequenceToS(cfg, 'C5')).toBe(9)
  })
})

describe('freqToO', () => {
  it('≥1e-1 → 9', () => {
    expect(freqToO(M, 1e-1)).toBe(9)
    expect(freqToO(M, 1)).toBe(9)
  })
  it('1e-2 ≤ x < 1e-1 → 7', () => {
    expect(freqToO(M, 1e-2)).toBe(7)
    expect(freqToO(M, 5e-2)).toBe(7)
  })
  it('1e-3 ≤ x < 1e-2 → 5', () => {
    expect(freqToO(M, 1e-3)).toBe(5)
    expect(freqToO(M, 5e-3)).toBe(5)
  })
  it('1e-4 ≤ x < 1e-3 → 4', () => {
    expect(freqToO(M, 1e-4)).toBe(4)
    expect(freqToO(M, 5e-4)).toBe(4)
  })
  it('1e-5 ≤ x < 1e-4 → 3', () => {
    expect(freqToO(M, 1e-5)).toBe(3)
    expect(freqToO(M, 5e-5)).toBe(3)
  })
  it('< 1e-5 → 2(floor)', () => {
    expect(freqToO(M, 1e-6)).toBe(2)
    expect(freqToO(M, 0)).toBe(2)
  })
  it('乱序的分档也按 th 降序求解', () => {
    const cfg: MappingConfig = { ...M, freqToO: [
      { th: 1e-3, o: 5 }, { th: 1e-1, o: 9 }, { th: 1e-2, o: 7 },
    ], freqFloorO: 1 }
    expect(freqToO(cfg, 5e-2)).toBe(7)
    expect(freqToO(cfg, 1)).toBe(9)
    expect(freqToO(cfg, 1e-9)).toBe(1)  // floor
  })
})

describe('detectionToD', () => {
  it('difficulty 1-5 → D=2/4/6/8/10', () => {
    expect(detectionToD(M, 1)).toBe(2)
    expect(detectionToD(M, 2)).toBe(4)
    expect(detectionToD(M, 3)).toBe(6)
    expect(detectionToD(M, 4)).toBe(8)
    expect(detectionToD(M, 5)).toBe(10)
  })
  it('difficulty undefined → 缺省 6', () => {
    expect(detectionToD(M, undefined)).toBe(6)
    expect(detectionToD(M)).toBe(6)
  })
  it('超出范围夹到 1-5', () => {
    expect(detectionToD(M, 0)).toBe(2)   // clamp→1 → 2
    expect(detectionToD(M, 6)).toBe(10)  // clamp→5 → 10
  })
})

describe('barrierS (category→S)', () => {
  it('warning/active/passive → 6/8/9', () => {
    expect(barrierS(M, 'warning')).toBe(6)
    expect(barrierS(M, 'active')).toBe(8)
    expect(barrierS(M, 'passive')).toBe(9)
  })
  it('未知/缺省 category → barrierDefaultS(7)', () => {
    expect(barrierS(M, 'unknown')).toBe(7)
    expect(barrierS(M, undefined)).toBe(7)
    expect(barrierS(M, '')).toBe(7)
  })
  it('越深的防御层失效越严重:warning < active < passive', () => {
    expect(barrierS(M, 'warning')).toBeLessThan(barrierS(M, 'active'))
    expect(barrierS(M, 'active')).toBeLessThan(barrierS(M, 'passive'))
  })
})

describe('componentS', () => {
  it('器件库无 category,统一用 componentDefaultS(6)', () => {
    expect(componentS(M)).toBe(6)
  })
  it('随配置改变', () => {
    expect(componentS({ ...M, componentDefaultS: 8 })).toBe(8)
  })
})

describe('applyOverlay (mappingStore)', () => {
  it('空/缺省 → 出厂默认', () => {
    expect(applyOverlay(null)).toEqual(DEFAULT_MAPPING)
    expect(applyOverlay(undefined)).toEqual(DEFAULT_MAPPING)
    expect(applyOverlay({})).toEqual(DEFAULT_MAPPING)
  })
  it('部分覆盖只改对应键,其余取默认', () => {
    const merged = applyOverlay({ barrierDefaultS: 5, barrierCategoryToS: { passive: 10 } })
    expect(merged.barrierDefaultS).toBe(5)
    expect(merged.barrierCategoryToS.passive).toBe(10)
    expect(merged.barrierCategoryToS.warning).toBe(6)  // 默认仍在
    expect(merged.componentDefaultS).toBe(6)            // 未覆盖→默认
  })
  it('旧存档缺少新键时补齐默认(componentDefaultS)', () => {
    // 模拟旧版本只存了部分字段
    const merged = applyOverlay({ consequenceToS: { C5: 9 } } as Partial<MappingConfig>)
    expect(merged.componentDefaultS).toBe(6)
    expect(merged.consequenceToS.C5).toBe(9)
    expect(merged.consequenceToS.C1).toBe(2)
  })
})

describe('sxdCell', () => {
  it('S=10,D=10 → high (band 5*5=25)', () => {
    expect(sxdCell(10, 10)).toBe('high')
  })
  it('S=9,D=8 → high (5*4=20)', () => {
    expect(sxdCell(9, 8)).toBe('high')
  })
  it('S=8,D=4 → mid (4*2=8)', () => {
    expect(sxdCell(8, 4)).toBe('mid')
  })
  it('S=4,D=4 → mid (2*2=4 → low? 4<8 → low)', () => {
    expect(sxdCell(4, 4)).toBe('low')
  })
  it('S=1,D=1 → low (1*1=1)', () => {
    expect(sxdCell(1, 1)).toBe('low')
  })
  it('prod=8 边界 → mid', () => {
    // band(S=8)=4, band(D=4)=2, product=8 → mid
    expect(sxdCell(8, 4)).toBe('mid')
  })
  it('prod=16 边界 → high', () => {
    // band(S=8)=4, band(D=8)=4, product=16 → high
    expect(sxdCell(8, 8)).toBe('high')
  })
})
