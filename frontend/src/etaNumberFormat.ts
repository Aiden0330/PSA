export function formatEtaNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value === 0) return '0.000000'
  return Math.abs(value) < 1e-6 ? value.toExponential(6) : value.toFixed(6)
}

export function formatEtaRate(value: number | null | undefined): string {
  const text = formatEtaNumber(value)
  return text === '—' ? text : `${text}/yr`
}
