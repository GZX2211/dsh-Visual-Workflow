// tests/host/api/routes.test.ts
//
// GUI API 路由注册与错误映射（api/routes.ts）：注册/注销、方法校验（405）、
// 无效 JSON（400）、未知端点（404）、稳定错误码 → HTTP 状态映射。

import { afterEach, describe, expect, it } from 'vitest'
import { registerRoutes } from '../../../src/host/api/index.js'
import { cleanupAll, makeHarness } from './fixtures/api-harness.js'

afterEach(cleanupAll)

describe('路由注册与错误映射', () => {
  it('registerRoutes：注册/注销、非 POST 405、无效 JSON 400、错误映射', async () => {
    const h = await makeHarness()
    let registered: { kind?: string; path?: string; handler?: (req: unknown, res: unknown) => Promise<void> } | null = null
    const fakeWebServer = {
      register(route: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }) {
        registered = route
        return () => {
          registered = null
        }
      },
    }
    h.ctx.services.set('webServer', fakeWebServer)
    const dispose = registerRoutes({ get: (name) => h.ctx.get(name), logger: { warn: () => {} } }, h.host)
    expect(registered).toMatchObject({ kind: 'prefix', path: '/visual-workflow' })

    const responses: Array<{ status: number; body: string }> = []
    const res = {
      writeHead(status: number, headers: Record<string, string>) {
        responses.push({ status, body: '' })
        return this
      },
      end(body: string) {
        responses[responses.length - 1].body = String(body ?? '')
        return this
      },
    }
    /** 构造流式 req（data 触发一次 body、end 收尾；无 body 时仅 end）。 */
    const reqOf = (method: string, url: string, body?: string) => ({
      method,
      url,
      on(event: string, cb: (chunk?: unknown) => void) {
        if (event === 'data' && body !== undefined) cb(body)
        if (event === 'end') cb()
      },
      destroy() {},
    })

    // 非 POST → 405
    await registered!.handler!(reqOf('GET', '/visual-workflow/listWorkflows'), res)
    expect(responses[0].status).toBe(405)

    // 无效 JSON → 400
    await registered!.handler!(reqOf('POST', '/visual-workflow/toolCombos', '{bad json'), res)
    expect(responses[1].status).toBe(400)

    // 正常端点（带 body）
    await registered!.handler!(reqOf('POST', '/visual-workflow/toolCombos', '{"args":{}}'), res)
    expect(responses[2].status).toBe(200)
    expect(JSON.parse(responses[2].body)).toMatchObject({ ok: true })

    // 未知端点 → 404
    await registered!.handler!(reqOf('POST', '/visual-workflow/nope'), res)
    expect(responses[3].status).toBe(404)

    // 错误响应携带稳定 code（Bug 20）：revision 冲突 → 409 + code 字段
    const conflictFlow = { id: 'flow-code-1', sessionId: 'session-1', mode: 'mode1', name: 'c', description: '', revision: 0, nodes: [], lines: [] }
    await registered!.handler!(reqOf('POST', '/visual-workflow/putWorkflow', JSON.stringify({ args: { sessionId: 'session-1', flow: conflictFlow } })), res)
    expect(responses[4].status).toBe(200)
    await registered!.handler!(reqOf('POST', '/visual-workflow/putWorkflow', JSON.stringify({ args: { sessionId: 'session-1', flow: conflictFlow } })), res)
    expect(responses[5].status).toBe(409)
    expect(JSON.parse(responses[5].body)).toMatchObject({ ok: false, error: { message: expect.any(String), code: 'FLOW_REVISION_CONFLICT' } })

    // 领域错误码 → HTTP 状态映射（transfer 领域码：历史上因错误类型不一致退化为 500）
    await registered!.handler!(reqOf('POST', '/visual-workflow/exportWorkflow', JSON.stringify({ args: { sessionId: 'session-1', id: 'nope' } })), res)
    expect(responses[6].status).toBe(404)
    expect(JSON.parse(responses[6].body)).toMatchObject({ ok: false, error: { code: 'TRANSFER_NOT_FOUND' } })
    await registered!.handler!(reqOf('POST', '/visual-workflow/importWorkflow', JSON.stringify({ args: { json: 'not-json' } })), res)
    expect(responses[7].status).toBe(400)
    expect(JSON.parse(responses[7].body)).toMatchObject({ ok: false, error: { code: 'TRANSFER_INVALID_JSON' } })
    await registered!.handler!(reqOf('POST', '/visual-workflow/importWorkflow', JSON.stringify({ args: { json: '{"format":"x"}' } })), res)
    expect(responses[8].status).toBe(422)
    expect(JSON.parse(responses[8].body)).toMatchObject({ ok: false, error: { code: 'TRANSFER_INVALID_BUNDLE' } })

    // disposer 生效
    dispose()
    expect(registered).toBeNull()
  })

  it('registerRoutes：webServer 缺失 → 告警并返回 no-op disposer（不抛错、不注册）', async () => {
    const h = await makeHarness()
    const warns: string[] = []
    const dispose = registerRoutes({ get: (name) => h.ctx.get(name), logger: { warn: (message) => warns.push(message) } }, h.host)
    expect(typeof dispose).toBe('function')
    expect(() => dispose()).not.toThrow()
    expect(warns).toHaveLength(1)
    expect(warns[0]).toContain('webServer 服务不可用')
  })
})
