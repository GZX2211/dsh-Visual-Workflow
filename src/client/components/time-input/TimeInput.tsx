// src/client/components/time-input/TimeInput.tsx
//
// 自定义时间输入控件（用户批注修复）：
//   - 文本输入：支持按位输入，如键入 "1125" → 11:25（4 位 = HH:mm）、"925" → 9:25、
//     "9" → 9:00；也接受 "HH:mm"/"H:mm"（失焦/回车提交，非法回退原值）；
//   - 双列滑轮选择：点击左侧「时」列、再点右侧「分」列，**两次点击后**才确认
//     （不再"点第一个选项即确认"）；弹出时两列均为未选中态，须各点一次。
// 受控组件：value = "HH:mm"，onChange(v)。

import { useCallback, useEffect, useRef, useState } from 'react'

export interface TimeInputProps {
  /** 当前值（"HH:mm"；空串表示未选择）。 */
  value: string
  onChange(value: string): void
  placeholder?: string
  ariaLabel?: string
}

/** 解析 "HH:mm" / "H:mm" / "HHmm" / "Hmm"/ "HH" / "H" → {hour, minute}（非法 null）。 */
export function parseTimeText(text: string): { hour: number; minute: number } | null {
  const raw = String(text ?? '').trim()
  if (!raw) return null
  // 带冒号
  const colon = /^(\d{1,2}):(\d{1,2})$/.exec(raw)
  if (colon) {
    const hour = Number(colon[1])
    const minute = Number(colon[2])
    if (hour <= 23 && minute <= 59) return { hour, minute }
    return null
  }
  // 纯数字：1 位=时；2 位=时（<=23）或 时:分（>23）；3-4 位=时:分（前1-2位时、后2位分）
  if (!/^\d{1,4}$/.test(raw)) return null
  const digits = raw
  if (digits.length === 1) {
    return { hour: Number(digits), minute: 0 }
  }
  if (digits.length === 2) {
    const two = Number(digits)
    if (two <= 23) return { hour: two, minute: 0 }
    return { hour: Number(digits[0]), minute: Number(digits[1]) }
  }
  // 3 位：前 1 位为时、后 2 位为分（如 "925"→9:25）；4 位：前 2 位为时
  if (digits.length === 3) {
    const hour = Number(digits[0])
    const minute = Number(digits.slice(1))
    if (hour <= 23 && minute <= 59) return { hour, minute }
    return null
  }
  const hour = Number(digits.slice(0, 2))
  const minute = Number(digits.slice(2))
  if (hour <= 23 && minute <= 59) return { hour, minute }
  return null
}

/** 按位输入时的渐进格式化（键入 1125 → 11:25；键入 112 → 11:2；键入 925 → 9:25；键入 9 → 9）。 */
export function formatTimeBuffer(digits: string): string {
  if (!digits) return ''
  if (digits.length <= 2) {
    const asHour = Number(digits)
    if (digits.length === 2 && asHour > 23) return `${digits[0]}:${digits[1]}`
    return digits
  }
  if (digits.length === 3) {
    // 前两位成时为合法小时（≤23）→ "HH:M"；否则 "H:MM"（如 925 → 9:25）
    const hour2 = Number(digits.slice(0, 2))
    return hour2 <= 23 ? `${digits.slice(0, 2)}:${digits[2]}` : `${digits[0]}:${digits.slice(1)}`
  }
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

/** 归一化显示 "HH:mm"。 */
function pad2(num: number): string {
  return String(num).padStart(2, '0')
}

/** 时/分候选列表（0..23 / 0..59，两位显示）。 */
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 60 }, (_, i) => i)

export function TimeInput({ value, onChange, placeholder, ariaLabel }: TimeInputProps) {
  const [open, setOpen] = useState(false)
  const [pendingHour, setPendingHour] = useState<number | null>(null)
  const [pendingMinute, setPendingMinute] = useState<number | null>(null)
  // 输入命中文本（失焦回写到 value）
  const [text, setText] = useState(value)
  const focusedRef = useRef(false)

  // 父级 value 变化且未聚焦时同步显示
  useEffect(() => {
    if (!focusedRef.current) setText(value)
  }, [value])

  const commit = useCallback((next: string): void => {
    onChange(next)
    setText(next)
    setOpen(false)
    setPendingHour(null)
    setPendingMinute(null)
  }, [onChange])

  const handleTextChange = useCallback((raw: string): void => {
    // 移除非法字符，渐进格式化（保留冒号便于手动输入 HH:mm）
    let digits = raw
    if (raw.includes(':')) {
      // 允许直接输入 "H:mm" / "HH:mm"
      setText(raw)
      return
    }
    digits = raw.replace(/\D/g, '').slice(0, 4)
    setText(formatTimeBuffer(digits))
  }, [])

  const commitText = useCallback((): void => {
    const parsed = parseTimeText(text)
    if (parsed) {
      onChange(`${pad2(parsed.hour)}:${pad2(parsed.minute)}`)
      setText(`${pad2(parsed.hour)}:${pad2(parsed.minute)}`)
    } else {
      // 非法：回退当前 value
      setText(value)
    }
  }, [text, value, onChange])

  const openPicker = useCallback((): void => {
    setOpen((current) => {
      const next = !current
      if (next) {
        // 打开即重置：两列均未选中，须各点一次才确认（用户批注）
        setPendingHour(null)
        setPendingMinute(null)
      }
      return next
    })
  }, [])

  const pickHour = useCallback((hour: number): void => {
    setPendingHour(hour)
  }, [])

  const pickMinute = useCallback((minute: number): void => {
    setPendingMinute(minute)
  }, [])

  // 两列均选中 → 确认（两次点击后提交）
  useEffect(() => {
    if (open && pendingHour !== null && pendingMinute !== null) {
      commit(`${pad2(pendingHour)}:${pad2(pendingMinute)}`)
    }
  }, [open, pendingHour, pendingMinute, commit])

  return (
    <span className="wf-time">
      <input
        type="text"
        className="wf-time__field"
        value={text}
        placeholder={placeholder ?? 'HH:mm'}
        aria-label={ariaLabel}
        inputMode="numeric"
        onFocus={() => { focusedRef.current = true }}
        onChange={(event) => handleTextChange(event.target.value)}
        onBlur={() => { focusedRef.current = false; commitText() }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitText()
          } else if (event.key === 'Escape') {
            setOpen(false)
            setPendingHour(null)
            setPendingMinute(null)
          }
        }}
      />
      <button type="button" className="wf-time__clock" title={ariaLabel ?? '选择时间'} onClick={openPicker}>🕑</button>
      {open
        ? (
            <span className="wf-time__picker" role="listbox" aria-label={ariaLabel ?? '选择时间'}>
              <span className="wf-time__col" role="listbox" aria-label="时">
                {HOURS.map((hour) => (
                  <button
                    key={`h:${hour}`}
                    type="button"
                    role="option"
                    aria-selected={pendingHour === hour}
                    className={`wf-time__opt${pendingHour === hour ? ' is-active' : ''}`}
                    onClick={() => pickHour(hour)}
                  >
                    {pad2(hour)}
                  </button>
                ))}
              </span>
              <span className="wf-time__col" role="listbox" aria-label="分">
                {MINUTES.map((minute) => (
                  <button
                    key={`m:${minute}`}
                    type="button"
                    role="option"
                    aria-selected={pendingMinute === minute}
                    className={`wf-time__opt${pendingMinute === minute ? ' is-active' : ''}`}
                    onClick={() => pickMinute(minute)}
                  >
                    {pad2(minute)}
                  </button>
                ))}
              </span>
            </span>
          )
        : null}
    </span>
  )
}
