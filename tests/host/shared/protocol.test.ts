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
  ERR_EXPERIENCE_NOT_FOUND,
  ERR_EXPERIENCE_NOT_INITIALIZED,
  ERR_EXPERIENCE_RECALL_FAILED,
  ERR_EXPERIENCE_VALIDATION,
  ERR_EXPERIENCE_WRONG_TYPE,
  EXECUTABLE_UNIT_KINDS,
  MODES,
  NODE_STATUSES,
  OPTIONAL_INJECT_TOOLS,
  PARENT_AGENT_VISIBLE_TOOLS,
  RUN_STATUSES,
  TEAM_CHILD_AVAILABLE_TOOLS,
  TEAM_LEAD_ONLY_TOOLS,
  TEAM_SPAWN_TEAMMATE,
  TEAM_TOOL_NAMES,
  TOOL_VISIBILITY,
  WF_ASK,
  WF_ASK_AGENT,
  WF_DB_QUERY,
  WF_EXPERIENCE_LEARN,
  WF_EXPERIENCE_RECALL,
  WF_FINISH,
  WF_RUN_NODE,
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
// ---------------------------------------------------------------------------
const EXPECTED_ENDPOINTS: string[] = [
  // 工作流
  'listWorkflows', 'getWorkflow', 'putWorkflow', 'deleteWorkflow', 'createWorkflow',
  // 会话（工作台全局化：「开启新会话」一次性动作——创建实例时新建主会话）
  'createSession',
  // 服务
  'listServices', 'getService', 'putService', 'deleteService', 'serviceStart', 'serviceStop', 'serviceStatus', 'serviceDebug',
  // 模板
  'listTemplates', 'putTemplate', 'deleteTemplate', 'deleteTemplatePreview', 'fileUpload',
  // 工作流模板（图2 交互改造：模板库全局共享）
  'listFlowTemplates', 'putFlowTemplate', 'deleteFlowTemplate',
  // 预设/工具/模型
  'presets', 'tools', 'models',
  // 工具组合 / 插件 / MCP
  'toolCombos', 'toolComboPut', 'toolComboDelete', 'pluginCatalog', 'mcpList', 'mcpPut', 'mcpDelete', 'mcpToggle',
  // 全局工具开关（父代理工具白名单「关闭」侧；全局即时生效）
  'toolSwitches', 'toolSwitchPut', 'toolSwitchPutMany',
  // 运行
  'run', 'runStatus', 'activeRuns', 'runStop', 'runHistory', 'runResume',
  // 数据库
  'dbTest', 'dbSchema', 'dbSearchPreview',
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
 * 不另起 import（避免在测试里手工枚举 52 个 EP_ 常量造成与实现重复/遗漏），
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
  it('端点常量定义 65 个且无重复', () => {
    const eps = readProtocolEndpoints()
    expect(eps).toHaveLength(65)
    expect(new Set(eps).size).toBe(65) // 65 端点名全部唯一（无重复常量）
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
  it('五个工具名常量值正确', () => {
    expect(WF_RUN_NODE).toBe('wf_run_node')
    expect(WF_FINISH).toBe('wf_finish')
    expect(WF_ASK).toBe('wf_ask')
    expect(WF_ASK_AGENT).toBe('wf_ask_agent')
    expect(WF_DB_QUERY).toBe('wf_db_query')
  })

  it('wf_run_node / wf_finish 在子代理永久隐藏集（§4.5 规则）', () => {
    expect(CHILD_AGENT_HIDDEN_TOOLS).toContain('wf_run_node')
    expect(CHILD_AGENT_HIDDEN_TOOLS).toContain('wf_finish')
    expect(TOOL_VISIBILITY.childHidden).toContain('wf_run_node')
    expect(TOOL_VISIBILITY.childHidden).toContain('wf_finish')
  })

  it('自主编排两工具（wf_org_catalog / wf_graph_patch）：子代理永久隐藏 + 默认开启（§4.5 规则）', () => {
    // 架构文档 §4.5 父子可见性表：子代理行必须包含这两个工具（改图是父代理的组织权限）。
    // 历史 BUG：runner 内联三工具名单漏了它们，组合勾选后子代理会拿到必然抛 WF_NOT_ROOT
    // 的工具；现 runner 直接引用本常量（allow 剔除 + restrict deny 双保险）。
    expect(CHILD_AGENT_HIDDEN_TOOLS).toContain('wf_org_catalog')
    expect(CHILD_AGENT_HIDDEN_TOOLS).toContain('wf_graph_patch')
    expect(TOOL_VISIBILITY.orgAuthoring).toEqual(['wf_org_catalog', 'wf_graph_patch'])
    // 父代理专属工具不得出现在可选注入集（勾选即进子代理）里
    expect(OPTIONAL_INJECT_TOOLS).not.toContain('wf_org_catalog')
    expect(OPTIONAL_INJECT_TOOLS).not.toContain('wf_graph_patch')
  })

  it('wf_ask / wf_ask_agent 在可选注入集（§4.5 规则）', () => {
    expect(OPTIONAL_INJECT_TOOLS).toContain('wf_ask')
    expect(OPTIONAL_INJECT_TOOLS).toContain('wf_ask_agent')
    expect(TOOL_VISIBILITY.optionalInject).toContain('wf_ask')
    expect(TOOL_VISIBILITY.optionalInject).toContain('wf_ask_agent')
  })

  it('wf_db_query 在可选注入集（有 db-in 连线时注入）', () => {
    expect(OPTIONAL_INJECT_TOOLS).toContain('wf_db_query')
  })

  it('父代理可见集含 wf_run_node / wf_finish / wf_ask_agent', () => {
    expect(PARENT_AGENT_VISIBLE_TOOLS).toContain('wf_run_node')
    expect(PARENT_AGENT_VISIBLE_TOOLS).toContain('wf_finish')
    expect(PARENT_AGENT_VISIBLE_TOOLS).toContain('wf_ask_agent')
  })

  it('子代理永久隐藏集不含任何可选注入工具（互斥）', () => {
    for (const t of CHILD_AGENT_HIDDEN_TOOLS) {
      expect(OPTIONAL_INJECT_TOOLS).not.toContain(t)
    }
  })

  it('元编排自进化工具（wf_experience_learn / wf_experience_recall）：所有代理可用，进可选注入集', () => {
    // 经验学习与经验召回都是「当前主体的自主判断」：子代理也有自己的 agent 经验，
    // 因此两者不再与自主编排工具同口径隐藏，而是进可选注入集（子代理经组合勾选才注入）。
    expect(WF_EXPERIENCE_LEARN).toBe('wf_experience_learn')
    expect(WF_EXPERIENCE_RECALL).toBe('wf_experience_recall')
    expect(TOOL_VISIBILITY.metaEvolution).toEqual([WF_EXPERIENCE_LEARN, WF_EXPERIENCE_RECALL])
    expect(OPTIONAL_INJECT_TOOLS).toContain(WF_EXPERIENCE_LEARN)
    expect(OPTIONAL_INJECT_TOOLS).toContain(WF_EXPERIENCE_RECALL)
    expect(CHILD_AGENT_HIDDEN_TOOLS).not.toContain(WF_EXPERIENCE_LEARN)
    expect(CHILD_AGENT_HIDDEN_TOOLS).not.toContain(WF_EXPERIENCE_RECALL)
  })

  it('经验工具不残留旧名 wf_experience（改名后无兼容别名）', () => {
    const allNames: readonly string[] = [
      ...CHILD_AGENT_HIDDEN_TOOLS,
      ...OPTIONAL_INJECT_TOOLS,
      ...PARENT_AGENT_VISIBLE_TOOLS,
      ...TOOL_VISIBILITY.metaEvolution,
      ...TOOL_VISIBILITY.orgAuthoring,
    ]
    expect(allNames).not.toContain('wf_experience')
  })

  it('官方 Agent Team 工具集：9 个齐全、Lead 专属与子代理可用子集互补且不重叠', () => {
    expect(TEAM_TOOL_NAMES).toHaveLength(9)
    expect(new Set(TEAM_TOOL_NAMES).size).toBe(9)
    // 子代理可用子集 = 全量 − Lead 专属（互补，无遗漏无多余）
    expect([...TEAM_LEAD_ONLY_TOOLS, ...TEAM_CHILD_AVAILABLE_TOOLS].sort()).toEqual([...TEAM_TOOL_NAMES].sort())
    for (const t of TEAM_LEAD_ONLY_TOOLS) expect(TEAM_CHILD_AVAILABLE_TOOLS).not.toContain(t)
    // 元数据表引用同一本体
    expect(TOOL_VISIBILITY.officialTeam).toEqual(TEAM_TOOL_NAMES)
    expect(TOOL_VISIBILITY.officialTeamChildAvailable).toEqual(TEAM_CHILD_AVAILABLE_TOOLS)
    expect(TOOL_VISIBILITY.officialTeamLeadOnly).toEqual(TEAM_LEAD_ONLY_TOOLS)
  })

  it('官方 Team 工具不得进入任何插件侧 restrict 名单（不可限制的自身层注册工具）', () => {
    for (const t of TEAM_TOOL_NAMES) {
      expect(CHILD_AGENT_HIDDEN_TOOLS).not.toContain(t)
      expect(OPTIONAL_INJECT_TOOLS).not.toContain(t)
      expect(PARENT_AGENT_VISIBLE_TOOLS).not.toContain(t)
    }
  })

  it('首次安装默认关闭清单只含官方成员创建工具（默认关闭的唯一目的：阻止模型自行拉人）', () => {
    expect(DEFAULT_DISABLED_ON_FIRST_INSTALL).toEqual([TEAM_SPAWN_TEAMMATE])
    expect(TEAM_LEAD_ONLY_TOOLS).toContain(TEAM_SPAWN_TEAMMATE)
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

  it('NODE_STATUSES 与 NodeRunStatus 双向穷尽（含协作组非终态 armed）', () => {
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
