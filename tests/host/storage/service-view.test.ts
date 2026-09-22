// tests/host/storage/service-view.test.ts
//
// 服务文档 → 模式二工作流视图纯投影测试（T-012 拆分）。
// 断言依据：src/host/storage/AGENTS.md「纯函数与副作用分离」+ P0-3 元参数数据链路。

import { describe, expect, it } from 'vitest'
import { serviceToWorkflowView } from '../../../src/host/storage/service-view.js'
import type { GraphNode } from '../../../src/host/shared/graph-model.js'
import type { ServiceState } from '../../../src/host/shared/types.js'

/** 最小服务文档（含运行字段，用于断言「运行字段不透传」）。 */
function makeService(overrides: Partial<ServiceState> = {}): ServiceState {
  const nodes: GraphNode[] = [{ id: 'n1', kind: 'start', position: { x: 0, y: 0 }, data: { label: '输入' } }]
  return {
    id: 'svc-1',
    sessionId: 's1',
    name: '服务',
    description: '说明',
    revision: 3,
    nodes,
    lines: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    status: 'running',
    port: 7861,
    apiKeyHash: 'hash',
    ...overrides,
  }
}

describe('serviceToWorkflowView 投影', () => {
  it('图结构/名称/描述/版本/时间戳按值转发，mode 固定为 mode2', () => {
    const service = makeService()
    const view = serviceToWorkflowView(service)
    expect(view.id).toBe('svc-1')
    expect(view.sessionId).toBe('s1')
    expect(view.mode).toBe('mode2')
    expect(view.name).toBe('服务')
    expect(view.description).toBe('说明')
    expect(view.revision).toBe(3)
    expect(view.nodes).toEqual(service.nodes)
    expect(view.lines).toEqual(service.lines)
    expect(view.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(view.updatedAt).toBe('2026-01-02T00:00:00.000Z')
  })

  it('运行字段不透传（status/port/apiKeyHash 属服务文档，不属工作流视图）', () => {
    const view = serviceToWorkflowView(makeService()) as unknown as Record<string, unknown>
    expect(view.status).toBeUndefined()
    expect(view.port).toBeUndefined()
    expect(view.apiKeyHash).toBeUndefined()
    expect(view.lastStartedAt).toBeUndefined()
    expect(view.lastStoppedAt).toBeUndefined()
  })

  it('元参数存在时转发（P0-3：漏转发会让实例 meta 在运行期被静默丢弃）', () => {
    expect(serviceToWorkflowView(makeService({ meta: { nodeMax: 6 } })).meta).toEqual({ nodeMax: 6 })
  })

  it('元参数缺省时不写该字段（保持既有工作流视图形状，旧数据兼容）', () => {
    expect('meta' in serviceToWorkflowView(makeService())).toBe(false)
  })

  it('已退役字段按旧数据兼容透传（仅读取语义，运行期不再消费）', () => {
    const view = serviceToWorkflowView(makeService({ startNewSession: true, workspacePath: '/tmp/ws' }))
    expect(view.startNewSession).toBe(true)
    expect(view.workspacePath).toBe('/tmp/ws')
  })

  it('纯投影：不修改入参服务文档', () => {
    const service = makeService()
    const snapshot = JSON.parse(JSON.stringify(service)) as ServiceState
    serviceToWorkflowView(service)
    expect(service).toEqual(snapshot)
  })
})
