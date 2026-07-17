// 损坏 localStorage 数据隔离:不再静默当空库(用户会误以为「本地项目/覆盖层全部消失」)。
// 把坏内容搬到 `<key>:corrupt-<ISO时间>` 侧键并告警,原键回落为空,坏数据可事后取回/导出。

export function isolateCorrupt(key: string, raw: string): void {
  const dest = `${key}:corrupt-${new Date().toISOString()}`
  try {
    localStorage.setItem(dest, raw)
    console.warn(`[storage] ${key} 内容损坏,已隔离到 ${dest};原键回落为空,可从该侧键取回。`)
  } catch {
    // 隔离本身失败(存储不可写/配额)——至少告警,不吞。
    console.warn(`[storage] ${key} 内容损坏且无法隔离(存储不可写),已回落为空。`)
  }
}
