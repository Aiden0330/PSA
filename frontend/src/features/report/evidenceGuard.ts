/** FE-06(证据链页异步竞态):证据链查询的槽归属守卫。
 *  病根:版本/案例/评审/diff/评论请求无取消或代序 —— A 的慢响应可覆盖 B 的台账(串项目),
 *  同项目连续刷新也会 old 覆盖 new。契约同 F-β 规格 W4(makeKeyedStaleGuard),键 = projectUuid + 查询类。
 *
 *  isCurrent 判据双重:(1) 句柄发起时的 pu 仍是当前活动项目;(2) 该 (pu,查询类) 代序未被更新的请求推进。
 *  仅(2)不足以隔离跨项目(不同 pu 键的代序互不干扰,A 的旧句柄对 A 键仍"当前");
 *  故必须叠加(1)——切项目即令一切旧句柄作废。 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { makeKeyedStaleGuard } from '../analysis/staleGuard'

export interface QueryHandle { pu: string | null; qc: string; token: number }
export interface EvidenceGuard {
  /** 发起一次查询:捕获当时的 pu 与该 (pu,查询类) 的单调代序。 */
  begin: (pu: string | null, qc: string) => QueryHandle
  /** 响应/失败回来时:此句柄是否仍应提交(未切项目且未被更新请求取代)。 */
  isCurrent: (h: QueryHandle) => boolean
  /** 当前活动项目变更时调用(切项目即令旧 pu 的句柄失效)。 */
  setActive: (pu: string | null) => void
  active: () => string | null
}

const keyOf = (pu: string | null, qc: string) => `${pu ?? '∅'}::${qc}`

export function makeEvidenceGuard(initialPu: string | null = null): EvidenceGuard {
  const keyed = makeKeyedStaleGuard()
  let current = initialPu
  return {
    begin: (pu, qc) => ({ pu, qc, token: keyed.begin(keyOf(pu, qc)) }),
    isCurrent: (h) => h.pu === current && keyed.isCurrent(keyOf(h.pu, h.qc), h.token),
    setActive: (pu) => { current = pu },
    active: () => current,
  }
}

/** 组件用:守卫实例随组件生命周期稳定;当前 pu 由 effect 同步(不在渲染期读写 ref,满足
 *  react-hooks/refs)。返回稳定的 begin/isCurrent 回调,内部在**调用时**(effect/异步回调)
 *  才访问 ref —— 网络响应的解析远晚于 effect 冲刷,切项目→迟到响应之间无可觉察的竞态窗口。 */
export function useEvidenceGuard(pu: string | null): EvidenceGuard {
  const ref = useRef<EvidenceGuard | null>(null)
  if (ref.current == null) ref.current = makeEvidenceGuard(pu)
  useEffect(() => { ref.current!.setActive(pu) }, [pu])
  const begin = useCallback((p: string | null, qc: string) => ref.current!.begin(p, qc), [])
  const isCurrent = useCallback((h: QueryHandle) => ref.current!.isCurrent(h), [])
  const active = useCallback(() => ref.current!.active(), [])
  const setActive = useCallback((p: string | null) => ref.current!.setActive(p), [])
  return useMemo(() => ({ begin, isCurrent, active, setActive }), [begin, isCurrent, active, setActive])
}
