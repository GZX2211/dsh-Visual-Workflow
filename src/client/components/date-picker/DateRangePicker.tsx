// src/client/components/date-picker/DateRangePicker.tsx
//
// 双月日历日期范围选择器（样式参考用户提供的日历素材：左右双月并排、‹ › 翻月、
// 选中范围深色条带、首尾端点白底圆、今日圆环、非当月日灰显）。
// 受控组件：value = { start, end }（"YYYY-MM-DD" | null），点选语义：
//   无起点 → 设为起点；有起点无终点 → 设置终点（早于起点则重置起点）；双端已定 → 重置起点。

import { useEffect, useMemo, useRef, useState } from 'react'

export interface DateRangeValue {
  start: string | null
  end: string | null
}

export interface DateRangePickerProps {
  value: DateRangeValue
  onChange(value: DateRangeValue): void
  /** 星期表头（7 个字符；默认 日一二三四五六）。 */
  weekdays?: string[]
  /** 翻月按钮可访问标签。 */
  prevLabel?: string
  nextLabel?: string
}

/** 日历单格：day 为日号；year/month 为格子的实际所属年月（前后月灰显格取其真实年月）。 */
interface CalendarCell {
  key: string
  year: number
  month: number
  day: number
  inMonth: boolean
}

interface MonthView {
  year: number
  month: number
  cells: CalendarCell[]
}

/** 解析 "YYYY-MM-DD"；非法返回 null。 */
function parseDate(value: string | null): { year: number; month: number; day: number } | null {
  if (!value) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null
  return { year, month, day }
}

function fmt(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const DAY_MS = 86_400_000

/** 日期键（UTC 日序号；范围比较用）。 */
function dayKey(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS)
}

function todayKey(): number {
  const now = new Date()
  return dayKey(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

/**
 * 生成某月视图：首行前导位与前月灰显格、末行补齐位与次月灰显格
 * （与参考素材一致：前后月日号灰显、不可点击）。
 */
function buildMonthView(year: number, month: number): MonthView {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay() // 0=周日
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const prevYear = month === 1 ? year - 1 : year
  const prevMonth = month === 1 ? 12 : month - 1
  const daysInPrev = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate()
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const cells: CalendarCell[] = []
  const total = Math.ceil((firstWeekday + daysInMonth) / 7) * 7
  for (let i = 0; i < total; i += 1) {
    const day = i + 1 - firstWeekday
    if (day < 1) {
      cells.push({ key: `p:${day}`, year: prevYear, month: prevMonth, day: daysInPrev + day, inMonth: false })
    } else if (day > daysInMonth) {
      cells.push({ key: `n:${day}`, year: nextYear, month: nextMonth, day: day - daysInMonth, inMonth: false })
    } else {
      cells.push({ key: `d:${day}`, year, month, day, inMonth: true })
    }
  }
  return { year, month, cells }
}

export function DateRangePicker({ value, onChange, weekdays, prevLabel, nextLabel }: DateRangePickerProps) {
  const today = todayKey()
  const start = parseDate(value.start)
  const end = parseDate(value.end)
  const startKey = start ? dayKey(start.year, start.month, start.day) : null
  const endKey = end ? dayKey(end.year, end.month, end.day) : null
  const weekHeader = weekdays ?? ['日', '一', '二', '三', '四', '五', '六']

  /** 月偏移（跨年归一）。 */
  const addMonths = (year: number, month: number, delta: number): { year: number; month: number } => {
    const total = year * 12 + (month - 1) + delta
    return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 + 1 }
  }
  const monthIndex = (p: { year: number; month: number }): number => p.year * 12 + (p.month - 1)

  /** 左/右月独立导航（右月恒 > 左月）；初始 = 起点所属月 + 次月。 */
  const [range, setRange] = useState<{ left: { year: number; month: number }; right: { year: number; month: number } }>(() => {
    const base = start ?? { year: new Date().getFullYear(), month: new Date().getMonth() + 1 }
    return { left: { year: base.year, month: base.month }, right: addMonths(base.year, base.month, 1) }
  })

  // 外部 value.start 变化（如切换任务）→ 视图跳到起点所属月，右月取次月
  const syncedRef = useRef<string | null>(value.start)
  useEffect(() => {
    if (value.start && value.start !== syncedRef.current) {
      syncedRef.current = value.start
      const s = parseDate(value.start)
      if (s) {
        const left = { year: s.year, month: s.month }
        setRange({ left, right: addMonths(s.year, s.month, 1) })
      }
    }
  }, [value.start])

  /** 左月翻页：左月移动；若 ≥ 右月则右月跟进为左月+1。 */
  const moveLeft = (delta: number): void => {
    const nextLeft = addMonths(range.left.year, range.left.month, delta)
    const nextRight = monthIndex(nextLeft) >= monthIndex(range.right) ? addMonths(nextLeft.year, nextLeft.month, 1) : range.right
    setRange({ left: nextLeft, right: nextRight })
  }

  /** 右月翻页：右月移动；若 ≤ 左月则钳制为左月+1。 */
  const moveRight = (delta: number): void => {
    let nextRight = addMonths(range.right.year, range.right.month, delta)
    if (monthIndex(nextRight) <= monthIndex(range.left)) nextRight = addMonths(range.left.year, range.left.month, 1)
    setRange({ left: range.left, right: nextRight })
  }

  const leftView = useMemo(() => buildMonthView(range.left.year, range.left.month), [range])
  const rightView = useMemo(() => buildMonthView(range.right.year, range.right.month), [range])

  const pick = (year: number, month: number, day: number): void => {
    const key = dayKey(year, month, day)
    if (startKey === null || endKey !== null) {
      onChange({ start: fmt(year, month, day), end: null })
      return
    }
    if (key < startKey) {
      // 早于起点：重置起点
      onChange({ start: fmt(year, month, day), end: null })
      return
    }
    onChange({ start: value.start, end: fmt(year, month, day) })
  }

  const cellClass = (key: number, inMonth: boolean): string => {
    if (!inMonth) return 'wf-cal-cell is-dim'
    const classes = ['wf-cal-cell']
    if (key === today) classes.push('is-today')
    const isStart = startKey === key
    const isEnd = endKey === key || (startKey === key && endKey === null)
    if (isStart) classes.push('is-start')
    if (isEnd) classes.push('is-end')
    return classes.join(' ')
  }

  /** 渲染单个月（带 ‹ › 翻页；left/right 面板各自控制自己的月）。 */
  const renderMonth = (view: MonthView, move: (delta: number) => void): React.JSX.Element => (
    <div className="wf-cal-month">
      <div className="wf-cal-month__head">
        <button type="button" className="wf-cal-nav" title={prevLabel ?? '上一月'} onClick={() => move(-1)}>‹</button>
        <span className="wf-cal-month__title">{`${view.year}年${view.month}月`}</span>
        <button type="button" className="wf-cal-nav" title={nextLabel ?? '下一月'} onClick={() => move(1)}>›</button>
      </div>
      <div className="wf-cal-grid">
        {weekHeader.map((label) => <span key={label} className="wf-cal-week">{label}</span>)}
      </div>
      <div className="wf-cal-grid">
        {view.cells.map((cell) => {
          const key = dayKey(cell.year, cell.month, cell.day)
          const isStart = cell.inMonth && startKey === key
          const isEnd = cell.inMonth && (endKey === key || (startKey === key && endKey === null))
          return (
            <button
              key={cell.key}
              type="button"
              className={cellClass(key, cell.inMonth)}
              disabled={!cell.inMonth}
              onClick={() => pick(cell.year, cell.month, cell.day)}
              tabIndex={cell.inMonth ? 0 : -1}
            >
              <span className="wf-cal-cell__num">{cell.day}</span>
              {isStart ? <span className="wf-cal-cell__tag">开始</span> : null}
              {isEnd ? <span className="wf-cal-cell__tag">结束</span> : null}
            </button>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="wf-cal">
      {renderMonth(leftView, moveLeft)}
      {renderMonth(rightView, moveRight)}
    </div>
  )
}
