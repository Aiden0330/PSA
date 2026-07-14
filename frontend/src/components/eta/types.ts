import type { layout } from '../../eventtree'

export type EtLayoutNode = ReturnType<typeof layout>['nodes'][number]

/**
 * EtCanvas 内容分组的选择器标记(R4a):导出前(EventTreeEditor.prepareCanvasForExport)
 * 靠它定位携带缩放/平移 transform 的 <g>,克隆后重置为单位变换——保证导出图像与缩放/平移状态无关,
 * 与缩放功能加入前的行为(导出永远是完整、未裁切的内容)逐位一致。
 */
export const ETA_CANVAS_CONTENT_ATTR = 'data-eta-canvas-content'

export interface SeqBarrierStep { feId: string; outcome: 'success' | 'failure' }

/** 末态序列行(叶按 DFS 成功优先 = 引擎 L0..Ln 同序);容器计算,画布/检视器/路径表共用。 */
export interface SeqRow {
  i: number
  seq: number
  lf: EtLayoutNode
  freq: number
  c: string
  path: SeqBarrierStep[]
  diff: boolean
}
