import { useEffect, useId, useRef, useState } from 'react'
import { formatDate, formatDayMonth, peakDay, plural } from '../lib/leaderboard.js'
import '../styles/ActivityChart.css'

const MIN_DAYS = 5
const TOP_PAD = 10
const PLOT_HEIGHT = 150
const AXIS_HEIGHT = 26
const HEIGHT = TOP_PAD + PLOT_HEIGHT + AXIS_HEIGHT
const LABEL_HALF_WIDTH = 24
const MAX_BAR_WIDTH = 28
const BAR_FILL = 0.7
const MIN_BAR_HEIGHT = 2
// Y-axis gutter: room for the widest tick value plus a gap before the plot
const DIGIT_WIDTH = 8
const GUTTER_PAD = 10
const TICK_GAP = 8
const DATE_LABEL_OFFSET = 18
// A narrow chart always gets 5 date labels; a wider one gets one per MIN_LABEL_SPACING px
const NARROW_CHART_WIDTH = 544
const NARROW_LABELS = 5
const MIN_LABEL_SPACING = 72
const TOOLTIP_EDGE = 80
const TOOLTIP_RISE = 40

// An even "nice" top keeps the half-way gridline a whole number.
function niceTop(max) {
  const magnitude = 10 ** Math.floor(Math.log10(max))
  for (const factor of [1, 2, 4, 5, 6, 8, 10]) {
    const top = factor * magnitude
    if (top >= max && top % 2 === 0) return top
  }
  return 10 * magnitude
}

function dayLabel(day) {
  return `${formatDayMonth(day.date)}: ${plural(day.count, 'badge')}`
}

export default function ActivityChart({ dailyCounts }) {
  const days = Array.isArray(dailyCounts) ? dailyCounts : []
  const peak = peakDay(days)
  const visible = days.length >= MIN_DAYS && peak !== null

  const headingId = useId()
  const wrapRef = useRef(null)
  const hitRefs = useRef([])
  const [width, setWidth] = useState(0)
  const [active, setActive] = useState(null)
  const [focusIndex, setFocusIndex] = useState(null)
  const [focusVisible, setFocusVisible] = useState(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setWidth(Math.floor(el.clientWidth))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (active === null) return
    const handlePointerDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) setActive(null)
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setActive(null)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [active])

  if (!visible) return null

  const n = days.length
  const top = niceTop(peak.count)
  const gutter = String(top).length * DIGIT_WIDTH + GUTTER_PAD
  const plotWidth = Math.max(0, width - gutter)
  const band = plotWidth / n
  const barWidth = Math.max(1, Math.min(band * BAR_FILL, MAX_BAR_WIDTH))
  const baseline = TOP_PAD + PLOT_HEIGHT
  const centerOf = (i) => gutter + (i + 0.5) * band
  const barHeight = (count) => (count > 0 ? Math.max(MIN_BAR_HEIGHT, (count / top) * PLOT_HEIGHT) : 0)

  const maxLabels = width < NARROW_CHART_WIDTH ? NARROW_LABELS : Math.max(2, Math.floor(plotWidth / MIN_LABEL_SPACING))
  const labelStep = Math.max(1, Math.ceil((n - 1) / (maxLabels - 1)))
  const rovingIndex = focusIndex ?? n - 1

  const total = days.reduce((sum, day) => sum + day.count, 0)
  const summary = `Peak: ${plural(peak.count, 'badge')} on ${formatDate(peak.date)}. Total: ${plural(total, 'badge')} over ${plural(n, 'day')}.`

  function handleKeyDown(event, i) {
    const moves = { ArrowLeft: i - 1, ArrowRight: i + 1, Home: 0, End: n - 1 }
    if (!(event.key in moves)) return
    event.preventDefault()
    const next = Math.min(n - 1, Math.max(0, moves[event.key]))
    hitRefs.current[next]?.focus()
  }

  function handleFocus(event, i) {
    setFocusIndex(i)
    setFocusVisible(event.target.matches(':focus-visible'))
    setActive(i)
  }

  function handleBlur(event) {
    if (wrapRef.current?.contains(event.relatedTarget)) return
    setFocusVisible(false)
    setActive(null)
  }

  function handlePointerLeave(event) {
    if (event.pointerType !== 'mouse') return
    const focused = wrapRef.current?.contains(document.activeElement)
    setActive(focused ? focusIndex : null)
  }

  let tooltip = null
  if (active !== null && width > 0) {
    const day = days[active]
    const x = centerOf(active)
    const edge = x < TOOLTIP_EDGE ? 'start' : x > width - TOOLTIP_EDGE ? 'end' : 'middle'
    const position = edge === 'end' ? { right: width - x - band / 2 } : { left: edge === 'start' ? x - band / 2 : x }
    tooltip = (
      <div
        className={`activity-chart__tooltip${edge === 'middle' ? ' activity-chart__tooltip--middle' : ''}`}
        style={{ ...position, top: Math.max(0, baseline - barHeight(day.count) - TOOLTIP_RISE) }}
        aria-hidden="true"
      >
        {formatDayMonth(day.date)} · {plural(day.count, 'badge')}
      </div>
    )
  }

  return (
    <section className="activity-chart" aria-labelledby={headingId}>
      <h2 id={headingId} className="activity-chart__title">Badges earned per day</h2>
      <p className="visually-hidden">{summary}</p>
      <div ref={wrapRef} className="activity-chart__plot" style={{ height: HEIGHT }}>
        {width > 0 && (
          <svg
            className="activity-chart__svg"
            width="100%"
            height={HEIGHT}
            viewBox={`0 0 ${width} ${HEIGHT}`}
            role="group"
            aria-label="Daily badge counts. Use the arrow keys to move between days."
            onPointerLeave={handlePointerLeave}
          >
            <g aria-hidden="true">
              {active !== null && (
                <rect className="activity-chart__highlight" x={gutter + active * band} y={TOP_PAD} width={band} height={PLOT_HEIGHT} />
              )}
              {[top, top / 2].map((value) => {
                const y = baseline - (value / top) * PLOT_HEIGHT
                return (
                  <g key={value}>
                    <line className="activity-chart__grid" x1={gutter} x2={width} y1={y} y2={y} />
                    <text className="activity-chart__label" x={gutter - TICK_GAP} y={y} textAnchor="end" dominantBaseline="middle">
                      {value}
                    </text>
                  </g>
                )
              })}
              <line className="activity-chart__axis" x1={gutter} x2={width} y1={baseline} y2={baseline} />
              {days.map((day, i) => {
                const h = barHeight(day.count)
                return h > 0 ? (
                  <rect
                    key={day.date}
                    className="activity-chart__bar"
                    x={centerOf(i) - barWidth / 2}
                    y={baseline - h}
                    width={barWidth}
                    height={h}
                  />
                ) : null
              })}
              {focusVisible && focusIndex !== null && (
                <rect
                  className="activity-chart__focus"
                  x={gutter + focusIndex * band + 1}
                  y={TOP_PAD}
                  width={Math.max(0, band - 2)}
                  height={PLOT_HEIGHT}
                />
              )}
              {days.map((day, i) => {
                if (i % labelStep !== 0) return null
                const x = centerOf(i)
                const anchor = x - LABEL_HALF_WIDTH < 0 ? 'start' : x + LABEL_HALF_WIDTH > width ? 'end' : 'middle'
                const labelX = anchor === 'start' ? 0 : anchor === 'end' ? width : x
                return (
                  <text key={day.date} className="activity-chart__label" x={labelX} y={baseline + DATE_LABEL_OFFSET} textAnchor={anchor}>
                    {formatDayMonth(day.date)}
                  </text>
                )
              })}
            </g>
            {days.map((day, i) => (
              <rect
                key={day.date}
                ref={(el) => {
                  hitRefs.current[i] = el
                }}
                className="activity-chart__hit"
                x={gutter + i * band}
                y={0}
                width={band}
                height={HEIGHT}
                tabIndex={i === rovingIndex ? 0 : -1}
                role="img"
                aria-label={dayLabel(day)}
                onPointerEnter={() => setActive(i)}
                onFocus={(event) => handleFocus(event, i)}
                onBlur={handleBlur}
                onKeyDown={(event) => handleKeyDown(event, i)}
              />
            ))}
          </svg>
        )}
        {tooltip}
      </div>
    </section>
  )
}
