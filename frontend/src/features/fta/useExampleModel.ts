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
  // P4-B ⑦:失败不再吞成永久「加载中」——记录可见错误态,页面据此显示示例不可用
  const [loadError, setLoadError] = useState<string | null>(null)
  useEffect(() => { getExamples().then(setExamples).catch((e) => setLoadError(String(e?.message ?? e))) }, [])
  useEffect(() => {
    getModel(current).then((env) => {
      reset(env.model as ModelJson)
      setFtName(env.fault_tree)
      setLoadError(null)                     // 成功时清错(effect 内同步 setState 触发 lint 规则,改在异步链里)
    }).catch((e) => setLoadError(String(e?.message ?? e)))
  }, [current, reset])
  return { examples, current, setCurrent, ftName, setFtName, loadError, ...hist }
}

export type ExampleModelState = ReturnType<typeof useExampleModel>
