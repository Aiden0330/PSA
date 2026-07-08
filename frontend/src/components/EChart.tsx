import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'

/** 直接用 echarts(init/setOption),避免 echarts-for-react 的 init 兼容问题。 */
export function EChart({ option, height }: { option: any; height: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | undefined>(undefined)

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    chartRef.current = chart
    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); chart.dispose() }
  }, [])

  useEffect(() => { chartRef.current?.setOption(option, true) }, [option])

  return <div ref={ref} style={{ width: '100%', height }} />
}
