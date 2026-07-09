import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type MainTab = 'ft' | 'bess' | 'params' | 'library' | 'cons' | 'fmea'
export type FtEditTarget =
  | { src: 'model' }
  | { src: 'eta'; etaKey: string; name: string }
  | { src: 'standalone'; name: string }

// 视图态(ADR-1 D2「纯视图态出文档」的前端落点):不进项目存档,persist 到 localStorage。
// ftEditTarget/selected/heatOn 引用运行期内容(页签/节点/量化结果),不持久化。
export interface ViewState {
  tab: MainTab
  ftEditTarget: FtEditTarget
  selected: string | null
  heatOn: boolean
  treeH: number | null
  seqW: number | null
  setTab: (t: MainTab) => void
  setFtEditTarget: (t: FtEditTarget) => void
  setSelected: (id: string | null) => void
  setHeatOn: (v: boolean) => void
  setTreeH: (h: number | null) => void
  setSeqW: (w: number | null) => void
}

const initial = {
  tab: 'bess' as MainTab,
  ftEditTarget: { src: 'model' } as FtEditTarget,
  selected: null,
  heatOn: false,
  treeH: null,
  seqW: null,
}

export const useViewStore = create<ViewState>()(
  persist(
    (set) => ({
      ...initial,
      setTab: (tab) => set({ tab }),
      setFtEditTarget: (ftEditTarget) => set({ ftEditTarget }),
      setSelected: (selected) => set({ selected }),
      setHeatOn: (heatOn) => set({ heatOn }),
      setTreeH: (treeH) => set({ treeH }),
      setSeqW: (seqW) => set({ seqW }),
    }),
    {
      name: 'psa.view',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ tab: s.tab, treeH: s.treeH, seqW: s.seqW }),
    },
  ),
)

/** 测试与「重置布局」用:回到初始视图态(不清 localStorage 之外的键)。 */
export function resetViewStore() {
  useViewStore.setState(initial)
}
