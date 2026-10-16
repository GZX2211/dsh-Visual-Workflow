// tests/host/tools/infrastructure/register-tool.test.ts
//
// D03-09 工具注册帮手：统一的服务守卫（同一条错误消息、同一处置）、disposer 的
// 尽力而为语义，以及 11 个工具注册函数都经同一实现（样板收敛的等价证据）。
//
// 为什么逐个工具断言消息：收敛的意义就是「服务缺失时行为一致」——任一工具留着
// 自己那份样板，就会漂出不同的消息或漏掉 disposer。

import { describe, expect, it, vi } from 'vitest'
import { registerTool, requireToolsService } from '../../../../src/host/tools/infrastructure/register-tool.js'
import type { ToolDefinitionLike } from '../../../../src/host/tools/infrastructure/define-tool.js'
import { WF_FINISH, WF_ASK_USER } from '../../../../src/host/shared/protocol.js'
import { registerWfAskUser } from '../../../../src/host/tools/wf-ask-user/tool.js'
import { registerWfSendMessage } from '../../../../src/host/tools/wf-send-message/tool.js'
import { registerWfDbQuery } from '../../../../src/host/tools/wf-db-query/tool.js'
import { registerWfExperienceFeedback } from '../../../../src/host/tools/wf-experience-feedback/tool.js'
import { registerWfExperienceLearn } from '../../../../src/host/tools/wf-experience-learn/tool.js'
import { registerWfExperienceRecall } from '../../../../src/host/tools/wf-experience-recall/tool.js'
import { registerWfFinish } from '../../../../src/host/tools/wf-finish/tool.js'
import { registerWfGraphPatch } from '../../../../src/host/tools/wf-graph-patch/tool.js'
import { registerWfOrgCatalog } from '../../../../src/host/tools/wf-org-catalog/tool.js'
import { registerWfRunNode } from '../../../../src/host/tools/wf-run-node/tool.js'
import { registerWfRunNodeWait } from '../../../../src/host/tools/wf-run-node-wait/tool.js'

/** 最小工具定义替身：帮手只把它透传给 register，不解释内容。 */
const definition = { name: 'wf_probe' } as unknown as ToolDefinitionLike

/** 捕获同步抛出的错误（断言错误消息用；不用 toThrow 以便逐字比对）。 */
function captureError(run: () => void): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}

/** 注册函数表（名字用于断言消息；host 在服务守卫失败时不会被触碰）。 */
const tools: Array<[string, (ctx: { get(name: string): unknown }, host: never) => () => void]> = [
  ['wf_run_node', registerWfRunNode],
  ['wf_run_node_wait', registerWfRunNodeWait],
  ['wf_finish', registerWfFinish],
  ['wf_ask_user', registerWfAskUser],
  ['wf_send_message', registerWfSendMessage],
  ['wf_db_query', registerWfDbQuery],
  ['wf_org_catalog', registerWfOrgCatalog],
  ['wf_graph_patch', registerWfGraphPatch],
  ['wf_experience_learn', registerWfExperienceLearn],
  ['wf_experience_recall', registerWfExperienceRecall],
  ['wf_experience_feedback', registerWfExperienceFeedback],
]

describe('requireToolsService：统一服务守卫', () => {
  it('服务缺失时抛出统一错误（消息含工具名，便于定位是哪个工具没装上）', () => {
    const error = captureError(() => requireToolsService({ get: () => undefined }, WF_FINISH))
    expect((error as Error).message).toBe('[visual-workflow] tools 服务不可用，无法注册 wf_finish')
  })

  it('服务存在但 register 不是函数时同样抛统一错误（形状漂移不退化成 TypeError）', () => {
    const error = captureError(() => requireToolsService({ get: () => ({ register: 'nope' }) }, WF_ASK_USER))
    expect((error as Error).message).toBe('[visual-workflow] tools 服务不可用，无法注册 wf_ask_user')
  })

  it('服务可用时返回该服务（调用方据此注册）', () => {
    const registry = { register: () => () => {} }
    expect(requireToolsService({ get: () => registry }, WF_FINISH)).toBe(registry)
  })
})

describe('registerTool：注册 + 尽力而为 disposer', () => {
  it('注册用同一份定义，返回的 disposer 转发到注册表的 disposer', () => {
    const dispose = vi.fn()
    const register = vi.fn(() => dispose)
    const returned = registerTool({ register }, definition)
    expect(register).toHaveBeenCalledWith(definition)
    returned()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('底层 disposer 抛错时 disposer 不抛（工具可能已被外部注销）', () => {
    const returned = registerTool({ register: () => () => { throw new Error('already unregistered') } }, definition)
    expect(() => returned()).not.toThrow()
  })
})

describe('11 个工具注册函数共用同一守卫（样板收敛）', () => {
  it.each(tools)('%s：服务缺失时抛统一错误', (toolName, register) => {
    const error = captureError(() => register({ get: () => null }, {} as never))
    expect((error as Error).message).toBe(`[visual-workflow] tools 服务不可用，无法注册 ${toolName}`)
  })

  it.each(tools)('%s：注册成功后返回可安全调用的 disposer', (_toolName, register) => {
    const dispose = vi.fn()
    const returned = register({ get: () => ({ register: () => dispose }) }, {} as never)
    expect(() => returned()).not.toThrow()
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})

// 工具执行面在服务缺失时不应被触达：守卫先于 defineTool/host 访问。
describe('守卫先于定义构建与 host 访问', () => {
  it('服务缺失时不会读 host 能力（避免守卫降级成 TypeError）', () => {
    const host = new Proxy({}, { get: () => { throw new Error('host 被读取了') } })
    const error = captureError(() => registerWfFinish({ get: () => undefined }, host as never))
    expect((error as Error).message).toBe('[visual-workflow] tools 服务不可用，无法注册 wf_finish')
  })
})
