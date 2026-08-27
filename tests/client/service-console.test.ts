// @vitest-environment jsdom

// tests/client/service-console.test.ts
//
// Bug 3 回归：调试台 SSE 增量解析必须走后端 sseChunk 的正文路径
// choices[0].delta.content（旧实现解析 parsed.delta?.content 取不到）。

import { describe, expect, it } from 'vitest'
import { parseSseDelta } from '../../src/client/components/service-console/ServiceConsole.js'

describe('parseSseDelta（Bug 3 回归）', () => {
  it('解析后端 sseChunk 形态：choices[0].delta.content', () => {
    // 与 host openai-api sseChunk 的 JSON 结构逐字段对齐
    const line = JSON.stringify({
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { content: '你好' }, finish_reason: null }],
    })
    expect(parseSseDelta(line)).toEqual({ content: '你好' })
  })

  it('兼容旧增量格式 delta.content（回退取值）', () => {
    expect(parseSseDelta(JSON.stringify({ delta: { content: '旧格式' } }))).toEqual({ content: '旧格式' })
  })

  it('错误行返回 error 消息', () => {
    expect(parseSseDelta(JSON.stringify({ error: { message: 'boom', type: 'server_error' } }))).toEqual({ error: 'boom' })
  })

  it('非 JSON/空增量返回空对象', () => {
    expect(parseSseDelta('not json')).toEqual({})
    expect(parseSseDelta(JSON.stringify({ choices: [{ delta: {} }] }))).toEqual({})
  })
})
