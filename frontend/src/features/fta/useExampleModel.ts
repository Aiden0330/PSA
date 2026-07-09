import { useEffect, useState } from 'react'
import { getExamples, getModel } from '../../api'
import type { ExampleItem } from '../../api'
import { useModel } from '../../useModel'
import type { ModelJson } from '../../model'

/**
 * FTA 示例模型(非项目文档,独立撤销历史)。挂在 App 壳,
 * 使「参数库/CCF」页与 FTA 页共享同一份模型且跨页签切换不丢编辑。
 */
export function useExampleModel() {
  const [examples, setExamples] = useState<ExampleItem[]>([])
  const [current, setCurrent] = useState('bms_ft')
  const [ftName, setFtName] = useState('BMS')
  const hist = useModel(null)
  const { reset } = hist
  useEffect(() => { getExamples().then(setExamples).catch(() => {}) }, [])
  useEffect(() => {
    getModel(current).then((env) => {
      reset(env.model as ModelJson)
      setFtName(env.fault_tree)
    }).catch(() => {})
  }, [current, reset])
  return { examples, current, setCurrent, ftName, setFtName, ...hist }
}

export type ExampleModelState = ReturnType<typeof useExampleModel>
