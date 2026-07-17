/** F-α(前端评审 FE-03):FTA 页挂树编辑后的派生值分派——初因树只准频率端点。
 *
 * 病:FtaWorkbench 对 `__init__` 调概率端点(quantify().probability)+ 空 catch:
 * r2 typed 直传后频率参数被引擎响亮拒 → 400 被吞 → 静默保留旧初频。
 * 口径(与 EtaWorkbench 正确先例逐字对齐):
 * - `__init__` 且 initFreqSource==='ft':共享事件存在 → 不做两段式更新(序列级集成
 *   的工作情形,两段式独立近似不适用),返回 integrated 提示;否则走 /api/ft/frequency。
 * - 屏障树 → 概率端点。错误一律向上抛(调用方可见展示,绝不吞)。
 */
import { ftFrequency, quantify } from '../../api'
import { sharedIeBarrierEvents } from '../../model'
import type { ModelJson } from '../../model'
import { INIT_FREQ_KEY } from '../../stores/derived'

export type LinkedDerivation =
  | { kind: 'value'; key: string; value: number }
  | { kind: 'integrated'; shared: string[] }        // 共享事件:两段式不适用,提示改精确量化
  | { kind: 'skip' }                                // 非 ft 源初因树:无派生更新

export async function deriveLinkedValue(
  m: ModelJson, feName: string, initFreqSource: string | undefined,
): Promise<LinkedDerivation> {
  if (feName === '__init__') {
    if (initFreqSource !== 'ft') return { kind: 'skip' }
    const shared = sharedIeBarrierEvents(m)
    if (shared.length) return { kind: 'integrated', shared }
    const { frequency } = await ftFrequency(m, '__init__')     // 频率通道,绝非概率端点
    return { kind: 'value', key: INIT_FREQ_KEY, value: frequency }
  }
  const { probability } = await quantify(m, feName)
  return { kind: 'value', key: feName, value: probability }
}
