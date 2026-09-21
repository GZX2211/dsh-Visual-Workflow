// tests/host/tools/wf-run-node/tool.test.ts
//
// wf_run_node（tool.ts）单测：注册面（参数/输出 schema/description W-03）与执行语义
// （根 Agent 异步启动、子代理拒绝、无运行拒绝、暂停门、运行已取消）。

import { afterEach, describe, expect, it } from 'vitest'
import { WF_RUN_NODE } from '../../../../src/host/shared/protocol.js'
import type { WfToolsHost } from '../../../../src/host/tools/infrastructure/caller.js'
import type { JsonSchemaNode } from '../../../../src/host/tools/infrastructure/define-tool.js'
import { registerWfRunNode } from '../../../../src/host/tools/wf-run-node/tool.js'
import {
  childAgent,
  cleanupTempDirs,
  execOf,
  makeEnv,
  registerTools,
  rootAgent,
  start,
  type TestEnv,
} from '../fixtures/tool-harness.js'

afterEach(cleanupTempDirs)

interface Harness extends TestEnv {
  host: WfToolsHost
  disposeTools: () => void
}

/** 装配：真实编排运行时 + 注册 wf_run_node。 */
async function makeHarness(): Promise<Harness> {
  const env = await makeEnv()
  const host: WfToolsHost = { orchestrator: env.runtime, getRootAgent: (sid) => env.agents.getRootAgent(sid) }
  const disposeTools = registerTools(env, host, [registerWfRunNode])
  return { ...env, host, disposeTools }
}

describe('wf_run_node 注册与 schema', () => {
  it('注册成功；disposer 注销全量生效（注册表仅含该工具）', async () => {
    const h = await makeHarness()
    expect([...h.tools.definitions.keys()]).toEqual([WF_RUN_NODE])
    h.disposeTools()
    expect(h.tools.definitions.size).toBe(0)
    expect(h.tools.unregistered.has(WF_RUN_NODE)).toBe(true)
  })

  it('parameters 为隐式开放对象根（无 additionalProperties），内联 required 提取为数组；无 wait 参数', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_RUN_NODE)!
    expect(def.parameters.type).toBe('object')
    expect(def.parameters.additionalProperties).toBeUndefined()
    expect(def.parameters.required).toEqual(['nodeId'])
    const props = def.parameters.properties ?? {}
    expect(Object.keys(props).sort()).toEqual(['iterationLimit', 'nodeId', 'retryLimit', 'thinking'].sort())
    expect(props.wait).toBeUndefined()
    expect((props.nodeId as JsonSchemaNode).required).toBeUndefined()
  })

  it('output.schema：对象 additionalProperties=false、内联 required 提取、status 枚举 started/paused', async () => {
    const h = await makeHarness()
    const schema = h.tools.definitions.get(WF_RUN_NODE)!.output.schema as JsonSchemaNode
    expect(schema.type).toBe('object')
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual(['nodeId', 'status'])
    expect((schema.properties ?? {}).status).toMatchObject({ enum: ['started', 'paused'] })
  })

  it('nodeId 描述明确「代理节点必须被调度、不得跳过或改用源节点」（避免二义性）', async () => {
    const h = await makeHarness()
    const props = h.tools.definitions.get(WF_RUN_NODE)!.parameters.properties ?? {}
    const nodeIdDesc = (props.nodeId as JsonSchemaNode).description as string
    expect(nodeIdDesc).toContain('never skip a proxy')
    expect(nodeIdDesc).not.toContain('proxy nodes resolve to their source node')
  })

  it('description 符合官方标准英文（W-03：英文主体、精炼）', async () => {
    const h = await makeHarness()
    const description = h.tools.definitions.get(WF_RUN_NODE)!.description
    expect(description.length).toBeGreaterThan(20)
    const ascii = [...description].filter((ch) => /[A-Za-z ]/.test(ch)).length
    expect(ascii / description.length).toBeGreaterThan(0.9)
    expect(description.split(/\s+/).length).toBeLessThanOrEqual(130)
  })
})

describe('wf_run_node 工具执行', () => {
  it('根 Agent：异步启动返回 started，caller/参数/signal 正确透传', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_RUN_NODE)!
    const signal = new AbortController().signal
    const result = await def.execute({ nodeId: 'n-a1', thinking: 'high', iterationLimit: 7, retryLimit: 2 }, execOf(rootAgent, signal))
    expect(result).toMatchObject({ nodeId: 'n-a1', status: 'started' })
    expect((result as { childId?: string }).childId).toBeTruthy()
    // 节点状态回写 running
    const snapshot = h.runtime.runSnapshot('run-1000000')!
    expect(snapshot.nodes.find((n) => n.nodeId === 'n-a1')?.status).toBe('running')
  })

  it('子代理调用被拒绝（WF_NOT_ROOT）', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_RUN_NODE)!
    await expect(def.execute({ nodeId: 'n-a1' }, execOf(childAgent))).rejects.toMatchObject({ code: 'WF_NOT_ROOT' })
  })

  it('未运行的工作流被拒绝（WF_NO_ACTIVE_RUN）', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_RUN_NODE)!
    await expect(def.execute({ nodeId: 'n-a1' }, execOf(rootAgent))).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })
  })

  it('暂停节点触发暂停门：返回 paused、run 置 paused、断点持久化', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_RUN_NODE)!
    const result = await def.execute({ nodeId: 'n-pause' }, execOf(rootAgent))
    expect(result).toEqual({ nodeId: 'n-pause', status: 'paused' })
    const snapshot = h.runtime.runSnapshot('run-1000000')!
    expect(snapshot.status).toBe('paused')
    expect(snapshot.resumeFromNodeId).toBe('n-pause')
    // 锁保留：paused 运行仍占用运行锁（flowLockInfo 可查）
    expect(h.runtime.flowLockInfo('flow-1')).toMatchObject({ status: 'paused' })
  })

  it('运行已停止（controller aborted）时调用被拒绝（WF_CANCELLED）', async () => {
    const h = await makeHarness()
    await start(h)
    const entry = h.runtime.activeRunForSession('session-1')!
    entry.controller.abort('test')
    const def = h.tools.definitions.get(WF_RUN_NODE)!
    await expect(def.execute({ nodeId: 'n-a1' }, execOf(rootAgent))).rejects.toMatchObject({ code: 'WF_CANCELLED' })
  })
})
