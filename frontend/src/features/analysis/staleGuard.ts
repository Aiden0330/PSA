/** F-β(FE-02/FE-05,规格 W4):同一(槽,目标)乱序响应的 last-write-wins 守卫。
 *  用法:const g = useRef(makeStaleGuard()).current;发起时 const t = g.begin();
 *  响应处 if (!g.isCurrent(t)) return;——旧响应(old 慢、new 快)被丢弃,绝不覆盖新结果。 */
export interface StaleGuard { begin: () => number; isCurrent: (token: number) => boolean }

export function makeStaleGuard(): StaleGuard {
  let gen = 0
  return {
    begin: () => ++gen,
    isCurrent: (token: number) => token === gen,
  }
}

/** 带键变体:每个(槽,目标)独立代序——不同目标的响应互不误伤。 */
export interface KeyedStaleGuard { begin: (key: string) => number; isCurrent: (key: string, token: number) => boolean }

export function makeKeyedStaleGuard(): KeyedStaleGuard {
  const gens = new Map<string, number>()
  return {
    begin: (key) => { const g = (gens.get(key) ?? 0) + 1; gens.set(key, g); return g },
    isCurrent: (key, token) => token === (gens.get(key) ?? 0),
  }
}
