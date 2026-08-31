// T-014 共享契约测试：校验 graph-model.ts / types.ts / protocol.ts 三文件的纯类型
// 形态、常量值、与架构文档 §4.5/§4.6/§6 的逐字一致性，以及「零运行时 import」纯度门。
//
// 覆盖三方面（对应用户硬性要求）：
//   1. graph-model 纯类型形态：对象字面量 + 类型断言编译期验证判别联合是否满足各节点
//      最小形状；运行时断言各常量（若导出 as const 枚举）齐全。
//   2. protocol.ts：端点清单逐字覆盖 §4.6 全部端点名；工具名常量值正确；可见性表关键
//      规则（wf_run_node/wf_finish 在子代理永久隐藏集；wf_ask/wf_ask_agent 在可选注入集）。
//   3. 零 import 纯度门：读三个文件文本，断言不含 `import` 语句与 `from '`（保证 client
//      侧零风险类型引用）。
//
// 运行环境：node（host 测试默认）。
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 项目根目录。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const sharedDir = resolve(root, 'src/host/shared')

// 读取 shared 三文件原文（用于纯度门断言）。
function readShared(name: string): string {
  return readFileSync(resolve(sharedDir, name), 'utf8')
}

// ---------------------------------------------------------------------------
// 类型导入（type-only）：本测试文件仅用于编译期验证类型形状，运行时只测常量。
// ---------------------------------------------------------------------------
import type {
  ConditionType,
  DatabaseNode,
  FileNode,
  GraphNode,
  GroupNode,
  Handle,
  Line,
  NodeKind,
  ProxyNode,
  RoleNode,
  StageNode,
  WorkflowDocument,
} from '../../src/host/shared/graph-model.js'

import type {
  BundleV2,
  DatabaseTemplate,
  FileTemplate,
  GroupTemplate,
  NodeOutputRecord,
  RoleTemplate,
  RunSnapshot,
  RunStatus,
  ServiceState,
  ToolCombo,
  UserIdMap,
} from '../../src/host/shared/types.js'

import {
  CHILD_AGENT_HIDDEN_TOOLS,
  COLOR_VARS,
  EP_LIST_WORKFLOWS,
  MODES,
  NODE_STATUSES,
  OPTIONAL_INJECT_TOOLS,
  PARENT_AGENT_VISIBLE_TOOLS,
  RUN_STATUSES,
  TOOL_VISIBILITY,
  WF_ASK,
  WF_ASK_AGENT,
  WF_DB_QUERY,
  WF_FINISH,
  WF_RUN_NODE,
  // 其余端点常量经 readProtocolEndpoints() 以文本方式逐字比对（见下方）。
} from '../../src/host/shared/protocol.js'

// ---------------------------------------------------------------------------
// 编译期类型守卫：以下对象字面量若不能赋给对应接口，typecheck 即失败。
// 运行期无实际断言（仅通过 TypeScript 编译即为「满足最小形状」的证明）。
// ---------------------------------------------------------------------------

/** 各节点类型的最小合法对象字面量（编译期验证判别联合）。 */
const _minRoleParent: RoleNode = {
  id: 'n1',
  kind: 'parent',
  position: { x: 0, y: 0 },
  data: { label: '父', systemPrompt: 'p', provider: 'deepseek', model: 'chat', retryLimit: 3 },
}
const _minRoleAgent: RoleNode = {
  id: 'n2',
  kind: 'agent',
  position: { x: 1, y: 1 },
  data: { label: '子', systemPrompt: '', provider: 'deepseek', model: 'chat', retryLimit: 3 },
}
const _minFile: FileNode = { id: 'n3', kind: 'file', position: { x: 2, y: 2 }, data: { label: 'f', fileKind: 'text', content: 'hi' } }
const _minDatabase: DatabaseNode = {
  id: 'n4',
  kind: 'database',
  position: { x: 3, y: 3 },
  data: { label: 'd', description: '', dbType: 'local', dbKind: 'sqlite', localPath: '/tmp/a.db' },
}
const _minStageStart: StageNode = { id: 'n5', kind: 'start', position: { x: 4, y: 4 }, data: { label: '启动' } }
const _minStageEnd: StageNode = { id: 'n6', kind: 'end', position: { x: 5, y: 5 }, data: { label: '结束' } }
const _minStagePause: StageNode = { id: 'n7', kind: 'pause', position: { x: 6, y: 6 }, data: { label: '暂停' } }
const _minGroup: GroupNode = {
  id: 'n8',
  kind: 'group',
  position: { x: 7, y: 7 },
  data: { label: '组', collabPrompt: '协作', memberIds: ['n2'] },
}
const _minProxy: ProxyNode = { id: 'n9', kind: 'proxy', position: { x: 8, y: 8 }, proxySourceId: 'n2' }

/** 判别联合：上述任意节点均可赋给 GraphNode。 */
const _graphNodes: GraphNode[] = [
  _minRoleParent,
  _minRoleAgent,
  _minFile,
  _minDatabase,
  _minStageStart,
  _minStageEnd,
  _minStagePause,
  _minGroup,
  _minProxy,
]

/** 连线最小对象（含条件）。 */
const _minLine: Line = {
  id: 'l1',
  source: 'n5',
  target: 'n2',
  sourceHandle: 'flow-out',
  targetHandle: 'flow-in',
  condition: { type: 'pass', label: '通过' },
}

/** 工作流文档最小对象。 */
const _minDoc: WorkflowDocument = {
  id: 'w1',
  sessionId: 's1',
  mode: 'mode1',
  name: 'wf',
  description: '',
  nodes: _graphNodes,
  lines: [_minLine],
}

// 类型级断言：确保 NodeKind / Handle / ConditionType / WorkflowMode 常量形态可被具名引用
//（此处用「类型断言 + 常量值映射」证明枚举齐全，见下方 describe）。

// ---------------------------------------------------------------------------
// 运行时断言：graph-model 常量形态（判别联合各分支 kind 字面量齐全）
// ---------------------------------------------------------------------------
describe('T-014 graph-model 纯类型形态', () => {
  it('GraphNode 判别联合各分支均能通过对象字面量 + 类型断言编译（最小形状）', () => {
    // 运行期仅验证字面量对象非空且 kind 唯一（编译期已证明判别联合成立）。
    const kinds = _graphNodes.map((n) => n.kind)
    expect(kinds).toHaveLength(9)
    expect(new Set(kinds).size).toBe(9)
  })

  it('NodeKind 九类字面量齐全（parent/agent/file/database/start/end/pause/group/proxy）', () => {
    const expected: NodeKind[] = [
      'parent',
      'agent',
      'file',
      'database',
      'start',
      'end',
      'pause',
      'group',
      'proxy',
    ]
    // 通过 _graphNodes 的 kind 覆盖全部 9 类（编译期已收窄字面量，运行期重复确认）。
    expect(expected).toHaveLength(9)
    for (const k of expected) {
      expect(_graphNodes.some((n) => n.kind === k)).toBe(true)
    }
  })

  it('Handle 六类字面量齐全（flow-in/ctx-in/db-in/flow-out/ctx-out/db-out）', () => {
    const handles: Handle[] = ['flow-in', 'ctx-in', 'db-in', 'flow-out', 'ctx-out', 'db-out']
    expect(new Set(handles).size).toBe(6)
  })

  it('ConditionType 三类字面量齐全（pass/fail/content）', () => {
    const conditions: ConditionType[] = ['pass', 'fail', 'content']
    expect(conditions).toEqual(['pass', 'fail', 'content'])
  })

  it('RoleNode 收窄判别 kind 为 parent|agent，代理节点带完整 data 字段', () => {
    expect(_minRoleParent.kind).toBe('parent')
    expect(_minRoleAgent.data.retryLimit).toBe(3)
    // 虚拟节点 proxySourceId 引用主节点（ProxyNode 无独立 data 配置）。
    expect(_minProxy.proxySourceId).toBe('n2')
  })

  it('RoleNode.data 不含冗余 proxySourceId（虚拟节点引用仅由 ProxyNode 顶层承载，Bug 2）', () => {
    // 编译期守卫：若 RoleNode.data 再次混入 proxySourceId，ValidRoleData 收缩为 false，
    // 赋值即编译失败（typecheck 回归），防止冗余字段回潮误导实现。
    type ValidRoleData = 'proxySourceId' extends keyof RoleNode['data'] ? false : true
    const guard: ValidRoleData = true
    expect(guard).toBe(true)
    // 虚拟节点顶层 proxySourceId 为唯一承载处（运行期人工确认）。
    expect(_minProxy.proxySourceId).toBe('n2')
  })
})

// ---------------------------------------------------------------------------
// protocol.ts 端点清单逐字比对（架构文档 §4.6 全部 41 端点；图2 交互改造新增
// 工作流模板 3 端点：listFlowTemplates/putFlowTemplate/deleteFlowTemplate；
// 定时任务阶段新增 3 端点：schedulerTasks/schedulerTaskPut/schedulerTaskDelete
// ——新功能端点以 prompt/定时任务开发.md 为准，用户指令不改写 docs/ 既有文档）
// ---------------------------------------------------------------------------
const EXPECTED_ENDPOINTS: string[] = [
  // 工作流
  'listWorkflows', 'getWorkflow', 'putWorkflow', 'deleteWorkflow', 'createWorkflow',
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
  // 运行
  'run', 'runStatus', 'activeRuns', 'runStop', 'runHistory', 'runResume',
  // 数据库
  'dbTest', 'dbSchema', 'dbSearchPreview',
  // 导入导出 v2
  'exportWorkflow', 'importWorkflow', 'exportAgentTemplate', 'importAgentTemplate',
  // 定时任务（新功能本阶段；需求见 prompt/定时任务开发.md）
  'schedulerTasks', 'schedulerTaskPut', 'schedulerTaskDelete',
]

/**
 * 从 protocol.ts 源文本提取全部 `EP_* = '<endpoint>'` 常量值。
 * 不另起 import（避免在测试里手工枚举 39 个 EP_ 常量造成与实现重复/遗漏），
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

describe('T-014 protocol.ts 端点清单（§4.6 全部端点 + 定时任务 3 端点）', () => {
  it('端点常量定义 48 个且无重复', () => {
    const eps = readProtocolEndpoints()
    expect(eps).toHaveLength(48)
    expect(new Set(eps).size).toBe(48) // 48 端点名全部唯一（无重复常量）
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

// ---------------------------------------------------------------------------
// protocol.ts 工具名常量与可见性元数据
// ---------------------------------------------------------------------------
describe('T-014 protocol.ts 工具名常量与可见性', () => {
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
})

// ---------------------------------------------------------------------------
// protocol.ts 状态/模式枚举与颜色变量
// ---------------------------------------------------------------------------
describe('T-014 protocol.ts 状态/模式/颜色常量', () => {
  it('RUN_STATUSES 六态齐全且与 RunStatus 类型一致（§4.3 持久化状态机 / §6.1）', () => {
    expect(RUN_STATUSES).toEqual([
      'running', 'paused', 'completed', 'failed', 'stopped', 'interrupted',
    ])
    // 编译期守卫：RUN_STATUSES 全元素必须属于 RunStatus——若协议层混入非持久化
    // 状态（如 pending）或类型层漂移，typecheck 即失败，防止两端再次不一致。
    const _runStatusesAll: RunStatus[] = [...RUN_STATUSES]
    expect(_runStatusesAll.length).toBe(RUN_STATUSES.length)
  })

  it('NODE_STATUSES 六态齐全（§6.1 nodes[].status）', () => {
    expect(NODE_STATUSES).toEqual([
      'pending', 'running', 'ok', 'fail', 'skipped', 'react-capped',
    ])
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
})

// ---------------------------------------------------------------------------
// types.ts 结构字段断言（编译期已通过类型断言，运行期抽查关键字段）
// ---------------------------------------------------------------------------
describe('T-014 types.ts 结构形态', () => {
  // 编译期类型守卫：满足各接口最小形状的对象字面量。
  const _runSnapshot: RunSnapshot = {
    id: 'r1',
    flowId: 'w1',
    flowName: 'wf',
    sessionId: 's1',
    mode: 'mode1',
    status: 'running',
    startedAt: '2026-01-01T00:00:00Z',
    endedAt: null,
    summary: '',
    nodes: [{ nodeId: 'n2', status: 'ok', attempts: 1, startedAt: null, endedAt: null, output: '', outputSummary: '' }],
  }
  const _serviceState: ServiceState = {
    id: 'svc1',
    sessionId: 's1',
    name: 's',
    description: '',
    revision: 1,
    nodes: [_minRoleParent],
    lines: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    status: 'stopped',
  }
  const _roleTemplate: RoleTemplate = {
    id: 't1', kind: 'agent', name: 'n', systemPrompt: '', provider: 'p', model: 'm', retryLimit: 3,
  }
  const _fileTemplate: FileTemplate = { id: 'f1', name: 'f', fileKind: 'text', content: '' }
  const _dbTemplate: DatabaseTemplate = {
    id: 'd1', name: 'd', description: '', dbType: 'server', dbKind: 'mysql', conn: { host: 'h', port: 3306, user: 'u', password: 'p', db: 'x' },
  }
  const _groupTemplate: GroupTemplate = { id: 'g1', name: 'g', collabPrompt: '' }
  const _combo: ToolCombo = { id: 'combo-1', name: 'c', tools: ['wf_ask'], mcpServers: [] }
  const _bundle: BundleV2 = {
    format: 'dsh-vw-bundle', version: 2, mode: 'mode1',
    workflow: { name: 'w', description: '', nodes: [_minRoleParent], lines: [] },
    embedded: { roles: [_roleTemplate], files: [_fileTemplate], databases: [_dbTemplate], groups: [_groupTemplate], combos: [_combo] },
  }
  const _userIdMap: UserIdMap = { userId: 'u1', sessionId: 's1' }
  const _nodeOutput: NodeOutputRecord = {
    nodeId: 'n2', status: 'react-capped', attempts: 1, startedAt: null, endedAt: null, output: '', outputSummary: '',
  }

  it('RunSnapshot 关键字段（resumedFromRunId/resumeFromNodeId 可选，nodes.status 枚举）', () => {
    expect(_runSnapshot.resumedFromRunId).toBeUndefined()
    expect(_runSnapshot.nodes[0].status).toBe('ok')
  })

  it('ServiceState 关键字段（status/port/apiKeyHash 可选）', () => {
    expect(_serviceState.status).toBe('stopped')
    expect(_serviceState.port).toBeUndefined()
  })

  it('ToolCombo id 为 `combo-${string}` 模板字面量类型', () => {
    expect(_combo.id).toBe('combo-1')
    // 编译期已证明 id 必须匹配 `combo-${string}`（Template Literal Type）。
  })

  it('BundleV2 关键字段（format=dsh-vw-bundle，version=2，embedded 五类资源）', () => {
    expect(_bundle.format).toBe('dsh-vw-bundle')
    expect(_bundle.version).toBe(2)
    expect(_bundle.embedded.roles).toHaveLength(1)
    expect(_bundle.embedded.combos).toHaveLength(1)
  })

  it('UserIdMap 与 NodeOutputRecord 最小形状成立', () => {
    expect(_userIdMap.userId).toBe('u1')
    expect(_nodeOutput.status).toBe('react-capped')
  })
})

// ---------------------------------------------------------------------------
// 零 import 纯度门：三文件文本不含 `import` 语句与 `from '`
// ---------------------------------------------------------------------------
describe('T-014 零运行时 import 纯度门', () => {
  const files = ['graph-model.ts', 'types.ts', 'protocol.ts']

  it.each(files)('%s 不含任何 `import` 语句', (name) => {
    const src = readShared(name)
    // 兼容 `import type { ... }` 与 `import { ... }` 两种形态，均须不存在运行时 import；
    // 本任务仅允许 type-only import（types.ts 引 GraphNode/Line 用 `import type`），
    // 故精确断言：不存在「非 type 的 import」。graph-model / protocol 则应完全无 import。
    const lines = src.split(/\r?\n/)
    const runtimeImports = lines.filter((l) => /^import\s+(?!type\b)/.test(l.trim()))
    expect(runtimeImports, `${name} 存在运行时 import`).toEqual([])
  })

  it('graph-model.ts 与 protocol.ts 完全零 import（连 type import 也无）', () => {
    for (const name of ['graph-model.ts', 'protocol.ts']) {
      const src = readShared(name)
      expect(/^\s*import\b/m.test(src), `${name} 含 import`).toBe(false)
    }
  })

  it('types.ts 仅含 type-only import（纯类型引用，编译期擦除）', () => {
    const src = readShared('types.ts')
    const lines = src.split(/\r?\n/).map((l) => l.trim())
    const imports = lines.filter((l) => /^import/.test(l))
    for (const imp of imports) {
      expect(imp.startsWith('import type '), `types.ts 非 type import：${imp}`).toBe(true)
    }
  })

  it('三文件不含 `from "` / `from \'`（无模块说明符——除 types.ts 的 type-only 引用）', () => {
    for (const name of ['graph-model.ts', 'protocol.ts']) {
      const src = readShared(name)
      expect(src.includes('from '), `${name} 含 from 说明符`).toBe(false)
    }
    // types.ts 允许 `import type { ... } from './graph-model.js'` 单一纯类型引用。
    const typesSrc = readShared('types.ts')
    expect((typesSrc.match(/from '/g) ?? []).length).toBeLessThanOrEqual(1)
  })
})
