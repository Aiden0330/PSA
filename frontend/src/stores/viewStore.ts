import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export type MainTab = 'home' | 'ft' | 'bess' | 'params' | 'library' | 'cons' | 'fmea' | 'report' | 'portfolio'
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
  drawerOpen: boolean
  paletteOpen: boolean
  /** R4a:ETA 页事故序列坞是否展开(含风险矩阵/ETA 清单);默认折叠 = 画布为主导。 */
  seqExpanded: boolean
  /** R4b:FTA 页量化结果坞(割集/重要度)是否展开;默认折叠 = 画布为主导。同 seqExpanded 模式。 */
  ftaResultsExpanded: boolean
  setTab: (t: MainTab) => void
  setFtEditTarget: (t: FtEditTarget) => void
  setSelected: (id: string | null) => void
  setHeatOn: (v: boolean) => void
  setTreeH: (h: number | null) => void
  setSeqW: (w: number | null) => void
  setDrawerOpen: (v: boolean) => void
  setPaletteOpen: (v: boolean) => void
  setSeqExpanded: (v: boolean) => void
  setFtaResultsExpanded: (v: boolean) => void
}

const initial = {
  tab: 'home' as MainTab,               // B 驾驶舱 = 项目落地页(外壳决策记录)
  ftEditTarget: { src: 'model' } as FtEditTarget,
  selected: null,
  heatOn: false,
  treeH: null,
  seqW: null,
  drawerOpen: false,
  paletteOpen: false,
  seqExpanded: false,
  ftaResultsExpanded: false,
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
      setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
      setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
      setSeqExpanded: (seqExpanded) => set({ seqExpanded }),
      setFtaResultsExpanded: (ftaResultsExpanded) => set({ ftaResultsExpanded }),
    }),
    {
      name: 'psa.view',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ tab: s.tab, treeH: s.treeH, seqW: s.seqW, drawerOpen: s.drawerOpen, seqExpanded: s.seqExpanded, ftaResultsExpanded: s.ftaResultsExpanded }),
    },
  ),
)

/** 测试与「重置布局」用:回到初始视图态(不清 localStorage 之外的键)。 */
export function resetViewStore() {
  useViewStore.setState(initial)
}
