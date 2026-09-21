// tests/host/tools/wf-finish/tool.test.ts
//
// wf_finish（tool.ts）单测：注册面（参数/输出 schema/description W-03）与
// 收尾语义（completed 落终态、幂等重复、子代理拒绝、无运行拒绝）。

import { afterEach, describe, expect, it } from 'vitest'
import { WF_FINISH } from '../../../../src/host/shared/protocol.js'
import type { WfToolsHost } from '../../../../src/host/tools/infrastructure/caller.js'
import type { JsonSchemaNode } from '../../../../src/host/tools/infrastructure/define-tool.js'
import { registerWfFinish } from '../../../../src/host/tools/wf-finish/tool.js'
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

/** 装配：真实编排运行时 + 注册 wf_finish。 */
async function makeHarness(): Promise<Harness> {
  const env = await makeEnv()
  const host: WfToolsHost = { orchestrator: env.runtime, getRootAgent: (sid) => env.agents.getRootAgent(sid) }
  const disposeTools = registerTools(env, host, [registerWfFinish])
  return { ...env, host, disposeTools }
}

describe('wf_finish 注册与 schema', () => {
  it('注册成功；disposer 注销全量生效（注册表仅含该工具）', async () => {
    const h = await makeHarness()
    expect([...h.tools.definitions.keys()]).toEqual([WF_FINISH])
    h.disposeTools()
    expect(h.tools.definitions.size).toBe(0)
    expect(h.tools.unregistered.has(WF_FINISH)).toBe(true)
  })

  it('parameters：status 为 completed/failed 枚举且非必填，summary 可选', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_FINISH)!
    expect(def.parameters.required).toBeUndefined()
    expect(Object.keys(def.parameters.properties ?? {}).sort()).toEqual(['status', 'summary'].sort())
    expect((def.parameters.properties ?? {}).status).toMatchObject({ enum: ['completed', 'failed'] })
  })

  it('output.schema：ok/runId/status 必填，status 覆盖全部终态枚举', async () => {
    const h = await makeHarness()
    const schema = h.tools.definitions.get(WF_FINISH)!.output.schema as JsonSchemaNode
    expect(schema.additionalProperties).toBe(false)
    expect(schema.required).toEqual(['ok', 'runId', 'status'])
    expect((schema.properties ?? {}).status).toMatchObject({ enum: ['completed', 'failed', 'stopped', 'paused', 'interrupted'] })
  })

  it('description 符合官方标准英文（W-03：英文主体、精炼）', async () => {
    const h = await makeHarness()
    const description = h.tools.definitions.get(WF_FINISH)!.description
    expect(description.length).toBeGreaterThan(20)
    const ascii = [...description].filter((ch) => /[A-Za-z ]/.test(ch)).length
    expect(ascii / description.length).toBeGreaterThan(0.9)
    expect(description.split(/\s+/).length).toBeLessThanOrEqual(130)
  })
})

describe('wf_finish 工具执行', () => {
  it('根 Agent：收尾 completed，幂等重复返回终态', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_FINISH)!
    const first = await def.execute({ status: 'completed', summary: '全部完成' }, execOf(rootAgent))
    expect(first).toMatchObject({ ok: true, status: 'completed' })
    const second = await def.execute({ summary: '重复' }, execOf(rootAgent))
    expect(second).toMatchObject({ ok: true, status: 'completed', idempotent: true })
  })

  it('子代理调用被拒绝（WF_NOT_ROOT）', async () => {
    const h = await makeHarness()
    await start(h)
    const def = h.tools.definitions.get(WF_FINISH)!
    await expect(def.execute({}, execOf(childAgent))).rejects.toMatchObject({ code: 'WF_NOT_ROOT' })
  })

  it('无运行调用报错（WF_NO_ACTIVE_RUN）', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_FINISH)!
    await expect(def.execute({}, execOf(rootAgent))).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })
  })
})
