// tests/host/tools/wf-run-node-wait/tool.test.ts
//
// wf_run_node_wait（tool.ts）单测：注册面（参数/输出 schema/description W-03）与
// 模式二阻塞等待语义（subagent/end 完成后返回 ok + 最终输出）。

import { afterEach, describe, expect, it, vi } from 'vitest'
import { WF_RUN_NODE_WAIT } from '../../../../src/host/shared/protocol.js'
import type { WfToolsHost } from '../../../../src/host/tools/infrastructure/caller.js'
import type { JsonSchemaNode } from '../../../../src/host/tools/infrastructure/define-tool.js'
import { registerWfRunNodeWait } from '../../../../src/host/tools/wf-run-node-wait/tool.js'
import {
  cleanupTempDirs,
  execOf,
  makeEnv,
  registerTools,
  rootAgent,
  startService,
  type TestEnv,
} from '../fixtures/tool-harness.js'

afterEach(cleanupTempDirs)

interface Harness extends TestEnv {
  host: WfToolsHost
  disposeTools: () => void
}

/** 装配：真实编排运行时 + 注册 wf_run_node_wait。 */
async function makeHarness(): Promise<Harness> {
  const env = await makeEnv()
  const host: WfToolsHost = { orchestrator: env.runtime, getRootAgent: (sid) => env.agents.getRootAgent(sid) }
  const disposeTools = registerTools(env, host, [registerWfRunNodeWait])
  return { ...env, host, disposeTools }
}

describe('wf_run_node_wait 注册与 schema', () => {
  it('注册成功；disposer 注销全量生效（注册表仅含该工具）', async () => {
    const h = await makeHarness()
    expect([...h.tools.definitions.keys()]).toEqual([WF_RUN_NODE_WAIT])
    h.disposeTools()
    expect(h.tools.definitions.size).toBe(0)
    expect(h.tools.unregistered.has(WF_RUN_NODE_WAIT)).toBe(true)
  })

  it('parameters 为隐式开放对象根（无 additionalProperties），内联 required 提取为数组；无 wait 参数', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_RUN_NODE_WAIT)!
    expect(def.parameters.type).toBe('object')
    expect(def.parameters.additionalProperties).toBeUndefined()
    expect(def.parameters.required).toEqual(['nodeId'])
    const props = def.parameters.properties ?? {}
    expect(Object.keys(props).sort()).toEqual(['iterationLimit', 'nodeId', 'retryLimit', 'thinking'].sort())
    expect(props.wait).toBeUndefined()
    expect((props.nodeId as JsonSchemaNode).required).toBeUndefined()
  })

  it('output.schema：status 枚举为阻塞结果 paused/ok/fail', async () => {
    const h = await makeHarness()
    const schema = h.tools.definitions.get(WF_RUN_NODE_WAIT)!.output.schema as JsonSchemaNode
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual(['nodeId', 'status'])
    expect((schema.properties ?? {}).status).toMatchObject({ enum: ['paused', 'ok', 'fail'] })
  })

  it('nodeId 描述明确「代理节点必须被调度、不得跳过或改用源节点」（避免二义性）', async () => {
    const h = await makeHarness()
    const props = h.tools.definitions.get(WF_RUN_NODE_WAIT)!.parameters.properties ?? {}
    const nodeIdDesc = (props.nodeId as JsonSchemaNode).description as string
    expect(nodeIdDesc).toContain('never skip a proxy')
    expect(nodeIdDesc).not.toContain('proxy nodes resolve to their source node')
  })

  it('description 符合官方标准英文（W-03：英文主体、精炼）', async () => {
    const h = await makeHarness()
    const description = h.tools.definitions.get(WF_RUN_NODE_WAIT)!.description
    expect(description.length).toBeGreaterThan(20)
    const ascii = [...description].filter((ch) => /[A-Za-z ]/.test(ch)).length
    expect(ascii / description.length).toBeGreaterThan(0.9)
    expect(description.split(/\s+/).length).toBeLessThanOrEqual(130)
  })
})

describe('wf_run_node_wait 工具执行', () => {
  it('阻塞：subagent/end 完成后返回 ok + output', async () => {
    const h = await makeHarness()
    await startService(h)
    const def = h.tools.definitions.get(WF_RUN_NODE_WAIT)!
    const promise = def.execute({ nodeId: 'n-a1' }, execOf(rootAgent))
    // 等待 wfRunNode 完成启动阶段（waiter/childIndex 注册是异步的；过早派发
    // subagent/end 会因 childIndex 尚未登记而漏掉唤醒）
    await vi.waitFor(() => {
      expect(h.runtime.childMetaFor('child-1')).not.toBeNull()
    })
    // 子代理结束事件回写（与 wait 等待共用完成通道）
    await h.runtime.handleSubagentEnd({
      id: 'child-1',
      stopReason: 'completed',
      lastAssistantMessage: [{ type: 'text', text: '任务完成总结' }],
    })
    const result = await promise
    expect(result).toMatchObject({ nodeId: 'n-a1', status: 'ok' })
    expect((result as { output?: string }).output).toContain('任务完成总结')
  })
})
