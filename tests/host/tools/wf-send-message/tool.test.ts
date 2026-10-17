// tests/host/tools/wf-send-message/tool.test.ts
//
// wf_send_message 工具单测（单向持久消息；父代理 / 普通子代理 / Team 成员三向寻址）：
//   - 注册与 schema（target/message 必填、description 英文标准写法、注销）；
//   - 父代理方向：在线 steer（delivered）/ 空闲 followup 唤醒（queued）/ 未激活（投递失败）；
//   - 普通子代理方向：在线（delivered）/ 离线冷恢复（resumed）；父代理也可作为调用方；
//   - Team 成员方向：按官方成员状态映射三值（running/inactive/provisioning/failed），
//     官方 Team 不可用时降级为普通子代理路径；
//   - 目标校验：未启动成员 / 非本 run 目标 / 自投 / 参数缺失；
//   - 调用方身份：非本 run 子代理、已退役 child、无活动运行；
//   - 审计日志（成功与失败）。

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CoordinatorMessage, OrchestratorConfig, RootInjectedMessage } from '../../../../src/host/orchestrator/index.js'
import type { WorkflowDocument } from '../../../../src/host/shared/graph-model.js'
import { WF_RUN_NODE, WF_SEND_MESSAGE } from '../../../../src/host/shared/protocol.js'
import { registerWfRunNode } from '../../../../src/host/tools/wf-run-node/tool.js'
import { registerWfSendMessage, type WfSendMessageHost } from '../../../../src/host/tools/wf-send-message/tool.js'
import {
  FakeRoot,
  cleanupTempDirs,
  execOf,
  makeEnv,
  registerTools,
  role,
  stage,
  type TestEnv,
} from '../fixtures/tool-harness.js'

afterEach(async () => {
  await cleanupTempDirs()
  vi.useRealTimers()
})

/** 官方 Team 成员运行态（null = 不是成员 / Team 不可用）。 */
type TeamStatus = 'running' | 'inactive' | 'provisioning' | 'failed' | null

/**
 * 协作流程（模式一）：start → a1（普通节点）→ g-1（Team 卡片）→ end；
 * a2 是已启动的 Team 成员、a3 是未启动的 Team 成员——成员节点在画布上只有 ctx/db
 * 连接点（图校验禁止成员出现在 flow 线上），故挂在 Team 卡片的 memberIds 里。
 */
function makeFlow(): WorkflowDocument {
  const member = role('n-a2', 'agent', '成员B')
  member.data.groupId = 'g-1'
  const idle = role('n-a3', 'agent', '成员C')
  idle.data.groupId = 'g-1'
  return {
    id: 'flow-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '通信流程',
    description: '测试目标',
    revision: 1,
    nodes: [
      stage('n-start', 'start'),
      role('n-a1', 'agent', '成员A'),
      { id: 'g-1', kind: 'group', position: { x: 0, y: 0 }, data: { label: 'Team 一', collabPrompt: '', memberIds: ['n-a2', 'n-a3'] } },
      member,
      idle,
      stage('n-end', 'end'),
    ],
    lines: [
      { id: 'l1', source: 'n-start', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l2', source: 'n-a1', target: 'g-1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l3', source: 'g-1', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ],
  }
}

interface ChildFollowupCall {
  parentId: string
  childId: string
  content: unknown[]
  options: { source: unknown; signal?: AbortSignal }
}

interface TeammateSend {
  parentId: string
  target: string
  content: unknown[]
}

/** 共享装配（TestEnv）+ 本工具专用观测面（三向投递记录、审计行、Team 状态闸门）。 */
interface Harness extends TestEnv {
  rootFollowups: Array<{ agentId: string; message: RootInjectedMessage }>
  childFollowups: ChildFollowupCall[]
  teammateSends: TeammateSend[]
  infos: string[]
  disposeTools: () => void
  /** 官方 Team 可用性与成员运行态（用例内可改；默认不可用）。 */
  team: { available: boolean; statusOf: (nodeId: string) => TeamStatus }
  rootSteers: () => CoordinatorMessage[]
  childSteers: (childId: string) => CoordinatorMessage[]
}

interface HarnessOptions {
  config?: Partial<OrchestratorConfig>
}

/** 装配：共享夹具 + 注册 wf_run_node 与 wf_send_message（Team 能力用可控假体）。 */
async function makeHarness(options?: HarnessOptions): Promise<Harness> {
  const infos: string[] = []
  let uuidSeq = 0
  const env = await makeEnv({
    ...(options?.config ? { config: options.config } : {}),
    newRunId: () => 'run-1',
    uuid: () => `uuid-${(uuidSeq += 1)}`,
    logger: {
      warn: () => {},
      info: (message) => {
        infos.push(message)
      },
      debug: () => {},
    },
  })
  const team: Harness['team'] = { available: false, statusOf: () => null }
  const runner = env.runner as typeof env.runner & {
    teamAvailable: (sessionId: string) => boolean
    teamMemberStatusOf: (sessionId: string, nodeId: string) => TeamStatus
  }
  runner.teamAvailable = () => team.available
  runner.teamMemberStatusOf = (_sessionId: string, nodeId: string) => (team.available ? team.statusOf(nodeId) : null)

  const rootFollowups: Harness['rootFollowups'] = []
  const childFollowups: ChildFollowupCall[] = []
  const teammateSends: TeammateSend[] = []
  const host: WfSendMessageHost = {
    orchestrator: env.runtime,
    getRootAgent: (sessionId) => env.agents.getRootAgent(sessionId),
    getChildAgent: (childId) => env.agents.getChildAgent(childId),
    followupRoot: (agent, message) => {
      rootFollowups.push({ agentId: agent.id, message })
    },
    followupChild: async (parent, childId, content, deliveryOptions) => {
      childFollowups.push({ parentId: parent.id, childId, content, options: deliveryOptions })
      return `msg-${childId}`
    },
    sendToTeammate: async (parent, target, content) => {
      teammateSends.push({ parentId: parent.id, target, content })
      return `team-${target}`
    },
  }
  const disposeTools = registerTools(env, host, [registerWfRunNode, registerWfSendMessage])
  return {
    ...env,
    rootFollowups,
    childFollowups,
    teammateSends,
    infos,
    disposeTools,
    team,
    rootSteers: () => env.agents.roots.get('session-1')?.steers ?? [],
    childSteers: (childId) => env.agents.children.get(childId)?.steers ?? [],
  }
}

const rootAgent = { id: 'session-1', session: { header: {} } }
const child1 = { id: 'child-1', session: { header: { origin: 'subagent', parentSession: 'session-1' } } }
const stranger = { id: 'stranger', session: { header: { origin: 'subagent', parentSession: 'session-1' } } }

/** 保存流程并启动运行；启动 n-a1/n-a2 两个节点子代理并登记在线。 */
async function start(h: Harness): Promise<void> {
  await h.store.saveWorkflow(makeFlow(), 'session-1', { force: true })
  await h.runtime.startRun({ sessionId: 'session-1', flowId: 'flow-1' })
  const runDef = h.tools.definitions.get(WF_RUN_NODE)!
  await runDef.execute({ nodeId: 'n-a1' }, execOf(rootAgent))
  await runDef.execute({ nodeId: 'n-a2' }, execOf(rootAgent))
  h.agents.children.set('child-1', new FakeRoot('child-1', 'running'))
  h.agents.children.set('child-2', new FakeRoot('child-2', 'running'))
}

/** 发起一次投递（返回工具结果体）。 */
async function send(
  h: Harness,
  args: Record<string, unknown>,
  caller: unknown = child1,
): Promise<Record<string, unknown>> {
  const def = h.tools.definitions.get(WF_SEND_MESSAGE)!
  return (await def.execute(args, execOf(caller))) as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// 注册与 schema
// ---------------------------------------------------------------------------

describe('wf_send_message 注册与 schema', () => {
  it('注册成功；target 与 message 均为必填；注销后定义消失', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_SEND_MESSAGE)!
    expect(def.parameters.required).toEqual(['target', 'message'])
    expect(Object.keys(def.parameters.properties ?? {}).sort()).toEqual(['message', 'target'])
    h.disposeTools()
    expect(h.tools.definitions.has(WF_SEND_MESSAGE)).toBe(false)
  })

  it('description 为官方标准英文写法，并声明单向不等待语义', async () => {
    const h = await makeHarness()
    const def = h.tools.definitions.get(WF_SEND_MESSAGE)!
    expect(def.description.length).toBeGreaterThan(40)
    const ascii = [...def.description].filter((ch) => /[A-Za-z ]/.test(ch)).length
    expect(ascii / def.description.length).toBeGreaterThan(0.9)
    expect(def.description.split(/\s+/).length).toBeLessThanOrEqual(130)
    expect(def.description).toContain('does not wait')
    expect(def.description).not.toContain('blocks until')
  })
})

// ---------------------------------------------------------------------------
// 父代理方向（target = parent）
// ---------------------------------------------------------------------------

describe('target=parent：投递给父代理', () => {
  it('父代理运行中 → 插队投递（delivered），来源归因指向发送方子代理', async () => {
    const h = await makeHarness()
    await start(h)
    h.agents.roots.set('session-1', new FakeRoot('session-1', 'running'))

    const result = await send(h, { target: 'parent', message: '需要你的决定' })

    expect(result).toEqual({ target: 'parent', resolved: 'parent', status: 'delivered' })
    const steers = h.rootSteers()
    expect(steers).toHaveLength(1)
    expect(steers[0].source).toEqual({ kind: 'coordinator', form: 'relay', senderSessionId: 'child-1' })
    const text = String((steers[0].content[0] as { text?: unknown }).text ?? '')
    expect(text).toContain('需要你的决定')
    expect(text).toContain('成员A')
    expect(text).toContain('n-a1')
  })

  it('父代理空闲 → followupRoot 唤醒并返回 queued', async () => {
    const h = await makeHarness()
    await start(h)
    h.agents.roots.set('session-1', new FakeRoot('session-1', 'idle'))

    const result = await send(h, { target: 'parent', message: '空闲唤醒' })

    expect(result.status).toBe('queued')
    expect(h.rootSteers()).toHaveLength(0)
    expect(h.rootFollowups).toHaveLength(1)
    expect(h.rootFollowups[0].agentId).toBe('session-1')
    const text = String((h.rootFollowups[0].message.content[0] as { text?: unknown }).text ?? '')
    expect(text).toContain('空闲唤醒')
  })

  it('父代理未激活 → WF_SEND_DELIVERY_FAILED', async () => {
    const h = await makeHarness()
    await start(h)
    h.agents.roots.delete('session-1')

    await expect(send(h, { target: 'parent', message: 'hi' })).rejects.toMatchObject({ code: 'WF_SEND_DELIVERY_FAILED' })
  })

  it('父代理调用 target=parent → WF_SEND_BAD_ARGS（不可自投）', async () => {
    const h = await makeHarness()
    await start(h)

    await expect(send(h, { target: 'parent', message: 'hi' }, rootAgent)).rejects.toMatchObject({ code: 'WF_SEND_BAD_ARGS' })
  })
})

// ---------------------------------------------------------------------------
// 普通子代理方向（target = nodeId）
// ---------------------------------------------------------------------------

describe('target=nodeId：投递给普通子代理', () => {
  it('目标在线 → 插队投递（delivered），resolved 为该节点的子代理会话 id', async () => {
    const h = await makeHarness()
    await start(h)

    const result = await send(h, { target: 'n-a2', message: '请同步中间结果' })

    expect(result).toEqual({ target: 'n-a2', resolved: 'child-2', status: 'delivered' })
    const steers = h.childSteers('child-2')
    expect(steers).toHaveLength(1)
    expect(steers[0].source).toEqual({ kind: 'coordinator', form: 'relay', senderSessionId: 'child-1' })
    expect(String((steers[0].content[0] as { text?: unknown }).text ?? '')).toContain('请同步中间结果')
  })

  it('目标不在线 → 冷恢复投递并返回 resumed', async () => {
    const h = await makeHarness()
    await start(h)
    h.agents.children.delete('child-2')

    const result = await send(h, { target: 'n-a2', message: '冷恢复' })

    expect(result.status).toBe('resumed')
    expect(h.childFollowups).toHaveLength(1)
    expect(h.childFollowups[0].parentId).toBe('session-1')
    expect(h.childFollowups[0].childId).toBe('child-2')
    expect(h.childFollowups[0].options.source).toEqual({ kind: 'coordinator', form: 'relay', senderSessionId: 'child-1' })
    expect(String((h.childFollowups[0].content[0] as { text?: unknown }).text ?? '')).toContain('冷恢复')
  })

  it('父代理也可向子代理投递：来源标识为「父代理（parent）」', async () => {
    const h = await makeHarness()
    await start(h)

    const result = await send(h, { target: 'n-a2', message: '补充指令' }, rootAgent)

    expect(result.status).toBe('delivered')
    const text = String((h.childSteers('child-2')[0].content[0] as { text?: unknown }).text ?? '')
    expect(text).toContain('补充指令')
    expect(text).toContain('父代理')
    expect(text).toContain('parent')
  })

  it('目标不在线且父 root 未激活 → WF_SEND_DELIVERY_FAILED', async () => {
    const h = await makeHarness()
    await start(h)
    h.agents.children.delete('child-2')
    h.agents.roots.delete('session-1')

    await expect(send(h, { target: 'n-a2', message: 'hi' })).rejects.toMatchObject({ code: 'WF_SEND_DELIVERY_FAILED' })
  })

  it('给自己投递 → WF_SEND_BAD_ARGS', async () => {
    const h = await makeHarness()
    await start(h)

    await expect(send(h, { target: 'n-a1', message: 'hi' })).rejects.toMatchObject({ code: 'WF_SEND_BAD_ARGS' })
  })
})

// ---------------------------------------------------------------------------
// Team 成员方向（官方 member 名寻址）
// ---------------------------------------------------------------------------

describe('target=nodeId：Team 成员按官方成员名投递', () => {
  it('成员运行中 → 经官方 Team 服务投递（delivered）', async () => {
    const h = await makeHarness()
    await start(h)
    h.team.available = true
    h.team.statusOf = () => 'running'

    const result = await send(h, { target: 'n-a2', message: '组内同步' })

    expect(result.status).toBe('delivered')
    expect(h.teammateSends).toHaveLength(1)
    // 成员通道以官方成员名寻址并回填 resolved（不是子代理会话 id）
    expect(result.resolved).toBe(h.teammateSends[0].target)
    expect(result.resolved).not.toBe('child-2')
    expect(h.teammateSends[0].parentId).toBe('session-1')
    expect(h.teammateSends[0].target.length).toBeGreaterThan(0)
    expect(String((h.teammateSends[0].content[0] as { text?: unknown }).text ?? '')).toContain('组内同步')
    // 成员路径不写普通子代理投递记录
    expect(h.childSteers('child-2')).toHaveLength(0)
  })

  it('成员 inactive → resumed；provisioning → queued', async () => {
    const h = await makeHarness()
    await start(h)
    h.team.available = true

    h.team.statusOf = () => 'inactive'
    expect((await send(h, { target: 'n-a2', message: 'a' })).status).toBe('resumed')

    h.team.statusOf = () => 'provisioning'
    expect((await send(h, { target: 'n-a2', message: 'b' })).status).toBe('queued')
  })

  it('成员 failed → WF_SEND_TARGET_UNKNOWN，且不发起投递', async () => {
    const h = await makeHarness()
    await start(h)
    h.team.available = true
    h.team.statusOf = () => 'failed'

    await expect(send(h, { target: 'n-a2', message: 'hi' })).rejects.toMatchObject({ code: 'WF_SEND_TARGET_UNKNOWN' })
    expect(h.teammateSends).toHaveLength(0)
  })

  it('官方 Team 不可用 → 组内节点按普通子代理路径投递', async () => {
    const h = await makeHarness()
    await start(h)
    h.team.available = false

    const result = await send(h, { target: 'n-a2', message: '降级投递' })

    expect(result.status).toBe('delivered')
    expect(h.teammateSends).toHaveLength(0)
    expect(h.childSteers('child-2')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 目标校验与参数校验
// ---------------------------------------------------------------------------

describe('目标与参数校验', () => {
  it('本 run 未启动的成员 → WF_SEND_TARGET_UNKNOWN，错误正文不引导子代理使用调度工具', async () => {
    const h = await makeHarness()
    await start(h)

    const error = await send(h, { target: 'n-a3', message: 'hi' }).catch((err: unknown) => err as { code?: string; message?: string })

    expect(error.code).toBe('WF_SEND_TARGET_UNKNOWN')
    // 用户裁决：子代理不知道也不应被引导使用 wf_run_node
    expect(String(error.message)).not.toContain('wf_run_node')
    expect(String(error.message)).toContain('未启动')
  })

  it('不属于本 run 的目标 id → WF_SEND_TARGET_UNKNOWN', async () => {
    const h = await makeHarness()
    await start(h)

    await expect(send(h, { target: 'n-ghost', message: 'hi' })).rejects.toMatchObject({ code: 'WF_SEND_TARGET_UNKNOWN' })
  })

  it('缺 target / 空 message / 空 target → WF_SEND_BAD_ARGS', async () => {
    const h = await makeHarness()
    await start(h)

    await expect(send(h, { message: 'hi' })).rejects.toMatchObject({ code: 'WF_SEND_BAD_ARGS' })
    await expect(send(h, { target: 'parent' })).rejects.toMatchObject({ code: 'WF_SEND_BAD_ARGS' })
    await expect(send(h, { target: '   ', message: 'hi' })).rejects.toMatchObject({ code: 'WF_SEND_BAD_ARGS' })
  })

  it('长消息按上限截断后投递（不整条拒绝）', async () => {
    const h = await makeHarness()
    await start(h)
    const long = 'x'.repeat(30_000)

    const result = await send(h, { target: 'n-a2', message: long })

    expect(result.status).toBe('delivered')
    const text = String((h.childSteers('child-2')[0].content[0] as { text?: unknown }).text ?? '')
    expect(text.length).toBeLessThan(long.length)
  })
})

// ---------------------------------------------------------------------------
// 调用方身份
// ---------------------------------------------------------------------------

describe('调用方身份校验', () => {
  it('非本 run 的子代理调用 → WF_SEND_BAD_ARGS', async () => {
    const h = await makeHarness()
    await start(h)

    await expect(send(h, { target: 'n-a2', message: 'hi' }, stranger)).rejects.toMatchObject({ code: 'WF_SEND_BAD_ARGS' })
  })

  it('已被配置替换的退役子代理调用 → WF_SEND_BAD_ARGS', async () => {
    const h = await makeHarness()
    await start(h)
    // 通过公开反查接口取回运行位置引用，模拟「配置重建后被替换」这一运行时事实
    const meta = h.runtime.childMetaFor('child-1')
    expect(meta).not.toBeNull()
    meta!.retired = true

    await expect(send(h, { target: 'n-a2', message: 'hi' })).rejects.toMatchObject({ code: 'WF_SEND_BAD_ARGS' })
  })

  it('运行停止后调用 / 从未运行 → WF_NO_ACTIVE_RUN', async () => {
    const h = await makeHarness()
    await start(h)
    await h.runtime.stopRun('run-1')

    await expect(send(h, { target: 'n-a2', message: 'hi' })).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })

    const h2 = await makeHarness()
    await expect(send(h2, { target: 'n-a2', message: 'hi' })).rejects.toMatchObject({ code: 'WF_NO_ACTIVE_RUN' })
  })
})

// ---------------------------------------------------------------------------
// 审计
// ---------------------------------------------------------------------------

describe('投递审计日志', () => {
  it('成功投递写入 audit 行（含 caller/target/resolved/status）', async () => {
    const h = await makeHarness()
    await start(h)

    await send(h, { target: 'n-a2', message: 'hi' })

    const audit = h.infos.filter((line) => line.includes('wf_send_message audit'))
    expect(audit.some((line) => line.includes('target=n-a2') && line.includes('status=delivered'))).toBe(true)
    expect(audit.some((line) => line.includes('caller=') && line.includes('n-a1'))).toBe(true)
  })

  it('投递失败写入 delivery-failed 审计并报 WF_SEND_DELIVERY_FAILED', async () => {
    const h = await makeHarness()
    await start(h)
    h.agents.roots.delete('session-1')
    h.agents.children.delete('child-2')

    await expect(send(h, { target: 'n-a2', message: 'hi' })).rejects.toMatchObject({ code: 'WF_SEND_DELIVERY_FAILED' })
    const audit = h.infos.filter((line) => line.includes('wf_send_message audit'))
    expect(audit.some((line) => line.includes('delivery-failed'))).toBe(true)
  })
})
