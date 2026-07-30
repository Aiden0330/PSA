export function formatEtaNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value === 0) return '0.000000'
  // 阈值 1e-3(原 1e-6):1.89e-5 以 toFixed(6) 显示为 0.000019,6 位小数把有效数字
  // 截到 2 位——序列频率常在 1e-9..1e-4 量级,损失真实精度(报障 2026-07-30 ③)。
  // 科学计数固定 6 位尾数 ⇒ 相对精度恒 1e-6,1e-9 级数值无损;≥1e-3(典型 PFD/频率
  // 头部)保持小数观感。
  return Math.abs(value) < 1e-3 ? value.toExponential(6) : value.toFixed(6)
}

export function formatEtaRate(value: number | null | undefined): string {
  const text = formatEtaNumber(value)
  return text === '—' ? text : `${text}/yr`
}
