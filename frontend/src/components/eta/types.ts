import type { layout } from '../../eventtree'

export type EtLayoutNode = ReturnType<typeof layout>['nodes'][number]

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
