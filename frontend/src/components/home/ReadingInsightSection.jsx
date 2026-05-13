import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BrainCircuit,
  Flame,
  Highlighter,
  Inbox,
  NotebookPen,
  PackageCheck,
  Sparkles,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EChartPanel } from '@/components/ui/echart-panel'

const PET_ATLAS = {
  src: '/pets/yushi-cat/spritesheet.webp',
  columns: 8,
  rows: 9,
  cellWidth: 192,
  cellHeight: 208,
}

const PET_ANIMATIONS = {
  idle: { row: 0, durations: [280, 110, 110, 140, 140, 320] },
  'running-right': { row: 1, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  'running-left': { row: 2, durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  waving: { row: 3, durations: [140, 140, 140, 280] },
  jumping: { row: 4, durations: [140, 140, 140, 140, 280] },
  failed: { row: 5, durations: [140, 140, 140, 140, 140, 140, 140, 240] },
  waiting: { row: 6, durations: [150, 150, 150, 150, 150, 260] },
  running: { row: 7, durations: [120, 120, 120, 120, 120, 220] },
  review: { row: 8, durations: [150, 150, 150, 150, 150, 280] },
}

const LEGACY_POSE_TO_ANIMATION = {
  talk: 'waving',
  think: 'review',
  sleep: 'waiting',
}

const HELP_ANIMATIONS = {
  readingTrend: 'running',
  resourceMix: 'review',
  importTrend: 'jumping',
  timePreference: 'waiting',
  statPapers: 'idle',
  statOpens: 'waving',
  statNotes: 'review',
  statAnnotations: 'jumping',
}

function resolveMascotAnimation(pose, dockSide = 'right') {
  if (pose === 'dragging') {
    return dockSide === 'left' ? 'running-left' : 'running-right'
  }
  const normalizedPose = LEGACY_POSE_TO_ANIMATION[pose] || pose
  return PET_ANIMATIONS[normalizedPose] ? normalizedPose : 'idle'
}

const RESOURCE_DISTRIBUTION_COLORS = [
  '#7C3AED',
  '#22D3EE',
  '#10B981',
  '#F97316',
]

const RESOURCE_DISTRIBUTION_TONES = {
  摘要: '#7C3AED',
  笔记: '#22D3EE',
  标注: '#10B981',
  翻译: '#F97316',
}

const RESOURCE_DISTRIBUTION_COPY = {
  摘要: '把读过的内容压成可回看的结论，适合做阶段总结。',
  笔记: '把零散阅读动作沉淀成结构化笔记，后续最容易复用。',
  标注: '这是你真正动手消化的证据，说明不是只打开看一眼。',
  翻译: '把外文材料转成熟悉语言，方便后面继续深读。',
}

const TIME_DISTRIBUTION_TONES = {
  上午: '#38BDF8',
  下午: '#A78BFA',
  夜间: '#34D399',
}

const TIMEFRAME_LABELS = {
  week: '周',
  month: '月',
  year: '年',
  total: '总',
}

const TIMEFRAME_EMPTY_LABELS = {
  week: '本周',
  month: '本月',
  year: '今年',
  total: '累计',
}

const HELP_COPY = {
  readingTrend: '这里看你在当前时间范围里，哪几天真的打开过文献。',
  resourceMix: '别被中间这个圆圈骗了，重点其实是你沉淀内容的类型结构，不只是总数。',
  importTrend: '这里看导入和阅读有没有形成节奏，而不是只囤文献。',
  timePreference: '这里看你更常在什么时段开始阅读，方便把最容易进入状态的时间抓出来。',
  statPapers: '这里看你总共收纳了多少文献，以及当前周期新增了多少篇。',
  statOpens: '这里看当前周期里，你实际打开文献的频率。',
  statNotes: '这里看你把多少阅读行为真正落成了可回看的笔记，不只是看过就算。',
  statAnnotations: '这里看你留下了多少标注与划线，说明你到底有没有动手消化。',
}

function buildMascotOverviewMessage({
  monthlyOpens,
  monthlyDurationMinutes,
  monthlyImports,
  totalResources,
  dominantPeriodLabel,
  topFolder,
  topFolderCount,
  timeframeSpokenLabel = '这个月',
}) {
  if (monthlyOpens <= 0) {
    return '我先在这里占个位置。等你读起来、画起来、记起来，这一站才会真正热闹。'
  }

  const durationPart = monthlyDurationMinutes > 0
    ? `${timeframeSpokenLabel}你已经认真读了约 ${monthlyDurationMinutes} 分钟`
    : `${timeframeSpokenLabel}你已经打开了 ${monthlyOpens} 次文献`
  const importPart = monthlyImports > 0
    ? `，还顺手收了 ${monthlyImports} 篇新材料`
    : '，现在差的不是打开，是继续读深一点'
  const resourcePart = totalResources > 0
    ? `。目前沉淀出 ${totalResources} 项内容，说明你不是只路过。`
    : '。不过沉淀内容还不多，我建议你下一步多留点笔记或标注。'
  const rhythmPart = dominantPeriodLabel && dominantPeriodLabel !== '--'
    ? `你最近最容易进入状态的时段是${dominantPeriodLabel}`
    : `你常看的时段还在形成中`
  const folderPart = topFolderCount > 0
    ? `，而且 ${topFolder} 现在最热闹。`
    : '。'

  return `${durationPart}${importPart}${resourcePart}${rhythmPart}${folderPart}`
}

function formatDashboardDate(value) {
  if (!value) return '--'
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value))
  } catch {
    return '--'
  }
}

function formatCompactNumber(value) {
  const num = Number(value) || 0
  if (num >= 10000) return `${(num / 10000).toFixed(1)}w`
  return `${num}`
}

function useCountUp(target, active) {
  const [display, setDisplay] = useState(0)
  const previousTarget = useRef(0)

  useEffect(() => {
    const next = Number(target) || 0
    if (!active) {
      setDisplay(next)
      previousTarget.current = next
      return undefined
    }

    const start = performance.now()
    const from = previousTarget.current
    const duration = 900
    let frame = 0

    function tick(now) {
      const progress = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = Math.round(from + (next - from) * eased)
      setDisplay(current)
      if (progress < 1) {
        frame = window.requestAnimationFrame(tick)
      } else {
        previousTarget.current = next
      }
    }

    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [target, active])

  return display
}

function InsightStatCard({ item, index, animate, onHoverStart, onHoverEnd }) {
  const Icon = item.icon
  const animatedValue = useCountUp(item.value, animate)

  return (
    <article
      key={item.id}
      className={`home-insight-stat home-insight-stat--${item.accent}`}
      style={{ '--stagger-index': index }}
      data-insight-help={item.helpKey}
      onMouseEnter={() => onHoverStart(item.helpKey)}
      onMouseLeave={onHoverEnd}
      role="button"
      tabIndex={0}
    >
      <div className="home-insight-stat__icon">
        <Icon />
      </div>
      <div className="home-insight-stat__body">
        <p>{item.label}</p>
        <strong>{formatCompactNumber(animatedValue)}</strong>
        <span>{item.detail}</span>
      </div>
    </article>
  )
}


function buildReadingTrendOption(data, activeDay) {
  const points = data.length ? data : Array.from({ length: 7 }, (_, index) => ({
    day: `${index + 1}`.padStart(2, '0'),
    opens: 0,
  }))

  return {
    animationDuration: 900,
    animationEasing: 'cubicOut',
    grid: { left: 18, right: 18, top: 18, bottom: 28, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(8, 14, 36, 0.96)',
      borderColor: 'rgba(129, 140, 248, 0.26)',
      textStyle: { color: '#EAF2FF' },
      extraCssText: 'box-shadow: 0 18px 32px rgba(1,4,16,0.34); border-radius: 14px;',
      axisPointer: {
        type: 'line',
        lineStyle: { color: 'rgba(167, 139, 250, 0.48)', width: 1.5 },
      },
      formatter: (params) => {
        const item = params?.[0]
        if (!item) return ''
        return `${item.axisValue} 日<br/>阅读次数 <strong>${item.value}</strong>`
      },
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: points.map((item) => item.day),
      axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.18)' } },
      axisTick: { show: false },
      axisLabel: { color: '#8EA7C5', fontSize: 11, margin: 12 },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitNumber: 3,
      axisLabel: { color: '#7F97BA', fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.12)', type: 'dashed' } },
    },
    series: [
      {
        type: 'line',
        data: points.map((item) => item.opens),
        smooth: 0.35,
        symbol: 'circle',
        symbolSize: (value, params) => (activeDay && params.name === activeDay ? 10 : 7),
        lineStyle: {
          width: 3,
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 1,
            y2: 0,
            colorStops: [
              { offset: 0, color: '#38BDF8' },
              { offset: 0.6, color: '#8B5CF6' },
              { offset: 1, color: '#34D399' },
            ],
          },
          shadowBlur: 18,
          shadowColor: 'rgba(56, 189, 248, 0.22)',
        },
        itemStyle: {
          borderWidth: 2,
          borderColor: '#0B122A',
          color: '#A78BFA',
        },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(96, 165, 250, 0.28)' },
              { offset: 1, color: 'rgba(99, 102, 241, 0.02)' },
            ],
          },
        },
      },
    ],
  }
}

function buildImportTrendOption(data, activeDay) {
  const points = data.length ? data : Array.from({ length: 7 }, (_, index) => ({
    day: `${index + 1}`.padStart(2, '0'),
    imports: 0,
  }))

  return {
    animationDuration: 780,
    animationEasing: 'elasticOut',
    grid: { left: 14, right: 14, top: 22, bottom: 28, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(45, 212, 191, 0.12)' } },
      backgroundColor: 'rgba(8, 14, 36, 0.96)',
      borderColor: 'rgba(45, 212, 191, 0.24)',
      textStyle: { color: '#EAF2FF' },
      extraCssText: 'box-shadow: 0 18px 32px rgba(1,4,16,0.34); border-radius: 14px;',
      formatter: (params) => {
        const item = params?.[0]
        if (!item) return ''
        return `${item.axisValue} 日<br/>导入篇数 <strong>${item.value}</strong>`
      },
    },
    xAxis: {
      type: 'category',
      data: points.map((item) => item.day),
      axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.18)' } },
      axisTick: { show: false },
      axisLabel: { color: '#8EA7C5', fontSize: 11, margin: 12 },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitNumber: 3,
      axisLabel: { color: '#7F97BA', fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.12)', type: 'dashed' } },
    },
    series: [
      {
        type: 'bar',
        data: points.map((item) => ({
          value: item.imports,
          itemStyle: {
            color: item.day === activeDay
              ? {
                  type: 'linear',
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: '#F59E0B' },
                    { offset: 1, color: '#FB7185' },
                  ],
                }
              : {
                  type: 'linear',
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: '#22D3EE' },
                    { offset: 1, color: '#10B981' },
                  ],
                },
          },
        })),
        barWidth: '42%',
        showBackground: true,
        backgroundStyle: {
          color: 'rgba(30, 41, 59, 0.58)',
          borderRadius: [12, 12, 4, 4],
        },
        itemStyle: {
          borderRadius: [12, 12, 4, 4],
          shadowBlur: 18,
          shadowColor: 'rgba(34, 211, 238, 0.18)',
        },
      },
    ],
  }
}

function buildResourceMixOption(data, activeName) {
  const points = data.length ? data : [
    { name: '摘要', value: 0, color: '#7C3AED' },
    { name: '笔记', value: 0, color: '#22D3EE' },
    { name: '标注', value: 0, color: '#10B981' },
    { name: '翻译', value: 0, color: '#F97316' },
  ]

  return {
    animationDuration: 920,
    animationEasing: 'cubicOut',
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(8, 14, 36, 0.96)',
      borderColor: 'rgba(167, 139, 250, 0.24)',
      textStyle: { color: '#EAF2FF' },
      extraCssText: 'box-shadow: 0 18px 32px rgba(1,4,16,0.34); border-radius: 14px;',
      formatter: (params) => `${params.name}<br/><strong>${params.value}</strong> 项`,
    },
    series: [
      {
        type: 'pie',
        radius: ['56%', '78%'],
        center: ['50%', '50%'],
        padAngle: 3,
        itemStyle: {
          borderColor: '#151B34',
          borderWidth: 4,
          borderRadius: 8,
          shadowBlur: 26,
          shadowColor: 'rgba(7, 10, 24, 0.34)',
        },
        label: { show: false },
        emphasis: {
          scale: true,
          scaleSize: 8,
          itemStyle: {
            shadowBlur: 34,
            shadowColor: 'rgba(129, 140, 248, 0.24)',
          },
        },
        data: points.map((item) => ({
          name: item.name,
          value: item.value,
          itemStyle: {
            color: item.color,
            opacity: activeName && item.name !== activeName ? 0.32 : 1,
          },
        })),
      },
    ],
  }
}

function buildTimePreferenceOption(data, activeLabel) {
  const points = data.length ? data : [
    { label: '上午', value: 0, color: '#38BDF8' },
    { label: '下午', value: 0, color: '#A78BFA' },
    { label: '夜间', value: 0, color: '#34D399' },
  ]

  return {
    animationDuration: 820,
    animationEasing: 'cubicOut',
    grid: { left: 18, right: 18, top: 6, bottom: 6, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(96, 165, 250, 0.12)' } },
      backgroundColor: 'rgba(8, 14, 36, 0.96)',
      borderColor: 'rgba(96, 165, 250, 0.24)',
      textStyle: { color: '#EAF2FF' },
      extraCssText: 'box-shadow: 0 18px 32px rgba(1,4,16,0.34); border-radius: 14px;',
      formatter: (params) => {
        const item = params?.[0]
        if (!item) return ''
        return `${item.name}<br/><strong>${item.value}</strong> 次开始阅读`
      },
    },
    xAxis: {
      type: 'value',
      splitNumber: 3,
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: points.map((item) => item.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: '#A9BDD9', fontSize: 13, margin: 20 },
    },
    series: [
      {
        type: 'bar',
        data: points.map((item) => ({
          value: item.value,
          itemStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 1,
              y2: 0,
              colorStops: [
                { offset: 0, color: '#38BDF8' },
                { offset: 0.55, color: '#8B5CF6' },
                { offset: 1, color: item.color },
              ],
            },
            opacity: activeLabel && item.label !== activeLabel ? 0.32 : 1,
          },
        })),
        barWidth: 12,
        showBackground: true,
        backgroundStyle: {
          color: 'rgba(30, 41, 59, 0.82)',
          borderRadius: 999,
        },
        itemStyle: {
          borderRadius: 999,
          shadowBlur: 20,
          shadowColor: 'rgba(96, 165, 250, 0.18)',
        },
        label: {
          show: true,
          position: 'right',
          color: '#F8FAFC',
          fontSize: 13,
          fontWeight: 700,
          formatter: ({ value }) => `${value}`,
        },
      },
    ],
  }
}

function PetMascotSprite({ animation = 'idle', dockSide = 'right' }) {
  const resolvedAnimation = resolveMascotAnimation(animation, dockSide)
  const [frameIndex, setFrameIndex] = useState(0)
  const animationSpec = PET_ANIMATIONS[resolvedAnimation] || PET_ANIMATIONS.idle

  useEffect(() => {
    setFrameIndex(0)
  }, [resolvedAnimation])

  useEffect(() => {
    const duration = animationSpec.durations[frameIndex] || 140
    const timer = window.setTimeout(() => {
      setFrameIndex((current) => (current + 1) % animationSpec.durations.length)
    }, duration)

    return () => window.clearTimeout(timer)
  }, [animationSpec, frameIndex])

  return (
    <div className="home-insight-mascot__image" aria-hidden="true">
      <img
        src={PET_ATLAS.src}
        alt=""
        className="home-insight-mascot__sheet"
        draggable="false"
        style={{
          width: `${PET_ATLAS.columns * 100}%`,
          height: `${PET_ATLAS.rows * 100}%`,
          transform: `translate3d(${-frameIndex * (100 / PET_ATLAS.columns)}%, ${-animationSpec.row * (100 / PET_ATLAS.rows)}%, 0)`,
        }}
      />
    </div>
  )
}

function CatMascot({ message, onMouseDown, dockSide = 'right', pose = 'idle' }) {
  return (
    <div className={`home-insight-mascot home-insight-mascot--${dockSide}`} onMouseDown={onMouseDown}>
      <div className="home-insight-mascot__bubble" aria-live="polite">
        {message}
      </div>
      <PetMascotSprite animation={pose} dockSide={dockSide} />
    </div>
  )
}

export function ReadingInsightSection({
  dashboard,
  timeframe = 'month',
  onTimeframeChange,
}) {
  const [assistantMessage, setAssistantMessage] = useState('')
  const [assistantPose, setAssistantPose] = useState('idle')
  const [mascotDock, setMascotDock] = useState('right')
  const [mascotPosition, setMascotPosition] = useState({ x: 652, y: 78 })
  const [isDraggingMascot, setIsDraggingMascot] = useState(false)
  const [shouldAnimate, setShouldAnimate] = useState(false)
  const [interactiveFocus, setInteractiveFocus] = useState(null)
  const [lockedFocus, setLockedFocus] = useState(null)
  const sectionRef = useRef(null)
  const mascotStartRef = useRef(null)

  const overview = dashboard?.overview || {}
  const latestReading = formatDashboardDate(overview.latest_reading_at)
  const timeframeLabel = overview.timeframe_label || TIMEFRAME_EMPTY_LABELS[timeframe] || '本月'
  const timeframeSpokenLabel = overview.timeframe_spoken_label || timeframeLabel
  const dominantPeriodLabel = overview.dominant_period_label || '--'
  const totalPapers = Number(overview.total_papers) || 0
  const monthlyImports = Number(overview.monthly_imports) || 0
  const monthlyOpens = Number(overview.monthly_opens) || 0
  const monthlyReadPapers = Number(overview.monthly_read_papers) || 0
  const monthlyDurationSeconds = Number(overview.monthly_duration_seconds) || 0
  const monthlyDurationMinutes = Number(overview.monthly_duration_minutes) || 0
  const monthlyDurationHours = Number(overview.monthly_duration_hours) || 0
  const hasDurationData = monthlyDurationSeconds > 0
  const durationMetricValue = hasDurationData
    ? (monthlyDurationHours >= 1 ? `${monthlyDurationHours.toFixed(1)}` : `${monthlyDurationMinutes}`)
    : '待采集'
  const durationMetricUnit = hasDurationData
    ? (monthlyDurationHours >= 1 ? '小时' : '分钟')
    : '阅读时长'
  const papersWithNotes = Number(overview.papers_with_notes) || 0
  const noteBlocksTotal = Number(overview.note_blocks_total) || 0
  const annotationCount = Number(overview.annotation_count) || 0
  const totalReadings = (dashboard?.reading_trend || []).reduce((sum, item) => sum + (Number(item.opens) || 0), 0)
  const totalImports = (dashboard?.import_trend || []).reduce((sum, item) => sum + (Number(item.imports) || 0), 0)
  const totalResources = (dashboard?.resource_distribution || []).reduce((sum, item) => sum + (Number(item.value) || 0), 0)
  const topFolder = dashboard?.folder_distribution?.[0]?.name || '未分类'
  const topFolderCount = Number(dashboard?.folder_distribution?.[0]?.value) || 0
  const isEmptyState = !totalPapers && !monthlyOpens && !noteBlocksTotal && !annotationCount
  const defaultAssistantMessage = useMemo(() => buildMascotOverviewMessage({
    monthlyOpens,
    monthlyDurationMinutes,
    monthlyImports,
    totalResources,
    dominantPeriodLabel,
    topFolder,
    topFolderCount,
    timeframeSpokenLabel,
  }), [monthlyOpens, monthlyDurationMinutes, monthlyImports, totalResources, dominantPeriodLabel, topFolder, topFolderCount, timeframeSpokenLabel])

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShouldAnimate(true)
          observer.disconnect()
        }
      },
      { threshold: 0.25 },
    )
    if (sectionRef.current) observer.observe(sectionRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (isDraggingMascot) {
      setAssistantPose('dragging')
      return undefined
    }

    if (lockedFocus?.message) {
      setAssistantMessage(lockedFocus.message)
      setAssistantPose(lockedFocus.pose || 'review')
      return undefined
    }

    if (defaultAssistantMessage) {
      setAssistantMessage(defaultAssistantMessage)
    }

    const timer = window.setTimeout(() => {
      setAssistantPose(isEmptyState ? 'waiting' : 'idle')
    }, 5200)

    return () => window.clearTimeout(timer)
  }, [defaultAssistantMessage, assistantMessage, isDraggingMascot, isEmptyState, lockedFocus])

  useEffect(() => {
    function handleMove(event) {
      if (!isDraggingMascot || !mascotStartRef.current) return
      const width = 112
      const height = 168
      const gutter = 12
      const nextX = Math.min(Math.max(gutter, event.clientX - mascotStartRef.current.offsetX), window.innerWidth - width - gutter)
      const nextY = Math.min(Math.max(gutter, event.clientY - mascotStartRef.current.offsetY), window.innerHeight - height - gutter)
      setMascotPosition({ x: nextX, y: nextY })
      setMascotDock(nextX < window.innerWidth / 2 ? 'left' : 'right')
    }

    function handleUp() {
      if (!isDraggingMascot) return
      setIsDraggingMascot(false)
      mascotStartRef.current = null
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [isDraggingMascot])

  const chartConfig = {
    opens: { label: '阅读次数', color: 'var(--color-chart-1)' },
    imports: { label: '导入篇数', color: 'var(--color-chart-2)' },
    value: { label: '总量', color: 'var(--color-chart-1)' },
  }

  const summaryCards = [
    {
      id: 'papers',
      label: '文献总数',
      value: totalPapers,
      detail: monthlyImports ? `${timeframeLabel}新增 ${monthlyImports} 篇` : `${timeframeLabel}暂无新增`,
      icon: Inbox,
      accent: 'violet',
      helpKey: 'statPapers',
    },
    {
      id: 'opens',
      label: `${timeframeLabel}阅读次数`,
      value: monthlyOpens,
      detail: monthlyReadPapers ? `${monthlyReadPapers} 篇文献被打开` : '还没有产生阅读记录',
      icon: Flame,
      accent: 'emerald',
      helpKey: 'statOpens',
    },
    {
      id: 'notes',
      label: '笔记沉淀',
      value: noteBlocksTotal,
      detail: papersWithNotes ? `${papersWithNotes} 篇文献留下笔记` : '还没有笔记沉淀',
      icon: NotebookPen,
      accent: 'amber',
      helpKey: 'statNotes',
    },
    {
      id: 'annotations',
      label: '标注总量',
      value: annotationCount,
      detail: latestReading === '--' ? '最近还没有阅读动作' : `最近阅读：${latestReading}`,
      icon: Highlighter,
      accent: 'sky',
      helpKey: 'statAnnotations',
    },
  ]

  const favoriteWindow = useMemo(() => {
    const sorted = [...(dashboard?.time_distribution || [])].sort((left, right) => (Number(right.value) || 0) - (Number(left.value) || 0))
    return sorted[0]?.label || dominantPeriodLabel
  }, [dashboard?.time_distribution, dominantPeriodLabel])

  const readingTrendData = useMemo(
    () => (dashboard?.reading_trend || []).map((item) => ({
      ...item,
      opens: Number(item.opens) || 0,
    })),
    [dashboard?.reading_trend],
  )

  const importTrendData = useMemo(
    () => (dashboard?.import_trend || []).map((item) => ({
      ...item,
      imports: Number(item.imports) || 0,
    })),
    [dashboard?.import_trend],
  )

  const resourceDistributionData = useMemo(
    () => (dashboard?.resource_distribution || []).map((item, index) => ({
      ...item,
      value: Number(item.value) || 0,
      color: RESOURCE_DISTRIBUTION_TONES[item.name] || RESOURCE_DISTRIBUTION_COLORS[index % RESOURCE_DISTRIBUTION_COLORS.length],
    })),
    [dashboard?.resource_distribution],
  )

  const timeDistributionData = useMemo(
    () => (dashboard?.time_distribution || []).map((item) => ({
      ...item,
      value: Number(item.value) || 0,
      color: TIME_DISTRIBUTION_TONES[item.label] || '#60A5FA',
    })),
    [dashboard?.time_distribution],
  )

  const readingTrendOption = useMemo(
    () => buildReadingTrendOption(readingTrendData, lockedFocus?.chart === 'readingTrend' ? lockedFocus.key : interactiveFocus?.chart === 'readingTrend' ? interactiveFocus.key : ''),
    [readingTrendData, interactiveFocus, lockedFocus],
  )

  const importTrendOption = useMemo(
    () => buildImportTrendOption(importTrendData, lockedFocus?.chart === 'importTrend' ? lockedFocus.key : interactiveFocus?.chart === 'importTrend' ? interactiveFocus.key : ''),
    [importTrendData, interactiveFocus, lockedFocus],
  )

  const resourceMixOption = useMemo(
    () => buildResourceMixOption(resourceDistributionData, lockedFocus?.chart === 'resourceMix' ? lockedFocus.key : interactiveFocus?.chart === 'resourceMix' ? interactiveFocus.key : ''),
    [resourceDistributionData, interactiveFocus, lockedFocus],
  )

  const timePreferenceOption = useMemo(
    () => buildTimePreferenceOption(timeDistributionData, lockedFocus?.chart === 'timePreference' ? lockedFocus.key : interactiveFocus?.chart === 'timePreference' ? interactiveFocus.key : ''),
    [timeDistributionData, interactiveFocus, lockedFocus],
  )

  const resourceDistributionTotal = useMemo(
    () => resourceDistributionData.reduce((sum, item) => sum + (Number(item.value) || 0), 0),
    [resourceDistributionData],
  )

  const resourceDistributionDetails = useMemo(
    () => resourceDistributionData.map((item) => {
      const value = Number(item.value) || 0
      const percent = resourceDistributionTotal > 0 ? Math.round((value / resourceDistributionTotal) * 100) : 0
      return {
        ...item,
        value,
        percent,
        description: RESOURCE_DISTRIBUTION_COPY[item.name] || '这部分内容会逐步补齐你的阅读沉淀结构。',
      }
    }),
    [resourceDistributionData, resourceDistributionTotal],
  )

  const activeResourceMixKey = lockedFocus?.chart === 'resourceMix'
    ? lockedFocus.key
    : interactiveFocus?.chart === 'resourceMix'
      ? interactiveFocus.key
      : ''

  function handleHoverStart(helpKey) {
    setAssistantMessage(HELP_COPY[helpKey] || '这里展示的是你当前阶段最重要的一组阅读数据。')
    if (helpKey === 'resourceMix' || helpKey === 'statNotes') {
      setAssistantPose('review')
      return
    }
    if (helpKey === 'timePreference') {
      setAssistantPose('waiting')
      return
    }
    setAssistantPose(HELP_ANIMATIONS[helpKey] || 'waving')
  }

  function handleHoverEnd() {
    if (lockedFocus?.message) {
      setAssistantMessage(lockedFocus.message)
      setAssistantPose(lockedFocus.pose || 'review')
      return
    }
    setAssistantMessage(defaultAssistantMessage)
    setAssistantPose(isEmptyState ? 'waiting' : 'idle')
  }

  function handleInteractiveFocus(payload) {
    setInteractiveFocus(payload)
    if (lockedFocus) return
    if (payload?.message) {
      setAssistantMessage(payload.message)
      setAssistantPose(payload.pose || 'review')
    }
  }

  function handleInteractiveBlur() {
    setInteractiveFocus(null)
    if (lockedFocus?.message) {
      setAssistantMessage(lockedFocus.message)
      setAssistantPose(lockedFocus.pose || 'review')
      return
    }
    handleHoverEnd()
  }

  function toggleInteractiveLock(payload) {
    setLockedFocus((current) => {
      if (current?.id === payload?.id) {
        return null
      }
      return payload
    })
  }

  function handleMascotPointerDown(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    mascotStartRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    }
    setAssistantMessage('拖着我走，松手后我会自动贴边，不挡住你的图表。')
    setAssistantPose('dragging')
    setIsDraggingMascot(true)
  }

  return (
    <div className="home-insights home-insights--dark" ref={sectionRef}>
      <div className="home-insights__hero">
        <div className="home-insights__hero-copy">
          <Badge variant="secondary" className="home-insights__eyebrow">
            <Sparkles />
            阅读信息站
          </Badge>
          <h2>你的阅读，不该只停留在“打开过”</h2>
          <p>{isEmptyState ? '现在这里还没有真正亮起来，等你开始阅读、做标注、写笔记之后，这里会逐步变成你的个人阅读驾驶舱。' : '这里把你真实留下来的阅读、笔记和标注整理成一块可以被看见的成果面板。'}</p>
          <div className="home-insights__hero-meta">
            <span>{latestReading === '--' ? '最近还没有阅读动作' : `最近阅读：${latestReading}`}</span>
            <span>{favoriteWindow === '--' ? '偏好时段待形成' : `偏好时段：${favoriteWindow}`}</span>
            <span>{topFolderCount ? `${topFolder} 在${timeframeLabel}最活跃，涉及 ${topFolderCount} 篇` : '文献分类正在等待你填满'}</span>
          </div>
          <div className="home-insights__hero-duration" data-insight-help="readingTrend" onMouseEnter={() => handleHoverStart('readingTrend')} onMouseLeave={handleHoverEnd}>
            <div className="home-insights__hero-duration-top">
              <span className="home-insights__hero-duration-label">{timeframeLabel}阅读时长</span>
              <div className="home-insights__hero-duration-metric">
                <strong>{durationMetricValue}</strong>
                <small>{durationMetricUnit}</small>
              </div>
            </div>
            <p>{hasDurationData ? `${timeframeSpokenLabel}你已经认真读了约 ${monthlyDurationMinutes} 分钟，时间不是路过，是实打实留下来的。` : '先把时间攒起来。只要你在阅读页里停一会儿，这里就会比“打开过”更诚实。'}</p>
          </div>
        </div>

        <div className="home-insights__hero-side">
          <Tabs value={timeframe} onValueChange={onTimeframeChange} className="home-insights__tabs">
            <TabsList className="home-insights__tabs-list">
              {Object.entries(TIMEFRAME_LABELS).map(([key, label]) => (
                <TabsTrigger
                  key={key}
                  value={key}
                  className="home-insights__tabs-trigger"
                  aria-label={`切换到${TIMEFRAME_EMPTY_LABELS[key] || label}`}
                >
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="home-insights__hero-rings">
            <div className="home-insights__orb home-insights__orb--violet" />
            <div className="home-insights__orb home-insights__orb--green" />
            <div className="home-insights__hero-grid" />
          </div>
        </div>
      </div>

      <div className="home-insights__summary-grid">
        {summaryCards.map((item, index) => (
          <InsightStatCard
            key={item.id}
            item={item}
            index={index}
            animate={shouldAnimate}
            onHoverStart={handleHoverStart}
            onHoverEnd={handleHoverEnd}
          />
        ))}
      </div>

      <div className="home-insights__feature-grid">
        <Card className="home-insight-panel home-insight-panel--hero" data-insight-help="readingTrend" onMouseEnter={() => handleHoverStart('readingTrend')} onMouseLeave={handleHoverEnd}>
          <CardHeader className="home-insight-panel__header">
            <div>
              <CardTitle>阅读活跃趋势</CardTitle>
              <CardDescription>{totalReadings ? `看${timeframeLabel}哪些时段真的读过` : `${timeframeLabel}还没有阅读动作`}</CardDescription>
            </div>
            <CardAction>
              <Badge variant="outline">{timeframeLabel}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="home-insight-panel__content home-insight-panel__content--chart">
            <EChartPanel
              className="home-insight-echart home-insight-echart--trend"
              option={readingTrendOption}
              onMouseOver={(params) => {
                if (params?.componentType !== 'series') return
                handleInteractiveFocus({
                  id: `readingTrend-${params.name}`,
                  chart: 'readingTrend',
                  key: String(params.name || ''),
                  pose: 'running',
                  message: `${params.name} 这一档你一共打开了 ${params.value || 0} 次文献，这是你${timeframeLabel}阅读节奏的一部分。`,
                })
              }}
              onGlobalOut={handleInteractiveBlur}
              onClick={(params) => {
                if (params?.componentType !== 'series') return
                toggleInteractiveLock({
                  id: `readingTrend-${params.name}`,
                  chart: 'readingTrend',
                  key: String(params.name || ''),
                  pose: 'running',
                  message: `${params.name} 日已锁定：这一天你打开了 ${params.value || 0} 次文献，可以拿它和别的日期对照阅读强度。`,
                })
              }}
            />
          </CardContent>
        </Card>

        <Card className="home-insight-panel home-insight-panel--glow" data-insight-help="resourceMix" onMouseEnter={() => handleHoverStart('resourceMix')} onMouseLeave={handleHoverEnd}>
          <CardHeader className="home-insight-panel__header">
            <div>
              <CardTitle>成果沉淀构成</CardTitle>
              <CardDescription>{totalResources ? '看你到底留下了多少内容' : '还没有沉淀出可回看的内容'}</CardDescription>
            </div>
            <CardAction>
              <Badge variant="outline">{formatCompactNumber(totalResources)} 项</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="home-insight-panel__content home-insight-panel__content--pie">
            <div className="home-insight-resource-grid">
              <div className="home-insight-donut-wrap">
                <div className="home-insight-donut-chart">
                  <EChartPanel
                    className="home-insight-echart home-insight-echart--donut"
                    option={resourceMixOption}
                    onMouseOver={(params) => {
                      if (params?.componentType !== 'series') return
                      handleInteractiveFocus({
                        id: `resourceMix-${params.name}`,
                        chart: 'resourceMix',
                        key: String(params.name || ''),
                        pose: 'review',
                        message: `${params.name} 现在有 ${params.value || 0} 项，这说明你的沉淀目前主要落在这一类。`,
                      })
                    }}
                    onGlobalOut={handleInteractiveBlur}
                    onClick={(params) => {
                      if (params?.componentType !== 'series') return
                      toggleInteractiveLock({
                        id: `resourceMix-${params.name}`,
                        chart: 'resourceMix',
                        key: String(params.name || ''),
                        pose: 'review',
                        message: `${params.name} 已锁定：目前这类沉淀有 ${params.value || 0} 项，你可以拿它判断自己的输出偏向。`,
                      })
                    }}
                  />
                </div>
                <div className="home-insight-donut-core">
                  <strong>{formatCompactNumber(activeResourceMixKey ? resourceDistributionDetails.find((item) => item.name === activeResourceMixKey)?.value || 0 : totalResources)}</strong>
                  <span>{activeResourceMixKey || '沉淀内容'}</span>
                </div>
              </div>
              <div className="home-insight-resource-list">
                {resourceDistributionDetails.map((item) => {
                  const isActive = activeResourceMixKey === item.name
                  return (
                    <button
                      key={item.name}
                      type="button"
                      className={`home-insight-resource-item${isActive ? ' is-active' : ''}`}
                      onMouseEnter={() => handleInteractiveFocus({
                        id: `resourceMix-${item.name}`,
                        chart: 'resourceMix',
                        key: item.name,
                        pose: 'review',
                        message: `${item.name} 目前有 ${item.value} 项，占沉淀内容的 ${item.percent}%。`,
                      })}
                      onMouseLeave={handleInteractiveBlur}
                      onClick={() => toggleInteractiveLock({
                        id: `resourceMix-${item.name}`,
                        chart: 'resourceMix',
                        key: item.name,
                        pose: 'review',
                        message: `${item.name} 已锁定：目前有 ${item.value} 项，占沉淀内容的 ${item.percent}%。`,
                      })}
                    >
                      <span className="home-insight-resource-item__top">
                        <span className="home-insight-resource-item__label">
                          <i
                            className="home-insight-resource-item__swatch"
                            style={{ backgroundColor: item.color }}
                          />
                          {item.name}
                        </span>
                        <strong>{item.value}</strong>
                      </span>
                      <span className="home-insight-resource-item__meta">{item.percent}%</span>
                      <span className="home-insight-resource-item__desc">{item.description}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="home-insight-panel" data-insight-help="importTrend" onMouseEnter={() => handleHoverStart('importTrend')} onMouseLeave={handleHoverEnd}>
          <CardHeader className="home-insight-panel__header">
            <div>
              <CardTitle>导入节奏</CardTitle>
              <CardDescription>{totalImports ? `看${timeframeLabel}输入节奏有没有跑起来` : `${timeframeLabel}还没有导入动作`}</CardDescription>
            </div>
            <CardAction>
              <Badge variant="outline">{formatCompactNumber(totalImports)} 篇</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="home-insight-panel__content home-insight-panel__content--chart-sm">
            <EChartPanel
              className="home-insight-echart home-insight-echart--bars"
              option={importTrendOption}
              onMouseOver={(params) => {
                if (params?.componentType !== 'series') return
                handleInteractiveFocus({
                  id: `importTrend-${params.name}`,
                  chart: 'importTrend',
                  key: String(params.name || ''),
                  pose: 'jumping',
                  message: `${params.name} 日导入了 ${params.value || 0} 篇文献，这一天的输入动作会影响后续阅读节奏。`,
                })
              }}
              onGlobalOut={handleInteractiveBlur}
              onClick={(params) => {
                if (params?.componentType !== 'series') return
                toggleInteractiveLock({
                  id: `importTrend-${params.name}`,
                  chart: 'importTrend',
                  key: String(params.name || ''),
                  pose: 'jumping',
                  message: `${params.name} 日已锁定：这一天导入了 ${params.value || 0} 篇文献，可以拿来观察输入高峰。`,
                })
              }}
            />
          </CardContent>
        </Card>

        <Card className="home-insight-panel" data-insight-help="timePreference" onMouseEnter={() => handleHoverStart('timePreference')} onMouseLeave={handleHoverEnd}>
          <CardHeader className="home-insight-panel__header">
            <div>
              <CardTitle>阅读时段偏好</CardTitle>
              <CardDescription>{dominantPeriodLabel !== '--' ? `${dominantPeriodLabel}是你最常开始阅读的时段` : '还没有足够数据判断偏好'}</CardDescription>
            </div>
            <CardAction>
              <Badge variant="secondary">{dominantPeriodLabel}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="home-insight-panel__content">
            <EChartPanel
              className="home-insight-echart home-insight-echart--time"
              option={timePreferenceOption}
              onMouseOver={(params) => {
                if (params?.componentType !== 'series') return
                handleInteractiveFocus({
                  id: `timePreference-${params.name}`,
                  chart: 'timePreference',
                  key: String(params.name || ''),
                  pose: 'waiting',
                  message: `${params.name} 是你当前阅读开始最密集的时段之一，这能帮助判断你的稳定阅读窗口。`,
                })
              }}
              onGlobalOut={handleInteractiveBlur}
              onClick={(params) => {
                if (params?.componentType !== 'series') return
                toggleInteractiveLock({
                  id: `timePreference-${params.name}`,
                  chart: 'timePreference',
                  key: String(params.name || ''),
                  pose: 'waiting',
                  message: `${params.name} 已锁定：这段时间是你更容易进入阅读状态的窗口。`,
                })
              }}
            />
          </CardContent>
        </Card>
      </div>

      <div className="home-insights__detail-grid">
        <Card className="home-insight-panel">
          <CardHeader className="home-insight-panel__header">
            <div>
              <CardTitle>高价值文献</CardTitle>
              <CardDescription>{dashboard?.spotlight_papers?.length ? '这些文献最值得你回看' : '等你多读几篇，这里会自动浮出重点文献'}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="home-insight-panel__content home-insight-panel__content--list">
            <ScrollArea className="home-insight-scroll">
              <div className="home-insight-list">
                {(dashboard?.spotlight_papers || []).length ? (
                  (dashboard?.spotlight_papers || []).map((paper, index) => (
                    <div key={paper.paper_id || paper.title} className="home-insight-list__item">
                      <div className="home-insight-list__rank">{index + 1}</div>
                      <div className="home-insight-list__body">
                        <strong>{paper.title}</strong>
                        <span>{paper.folder_name}</span>
                      </div>
                      <div className="home-insight-list__metrics">
                        <span>{paper.reads || 0} 次阅读</span>
                        <span>{paper.notes || 0} 条笔记</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="home-insight-empty">还没有阅读记录，先打开几篇文献，这里会自动识别高价值内容。</div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="home-insight-panel">
          <CardHeader className="home-insight-panel__header">
            <div>
              <CardTitle>最近导入</CardTitle>
              <CardDescription>这几篇是刚进站的新材料，通常会决定你接下来要读什么。</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="home-insight-panel__content home-insight-panel__content--list">
            <div className="home-insight-stream__label">
              <PackageCheck />
              <span>最近导入</span>
            </div>
            <div className="home-insight-stream home-insight-stream--single">
              {(dashboard?.recent_imports || []).length ? (
                (dashboard?.recent_imports || []).map((item) => (
                  <div key={`${item.paper_id}-${item.created_at}`} className="home-insight-stream__item">
                    <strong>{item.title}</strong>
                    <span>{item.folder_name}</span>
                    <time>{formatDashboardDate(item.created_at)}</time>
                  </div>
                ))
              ) : (
                <div className="home-insight-empty">还没有最近导入动作。</div>
              )}
            </div>
          </CardContent>
        </Card>

      </div>

      <div
        className="home-insight-mascot-layer"
        style={{
          left: mascotPosition.x != null ? `${mascotPosition.x}px` : 'auto',
          right: mascotPosition.x == null ? '12px' : 'auto',
          top: mascotPosition.y != null ? `${mascotPosition.y}px` : 'auto',
          bottom: mascotPosition.y == null ? '16px' : 'auto',
        }}
      >
        <CatMascot
          message={assistantMessage}
          dockSide={mascotDock}
          pose={assistantPose}
          onMouseDown={handleMascotPointerDown}
        />
      </div>
    </div>
  )
}
