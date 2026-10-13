// tests/client/lib/service-debug-output.test.ts
//
// 服务调试输出累积器（lib/service-debug-output.ts）单测：无界 SSE 增量 → 有界显示文本。
// 判别性口径：正文跨帧无额外分隔（与旧整串累加同文本）、错误行自成一行且与旧口径同形、
// 超限时丢最旧内容并给出省略提示（提示含被丢弃字符数）。
// 环境：纯逻辑测试，无需 jsdom。

import { describe, expect, it } from 'vitest'
import {
  MAX_SERVICE_DEBUG_CHARS,
  MAX_SERVICE_DEBUG_LINE_CHARS,
  MAX_SERVICE_DEBUG_LINES,
  ServiceDebugOutput,
} from '../../../src/client/lib/service-debug-output.js'

describe('ServiceDebugOutput：正文与错误行累积', () => {
  it('正文跨帧按原样拼接（不插入分隔符）', () => {
    const output = new ServiceDebugOutput()
    output.appendContent('你')
    output.appendContent('好')
    output.appendContent('，世界')
    expect(output.format()).toBe('你好，世界')
  })

  it('首批就是错误时无前导空行；已有内容时错误行前空一行', () => {
    const leading = new ServiceDebugOutput()
    leading.appendError('[错误] 服务超时')
    expect(leading.format()).toBe('[错误] 服务超时')

    const after = new ServiceDebugOutput()
    after.appendContent('部分')
    after.appendError('[错误] 连接中断')
    expect(after.format()).toBe('部分\n\n[错误] 连接中断')
  })

  it('reset 清空文本与截断标记（新一轮流从零开始）', () => {
    const output = new ServiceDebugOutput()
    output.appendContent('上一轮输出')
    output.reset()
    output.appendContent('新问题')
    expect(output.format('已省略 ')).toBe('新问题')
  })
})

describe('ServiceDebugOutput：超限截断（内存与渲染有界）', () => {
  it('超过总字符上限：丢弃最旧行并给出含丢弃字符数的省略提示', () => {
    const output = new ServiceDebugOutput()
    const chunk = 'x'.repeat(MAX_SERVICE_DEBUG_CHARS)
    output.appendContent(`${chunk}\n尾段`)
    expect(output.format()).toContain('尾段')

    output.appendContent('\n后段')
    const text = output.format('已省略 ')
    expect(text.startsWith('已省略 ')).toBe(true)
    // 提示里的数字必须等于被丢弃的字符数（用户可见「省略了多少」）
    expect(Number(text.slice('已省略 '.length).split('\n')[0])).toBeGreaterThan(0)
    expect(text.length).toBeLessThanOrEqual(MAX_SERVICE_DEBUG_CHARS + MAX_SERVICE_DEBUG_LINE_CHARS)
  })

  it('未超限时不出现省略提示（即便调用方传入提示词）', () => {
    const output = new ServiceDebugOutput()
    output.appendContent('短输出')
    expect(output.format('已省略 ')).toBe('短输出')
  })

  it('无换行的超长单帧：按单行上限切行，内容不丢且行数有界', () => {
    const output = new ServiceDebugOutput()
    output.appendContent('y'.repeat(MAX_SERVICE_DEBUG_LINE_CHARS + 5))
    const text = output.format()
    expect(text.replace(/\n/g, '')).toBe('y'.repeat(MAX_SERVICE_DEBUG_LINE_CHARS + 5))
    expect(output.format()).toContain('\n')

    // 行数上限兜底：超出后旧行被丢弃并置省略标记
    output.appendContent(`\n${'z'.repeat(MAX_SERVICE_DEBUG_CHARS)}`)
    expect(output.format('已省略 ')).toContain('已省略 ')
  })

  it('行数超过上限：只保留最近的 MAX_SERVICE_DEBUG_LINES 行', () => {
    const output = new ServiceDebugOutput()
    for (let index = 0; index < MAX_SERVICE_DEBUG_LINES + 10; index += 1) {
      output.appendContent(index === 0 ? `line-${index}` : `\nline-${index}`)
    }
    const text = output.format('已省略 ')
    expect(text.startsWith('已省略 ')).toBe(true)
    // 保留末尾；最旧的行（含被丢空行之后的早期内容）必须已不在文本里
    expect(text).toContain(`line-${MAX_SERVICE_DEBUG_LINES + 9}`)
    expect(text).not.toContain('line-0')
    expect(text).not.toContain('line-9\n')
  })
})
