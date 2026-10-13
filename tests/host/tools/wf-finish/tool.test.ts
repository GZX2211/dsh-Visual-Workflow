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
  type TestEnvOptions,
} from '../fixtures/tool-harness.js'

afterEach(cleanupTempDirs)

interface Harness extends TestEnv {
  host: WfToolsHost
  disposeTools: () => void
}

/** 装配：真实编排运行时 + 注册 wf_finish。 */
async function makeHarness(options?: TestEnvOptions): Promise<Harness> {
  const env = await makeEnv(options)
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

  it('磁盘最新一条为 running（崩溃残留）：不伪造终态、按 WF_NO_ACTIVE_RUN 拒绝', async () => {
    const h = await makeHarness({ newRunId: (() => { let n = 0; return () => `run-${(n += 1)}` })() })
    await start(h)
    const runId = h.runtime.activeRunForSession('session-1')!.snapshot.id
    // 模拟宿主重启/崩溃：磁盘留有 running 记录，内存条目已丢失；running 不在可恢复状态内
    h.runtime.runs.delete(runId)
    expect(h.runtime.activeRunForSession('session-1')).toBeNull()

    const def = h.tools.definitions.get(WF_FINISH)!
    await expect(def.execute({}, execOf(rootAgent))).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })

    // 崩溃残留记录不得被本次调用改写：收尾只作用于本次确认/接管的运行，不猜「就是它」
    expect((await h.store.getRun(runId))?.status).toBe('running')
  })

  it('对照：磁盘 stopped 断点被静默接续接管后可直接收尾（与 running 残留的分界）', async () => {
    const h = await makeHarness({ newRunId: (() => { let n = 0; return () => `run-${(n += 1)}` })() })
    await start(h)
    const stoppedId = h.runtime.activeRunForSession('session-1')!.snapshot.id
    await h.runtime.stopRun(stoppedId)
    expect(h.runtime.activeRunForSession('session-1')).toBeNull()

    const def = h.tools.definitions.get(WF_FINISH)!
    const finished = await def.execute({ status: 'completed', summary: '确认流程已走完' }, execOf(rootAgent))

    // 断点被静默接管后按「本次收尾」处理（不是幂等回放历史终态）
    expect(finished).toMatchObject({ ok: true, status: 'completed' })
    expect((finished as { idempotent?: boolean }).idempotent).toBeUndefined()
    expect((finished as { runId?: string }).runId).not.toBe(stoppedId)
  })
})
