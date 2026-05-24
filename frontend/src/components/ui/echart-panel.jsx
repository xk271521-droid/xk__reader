import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { loadEcharts } from './echartsClient'

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
  const [chartReadyVersion, setChartReadyVersion] = useState(0)

  useEffect(() => {
    if (!hostRef.current) return undefined
    let disposed = false
    let resizeObserver = null

    loadEcharts()
      .then((echarts) => {
        if (disposed || !hostRef.current) return
        const chart = echarts.init(hostRef.current, null, {
          renderer: 'canvas',
          useDirtyRect: true,
        })
        chartRef.current = chart

        resizeObserver = new ResizeObserver(() => {
          chart.resize({
            animation: {
              duration: 180,
              easing: 'cubicOut',
            },
          })
        })
        resizeObserver.observe(hostRef.current)
        setChartReadyVersion((version) => version + 1)
      })
      .catch((error) => {
        if (!disposed) {
          console.error('Failed to load ECharts', error)
        }
      })

    return () => {
      disposed = true
      resizeObserver?.disconnect()
      chartRef.current?.dispose()
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
  }, [option, chartReadyVersion])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    if (loading) {
      chart.showLoading('default', LOADING_OPTIONS)
    } else {
      chart.hideLoading()
    }
  }, [loading, chartReadyVersion])

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
  }, [onClick, onMouseOver, onGlobalOut, chartReadyVersion])

  return <div ref={hostRef} className={cn('home-echart-panel', className)} />
}
