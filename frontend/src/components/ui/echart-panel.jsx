import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import * as echarts from 'echarts/core'
import { LineChart, BarChart, PieChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  GraphicComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  GraphicComponent,
  CanvasRenderer,
])

const LOADING_OPTIONS = {
  text: '正在点亮图表',
  color: '#8B5CF6',
  textColor: '#A9BDD9',
  maskColor: 'rgba(8, 14, 36, 0.28)',
}

export function EChartPanel({
  option,
  className,
  loading = false,
  onClick,
  onMouseOver,
  onGlobalOut,
}) {
  const hostRef = useRef(null)
  const chartRef = useRef(null)

  useEffect(() => {
    if (!hostRef.current) return undefined
    const chart = echarts.init(hostRef.current, null, {
      renderer: 'canvas',
      useDirtyRect: true,
    })
    chartRef.current = chart

    const resizeObserver = new ResizeObserver(() => {
      chart.resize({
        animation: {
          duration: 180,
          easing: 'cubicOut',
        },
      })
    })
    resizeObserver.observe(hostRef.current)

    return () => {
      resizeObserver.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !option) return
    chart.setOption(option, {
      notMerge: true,
      lazyUpdate: true,
      replaceMerge: ['series'],
    })
  }, [option])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    if (loading) {
      chart.showLoading('default', LOADING_OPTIONS)
    } else {
      chart.hideLoading()
    }
  }, [loading])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return undefined

    const clickHandler = (params) => onClick?.(params)
    const overHandler = (params) => onMouseOver?.(params)
    const outHandler = () => onGlobalOut?.()

    if (onClick) chart.on('click', clickHandler)
    if (onMouseOver) chart.on('mouseover', overHandler)
    if (onGlobalOut) chart.on('globalout', outHandler)

    return () => {
      if (onClick) chart.off('click', clickHandler)
      if (onMouseOver) chart.off('mouseover', overHandler)
      if (onGlobalOut) chart.off('globalout', outHandler)
    }
  }, [onClick, onMouseOver, onGlobalOut])

  return <div ref={hostRef} className={cn('home-echart-panel', className)} />
}
