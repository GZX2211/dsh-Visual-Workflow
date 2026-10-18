// tests/host/shared/protocol.test.ts
//
// 共享契约：protocol.ts 跨层常量测试。
//   1. 端点清单与架构文档 §4.6 逐字双向比对（无遗漏、无多余）；
//   2. 工具名常量与可见性元数据的关键规则；
//   3. 状态枚举与类型层**双向穷尽**（类型 ⊆ 常量 ∧ 常量 ⊆ 类型）——禁止固定列表断言；
//   4. 跨层口径常量（EXECUTABLE_UNIT_KINDS）取值受 NodeKind 约束。
//
// 运行环境：node（host 测试默认）。

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CHILD_AGENT_HIDDEN_TOOLS,
  COLOR_VARS,
  DEFAULT_DISABLED_ON_FIRST_INSTALL,
  EP_LIST_EXPERIENCES,
  EP_LIST_WORKFLOWS,
  EP_RESTORE_EXPERIENCE,
  EP_RETIRE_EXPERIENCE,
  EP_SAVE_EXPERIENCE,
  ERR_EXPERIENCE_BAD_ARGS,
  ERR_EXPERIENCE_EMBEDDING_UNAVAILABLE,
  ERR_EXPERIENCE_FEEDBACK_FAILED,
  ERR_EXPERIENCE_NOT_FOUND,
  ERR_EXPERIENCE_NOT_INITIALIZED,
  ERR_EXPERIENCE_RECALL_FAILED,
  ERR_EXPERIENCE_VALIDATION,
  ERR_EXPERIENCE_WRONG_TYPE,
  EXECUTABLE_UNIT_KINDS,
  MODES,
  NODE_STATUSES,
  RUN_STATUSES,
  TEAM_SEND_MESSAGE,
  TEAM_SPAWN_TEAMMATE,
  TEAM_TOOL_NAMES,
  WF_ASK_USER,
  WF_DB_QUERY,
  WF_EXPERIENCE_FEEDBACK,
  WF_EXPERIENCE_LEARN,
  WF_EXPERIENCE_RECALL,
  WF_FINISH,
  WF_RUN_NODE,
  WF_SEND_MESSAGE,
} from '../../../src/host/shared/protocol.js'
import type { NodeKind } from '../../../src/host/shared/graph-model.js'
import type { NodeRunStatus, RunStatus } from '../../../src/host/shared/run-types.js'

// 项目根目录（tests/host/shared → 上三级）。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const sharedDir = resolve(root, 'src/host/shared')

/** 读取 shared 源文件原文（用于端点清单文本比对与纯度复核）。 */
function readShared(name: string): string {
  return readFileSync(resolve(sharedDir, name), 'utf8')
}

// ---------------------------------------------------------------------------
// protocol.ts 端点清单逐字比对（架构文档 §4.6 全部端点 + 图2 交互改造新增
// 工作流模板 3 端点 + 定时任务 3 端点 + 工具开关 3 端点 + 会话 1 端点；
// 新功能端点以 prompt/定时任务开发.md 为准，不改写 docs/ 既有文档）
//
// 已退役（B13-9 用户裁决，有实现无入口、客户端零调用）：
// createWorkflow / deleteTemplatePreview / tools / mcpList / toolSwitches /
// dbSchema / dbSearchPreview——不得重新登记。
// ---------------------------------------------------------------------------
const EXPECTED_ENDPOINTS: string[] = [
  // 工作流
  'listWorkflows', 'getWorkflow', 'putWorkflow', 'deleteWorkflow',
  // 会话（工作台全局化：「开启新会话」一次性动作——创建实例时新建主会话）
  'createSession',
  // 服务
  'listServices', 'getService', 'putService', 'deleteService', 'serviceStart', 'serviceStop', 'serviceStatus', 'serviceDebug',
  // 模板
  'listTemplates', 'putTemplate', 'deleteTemplate',
  // 工作流模板（图2 交互改造：模板库全局共享）
  'listFlowTemplates', 'putFlowTemplate', 'deleteFlowTemplate',
  // 预设/模型（工具目录端点 tools 已退役：无入口）
  'presets', 'models',
  // 工具组合 / 插件 / MCP（MCP 列表端点 mcpList 已退役：无入口）
  'toolCombos', 'toolComboPut', 'toolComboDelete', 'pluginCatalog', 'mcpPut', 'mcpDelete', 'mcpToggle',
  // 全局工具开关（父代理工具白名单「关闭」侧；全局即时生效）
  'toolSwitchPut', 'toolSwitchPutMany',
  // 运行
  'run', 'runStatus', 'activeRuns', 'runStop', 'runHistory', 'runResume',
  // 运行期配置下发（host 配置 → 前端可调参数，如 runPollMs）
  'runtimeConfig',
  // 数据库（表结构与检索预览两端点已退役：无入口）
  'dbTest',
  // 导入导出 v2
  'exportWorkflow', 'importWorkflow', 'exportAgentTemplate', 'importAgentTemplate',
  // 定时任务（新功能本阶段；需求见 prompt/定时任务开发.md）
  'schedulerTasks', 'schedulerTaskPut', 'schedulerTaskDelete',
  // 资产（模版的晋升形态：入库 / 资产态保存 / 版本 / 回滚 / 归档 / 恢复 / 影响面预览）
  'listAssets', 'getAsset', 'promoteAsset', 'saveAssetVersion', 'listAssetVersions', 'rollbackAsset', 'retireAsset',
  'restoreAsset', 'previewAssetCascade',
  // 经验（无版本控制：只有列表 / 保存 / 归档 / 恢复）
  'listExperiences', 'saveExperience', 'retireExperience', 'restoreExperience',
]

/**
 * 从 protocol.ts 源文本提取全部 `EP_* = '<endpoint>'` 常量值。
 * 不另起 import（避免在测试里手工枚举 59 个 EP_ 常量造成与实现重复/遗漏），
 * 以文本正则抽取实现中的端点名，再与期望清单做**双向**比对。
 */
function readProtocolEndpoints(): string[] {
  const src = readShared('protocol.ts')
  const re = /export const EP_[A-Z_]+ = '([^']+)'/g
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) out.push(m[1])
  return out
}

describe('shared/protocol 端点清单', () => {
  it('端点常量定义 58 个且无重复', () => {
    const eps = readProtocolEndpoints()
    expect(eps).toHaveLength(58)
    expect(new Set(eps).size).toBe(58) // 58 端点名全部唯一（无重复常量）
  })

  it('端点名逐字覆盖 §4.6 清单（正反向双向一致）', () => {
    const eps = readProtocolEndpoints()
    const expected = [...EXPECTED_ENDPOINTS].sort()
    const actual = [...eps].sort()
    expect(actual).toEqual(expected)
    expect(expected).toEqual(actual) // 双向相等 = 无遗漏、无多余
  })

  it('EP_LIST_WORKFLOWS 值为 listWorkflows', () => {
    expect(EP_LIST_WORKFLOWS).toBe('listWorkflows')
  })
})

describe('shared/protocol 工具名常量与可见性', () => {
  it('工具名常量值正确', () => {
    expect(WF_RUN_NODE).toBe('wf_run_node')
    expect(WF_FINISH).toBe('wf_finish')
    expect(WF_ASK_USER).toBe('wf_ask_user')
    expect(WF_SEND_MESSAGE).toBe('wf_send_message')
    expect(WF_DB_QUERY).toBe('wf_db_query')
  })

  it('wf_run_node / wf_finish 在子代理永久隐藏集（§4.5 规则）', () => {
    expect(CHILD_AGENT_HIDDEN_TOOLS).toContain('wf_run_node')
    expect(CHILD_AGENT_HIDDEN_TOOLS).toContain('wf_finish')
  })

  it('自主编排两工具（wf_org_catalog / wf_graph_patch）：子代理永久隐藏（§4.5 规则）', () => {
    // 架构文档 §4.5 父子可见性表：子代理行必须包含这两个工具（改图是父代理的组织权限）。
    // 历史 BUG：runner 内联三工具名单漏了它们，组合勾选后子代理会拿到必然抛 WF_NOT_ROOT
    // 的工具；现 runner 直接引用本常量（allow 剔除 + restrict deny 双保险）。
    expect(CHILD_AGENT_HIDDEN_TOOLS).toContain('wf_org_catalog')
    expect(CHILD_AGENT_HIDDEN_TOOLS).toContain('wf_graph_patch')
  })

  it('元编排自进化工具（wf_experience_learn / wf_experience_recall / wf_experience_feedback）：值逐字固定，且不被子代理永久隐藏', () => {
    // 经验学习、经验召回与经验反馈都是「当前主体的自主判断」：子代理也有自己的 agent 经验，
    // 因此三者不与自主编排工具同口径隐藏；子代理侧是否携带由组合勾选决定。
    expect(WF_EXPERIENCE_LEARN).toBe('wf_experience_learn')
    expect(WF_EXPERIENCE_RECALL).toBe('wf_experience_recall')
    expect(WF_EXPERIENCE_FEEDBACK).toBe('wf_experience_feedback')
    expect(CHILD_AGENT_HIDDEN_TOOLS).not.toContain(WF_EXPERIENCE_LEARN)
    expect(CHILD_AGENT_HIDDEN_TOOLS).not.toContain(WF_EXPERIENCE_RECALL)
    expect(CHILD_AGENT_HIDDEN_TOOLS).not.toContain(WF_EXPERIENCE_FEEDBACK)
  })

  it('经验工具不残留旧名 wf_experience（改名后无兼容别名）', () => {
    const allNames: readonly string[] = [
      ...CHILD_AGENT_HIDDEN_TOOLS,
      WF_RUN_NODE,
      WF_FINISH,
      WF_ASK_USER,
      WF_DB_QUERY,
      WF_EXPERIENCE_LEARN,
      WF_EXPERIENCE_RECALL,
      WF_EXPERIENCE_FEEDBACK,
    ]
    expect(allNames).not.toContain('wf_experience')
  })

  it('官方 Agent Team 工具集：9 个齐全且无重复', () => {
    expect(TEAM_TOOL_NAMES).toHaveLength(9)
    expect(new Set(TEAM_TOOL_NAMES).size).toBe(9)
  })

  it('官方 Team 工具不得进入子代理永久隐藏集（不可限制的自身层注册工具）', () => {
    for (const t of TEAM_TOOL_NAMES) {
      expect(CHILD_AGENT_HIDDEN_TOOLS).not.toContain(t)
    }
  })

  it('首次安装默认关闭清单 = 官方成员创建工具 + 官方消息发送工具（消息统一收口到 wf_send_message）', () => {
    expect(DEFAULT_DISABLED_ON_FIRST_INSTALL).toEqual([TEAM_SPAWN_TEAMMATE, TEAM_SEND_MESSAGE])
  })
})

// ---------------------------------------------------------------------------
// 经验领域稳定错误码（Experience V1 协议）：错误消息必须直接告诉模型下一步动作，
// 因此错误码字面量必须逐字固定，且不得与端点常量混用。
// ---------------------------------------------------------------------------
describe('shared/protocol 经验错误码', () => {
  it('经验错误码字面量逐字固定', () => {
    expect(ERR_EXPERIENCE_NOT_INITIALIZED).toBe('WF_EXPERIENCE_NOT_INITIALIZED')
    expect(ERR_EXPERIENCE_VALIDATION).toBe('WF_EXPERIENCE_VALIDATION')
    expect(ERR_EXPERIENCE_EMBEDDING_UNAVAILABLE).toBe('WF_EXPERIENCE_EMBEDDING_UNAVAILABLE')
    expect(ERR_EXPERIENCE_WRONG_TYPE).toBe('WF_EXPERIENCE_WRONG_TYPE')
    expect(ERR_EXPERIENCE_RECALL_FAILED).toBe('WF_EXPERIENCE_RECALL_FAILED')
    expect(ERR_EXPERIENCE_NOT_FOUND).toBe('WF_EXPERIENCE_NOT_FOUND')
    expect(ERR_EXPERIENCE_BAD_ARGS).toBe('WF_EXPERIENCE_BAD_ARGS')
    expect(ERR_EXPERIENCE_FEEDBACK_FAILED).toBe('WF_EXPERIENCE_FEEDBACK_FAILED')
  })

  it('经验错误码之间互不重复（不同语义不得共用同一码）', () => {
    const codes = [
      ERR_EXPERIENCE_NOT_INITIALIZED,
      ERR_EXPERIENCE_VALIDATION,
      ERR_EXPERIENCE_EMBEDDING_UNAVAILABLE,
      ERR_EXPERIENCE_WRONG_TYPE,
      ERR_EXPERIENCE_RECALL_FAILED,
      ERR_EXPERIENCE_NOT_FOUND,
      ERR_EXPERIENCE_BAD_ARGS,
      ERR_EXPERIENCE_FEEDBACK_FAILED,
    ]
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('经验端点名保持既有契约（GUI 路径稳定，不随协议重构改名）', () => {
    expect(EP_LIST_EXPERIENCES).toBe('listExperiences')
    expect(EP_SAVE_EXPERIENCE).toBe('saveExperience')
    expect(EP_RETIRE_EXPERIENCE).toBe('retireExperience')
    expect(EP_RESTORE_EXPERIENCE).toBe('restoreExperience')
  })
})

// ---------------------------------------------------------------------------
// 状态枚举双向穷尽（shared/AGENTS.md「契约一致性」）：
//   常量 ⊆ 类型：每个常量元素必须可赋给类型层联合（少项即编译失败）；
//   类型 ⊆ 常量：类型层存在常量未覆盖的取值时 Exclude 非 never → 断言失败。
// 相比固定列表断言，双向穷尽会在任一侧漂移时使 typecheck / 测试失败。
// ---------------------------------------------------------------------------
const _runStatusesInType: readonly RunStatus[] = RUN_STATUSES
const _nodeStatusesInType: readonly NodeRunStatus[] = NODE_STATUSES
type RunStatusMissing = Exclude<RunStatus, (typeof RUN_STATUSES)[number]>
type NodeStatusMissing = Exclude<NodeRunStatus, (typeof NODE_STATUSES)[number]>
const _runStatusExhaustive: [RunStatusMissing] extends [never] ? true : false = true
const _nodeStatusExhaustive: [NodeStatusMissing] extends [never] ? true : false = true

describe('shared/protocol 状态/模式/颜色/口径常量', () => {
  it('RUN_STATUSES 与 RunStatus 双向穷尽（六态持久化状态机）', () => {
    expect(RUN_STATUSES).toEqual([
      'running', 'paused', 'completed', 'failed', 'stopped', 'interrupted',
    ])
    expect(_runStatusesInType).toHaveLength(RUN_STATUSES.length)
    expect(_runStatusExhaustive).toBe(true)
  })

  it('NODE_STATUSES 与 NodeRunStatus 双向穷尽（含 Team 非终态 armed）', () => {
    expect(NODE_STATUSES).toEqual([
      'pending', 'running', 'armed', 'ok', 'fail', 'skipped', 'react-capped',
    ])
    expect(_nodeStatusesInType).toHaveLength(NODE_STATUSES.length)
    expect(_nodeStatusExhaustive).toBe(true)
  })

  it('MODES 双模式齐全', () => {
    expect(MODES).toEqual(['mode1', 'mode2'])
  })

  it('颜色变量名 6 个齐全（--wf-flow/context/database/pass/fail/content）', () => {
    expect(COLOR_VARS).toEqual([
      '--wf-flow',
      '--wf-context',
      '--wf-database',
      '--wf-pass',
      '--wf-fail',
      '--wf-content',
    ])
  })

  it('EXECUTABLE_UNIT_KINDS 取值受 NodeKind 约束且口径为 agent/parent/group', () => {
    // 编译期：常量元素必须可赋给 NodeKind（口径不得混入非节点种类）。
    const kinds: readonly NodeKind[] = EXECUTABLE_UNIT_KINDS
    expect(kinds).toEqual(['agent', 'parent', 'group'])
    expect(new Set(kinds).size).toBe(kinds.length)
  })
})
