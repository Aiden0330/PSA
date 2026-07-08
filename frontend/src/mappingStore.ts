// FMEA 映射配置(MappingConfig)localStorage 持久化(仿 fmeaStore/libraryStore 风格)
// 存储范围:全局(跨项目一致),非项目文件。
import type { MappingConfig, FreqBin } from './fmea'
import { DEFAULT_MAPPING } from './fmea'

const KEY = 'bess-eta:fmea-mapping:v1'

function clone(c: MappingConfig): MappingConfig {
  return JSON.parse(JSON.stringify(c))
}

/**
 * 把已保存的(可能是旧版本/部分)配置叠加到 DEFAULT_MAPPING 之上,
 * 使新增的缺省键即便旧存档也能出现,避免读到 undefined。
 */
export function applyOverlay(saved: Partial<MappingConfig> | null | undefined): MappingConfig {
  const d = clone(DEFAULT_MAPPING)
  if (!saved || typeof saved !== 'object') return d
  const freq: FreqBin[] = Array.isArray(saved.freqToO) && saved.freqToO.length
    ? saved.freqToO.map((b) => ({ th: Number(b.th), o: Number(b.o) }))
    : d.freqToO
  return {
    consequenceToS: { ...d.consequenceToS, ...(saved.consequenceToS ?? {}) },
    freqToO: freq,
    freqFloorO: saved.freqFloorO ?? d.freqFloorO,
    detectionToD: { ...d.detectionToD, ...(saved.detectionToD ?? {}) },
    detectionDefaultD: saved.detectionDefaultD ?? d.detectionDefaultD,
    barrierCategoryToS: { ...d.barrierCategoryToS, ...(saved.barrierCategoryToS ?? {}) },
    barrierDefaultS: saved.barrierDefaultS ?? d.barrierDefaultS,
    componentDefaultS: saved.componentDefaultS ?? d.componentDefaultS,
  }
}

export function loadMapping(): MappingConfig {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return clone(DEFAULT_MAPPING)
    return applyOverlay(JSON.parse(raw))
  } catch {
    return clone(DEFAULT_MAPPING)
  }
}

export function saveMapping(cfg: MappingConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg))
  } catch {
    throw new Error('映射配置本地保存失败(可能是隐私模式或空间不足)')
  }
}

/** 清除覆盖层并返回出厂默认 */
export function resetMapping(): MappingConfig {
  try { localStorage.removeItem(KEY) } catch {}
  return clone(DEFAULT_MAPPING)
}
