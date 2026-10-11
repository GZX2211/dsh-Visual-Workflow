// tests/host/http-io.test.ts
//
// 宿主级横切 HTTP 基础件（src/host/http-io.ts）：GUI API 与模式二 OpenAI 兼容服务
// 两个边界共用的请求体读取与 JSON 响应写出。上限与「超限错误」由调用方注入，
// 本文件只锁定读取语义、超限短路与请求流错误的分类事实。

import { describe, expect, it } from 'vitest'
import { isRequestStreamError, readRequestBody, sendJsonResponse } from '../../src/host/http-io.js'

/** 官方 webServer 的 req 最小面：按注册顺序同步派发预置事件。 */
function requestOf(events: Array<{ event: string; chunk?: unknown }>, destroyCalls: { count: number } = { count: 0 }) {
  return {
    on(event: string, listener: (chunk?: unknown) => void) {
      for (const item of events) {
        if (item.event === event) listener(item.chunk)
      }
      return this
    },
    destroy() {
      destroyCalls.count += 1
    },
  }
}

/** JSON 响应假体：记录状态/头/body。 */
function responseSink() {
  const sent: Array<{ status: number; headers: Record<string, string>; body: string }> = []
  return {
    sent,
    writeHead(status: number, headers: Record<string, string>) {
      sent.push({ status, headers, body: '' })
    },
    end(body: string) {
      if (sent.length > 0) sent[sent.length - 1].body = String(body ?? '')
    },
  }
}

describe('readRequestBody（横切读体）', () => {
  it('多块按 UTF-8 拼接为完整文本', async () => {
    const req = requestOf([
      { event: 'data', chunk: Buffer.from('{"args":') },
      { event: 'data', chunk: Buffer.from('{}}') },
      { event: 'end' },
    ])
    await expect(readRequestBody(req, { limit: 1024, errorOf: () => new Error('too large') })).resolves.toBe('{"args":{}}')
  })

  it('超过注入上限：以注入的错误工厂拒绝、destroy 请求，且后续块不再进入缓冲', async () => {
    const errors: number[] = []
    const destroyCalls = { count: 0 }
    const req = requestOf([
      { event: 'data', chunk: Buffer.from('x'.repeat(64)) },
      { event: 'data', chunk: Buffer.from('y'.repeat(64)) },
      { event: 'end' },
    ], destroyCalls)
    await expect(readRequestBody(req, {
      limit: 32,
      errorOf: (limit) => {
        errors.push(limit)
        return new Error(`body too large: ${limit}`)
      },
    })).rejects.toThrow('body too large: 32')
    expect(errors).toEqual([32])
    expect(destroyCalls.count).toBe(1)
  })

  it('请求流 error：以可分类的 RequestStreamError 拒绝（必须与内部故障区分）', async () => {
    const req = requestOf([{ event: 'error', chunk: new Error('socket hang up') }])
    const failure = await readRequestBody(req, { limit: 1024, errorOf: () => new Error('too large') }).catch((error: unknown) => error)
    expect(isRequestStreamError(failure)).toBe(true)
    expect(failure).toBeInstanceOf(Error)
  })
})

describe('sendJsonResponse（横切写出）', () => {
  it('写入 JSON 头与序列化 body（UTF-8、no-store）', () => {
    const res = responseSink()
    sendJsonResponse(res, 200, { ok: true, value: { 名称: '甲' } })
    expect(res.sent).toHaveLength(1)
    expect(res.sent[0].status).toBe(200)
    expect(res.sent[0].headers['Content-Type']).toBe('application/json; charset=utf-8')
    expect(res.sent[0].headers['Cache-Control']).toBe('no-store')
    expect(JSON.parse(res.sent[0].body)).toEqual({ ok: true, value: { 名称: '甲' } })
  })
})
