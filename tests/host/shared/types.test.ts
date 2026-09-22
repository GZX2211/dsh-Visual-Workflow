// tests/host/shared/types.test.ts
//
// 共享契约：types.ts（type-only barrel）与各契约本体的结构形态测试。
// 覆盖：run 快照 / 服务状态 / 模板与 bundle / userId 映射 / 节点输出记录 / 定时任务 /
// 元参数，以及「barrel 路径 `from './types.js'` 仍可解析全部契约」这一路径稳定性契约。
//
// 运行环境：node（host 测试默认）。

import { describe, expect, it } from 'vitest'
import type {
  BundleV2,
  DatabaseTemplate,
  FileTemplate,
  GroupTemplate,
  NodeOutputRecord,
  OrgBudget,
  OrgMeta,
  RoleTemplate,
  RunSnapshot,
  RunStatus,
  ScheduledTask,
  ScheduledTaskRuntime,
  ScheduledTaskView,
  ServiceState,
  ToolCombo,
  UserIdMap,
  WorkflowTemplate,
} from '../../../src/host/shared/types.js'
import type { GraphNode } from '../../../src/host/shared/graph-model.js'

/** 最小角色节点（复用图模型最小形状）。 */
const _minRoleNode: GraphNode = {
  id: 'n2',
  kind: 'agent',
  position: { x: 0, y: 0 },
  data: { label: '子', systemPrompt: '', provider: 'deepseek', model: 'chat', retryLimit: 3 },
}

describe('shared/types 契约形态', () => {
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
    nodes: [_minRoleNode],
    lines: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    status: 'stopped',
  }
  // 模板契约声明了持久化层实际写入的时间戳字段（契约与磁盘事实对齐）。
  const _roleTemplate: RoleTemplate = {
    id: 't1', kind: 'agent', name: 'n', systemPrompt: '', provider: 'p', model: 'm', retryLimit: 3,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
  }
  const _fileTemplate: FileTemplate = { id: 'f1', name: 'f', fileKind: 'text', content: '' }
  const _dbTemplate: DatabaseTemplate = {
    id: 'd1', name: 'd', description: '', dbType: 'server', dbKind: 'mysql', conn: { host: 'h', port: 3306, user: 'u', password: 'p', db: 'x' },
  }
  const _groupTemplate: GroupTemplate = { id: 'g1', name: 'g', collabPrompt: '' }
  const _combo: ToolCombo = { id: 'combo-1', name: 'c', tools: ['wf_ask'], mcpServers: [] }
  const _bundle: BundleV2 = {
    format: 'dsh-vw-bundle', version: 2, mode: 'mode1',
    workflow: { name: 'w', description: '', nodes: [_minRoleNode], lines: [] },
    embedded: { roles: [_roleTemplate], files: [_fileTemplate], databases: [_dbTemplate], groups: [_groupTemplate], combos: [_combo] },
  }
  const _userIdMap: UserIdMap = { userId: 'u1', sessionId: 's1' }
  const _nodeOutput: NodeOutputRecord = {
    nodeId: 'n2', status: 'react-capped', attempts: 1, startedAt: null, endedAt: null, output: '', outputSummary: '',
  }
  const _workflowTemplate: WorkflowTemplate = {
    id: 'tpl1', mode: 'mode1', name: '模板', description: '', nodes: [], lines: [],
  }
  const _orgMeta: OrgMeta = { nodeMax: 12, planFreedom: 'templates-only', failurePolicy: { retry: 1, thenEscalate: true, askUserOnUnresolved: true } }
  const _orgBudget: OrgBudget = {
    nodeUsed: 0, nodeMax: 12, nodeRemaining: 12,
    groupUsed: 0, groupMax: 0, groupRemaining: null,
    membersMax: 0, parallelBranchMax: 0,
    milestoneUsed: 0, milestoneMax: 0, milestoneRemaining: null,
    patchOpsMax: 0, patchOpsRemaining: null,
    forbiddenShapes: [], namingConvention: null,
  }
  const _scheduledTask: ScheduledTask = {
    taskId: 'task-1',
    name: '每日巡检',
    workflowTemplateId: 'tpl1',
    sessionMode: 'new-session',
    ownerSessionId: 's1',
    enabled: true,
    timezone: 'Asia/Shanghai',
    window: { startDate: '2026-01-01', endDate: '2026-12-31', daysOfWeek: [1, 2, 3, 4, 5], timeRanges: [{ start: '09:00', end: '18:00' }] },
    triggerMode: 'daily_time',
    dailyTimeConfig: { timePoints: ['09:00'] },
    intervalConfig: null,
    runtimePolicy: { missedTrigger: 'skip', concurrency: 'skip', configUpdate: 'immediate' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
  const _runtime: ScheduledTaskRuntime = {
    status: 'idle', nextTriggerAt: null, currentSessionId: null, currentFlowId: null,
    currentRunId: null, lastTriggeredAt: null, lastResult: null, lastError: '',
  }
  const _taskView: ScheduledTaskView = { task: _scheduledTask, runtime: _runtime }

  it('RunSnapshot 关键字段（resumedFromRunId/resumeFromNodeId 可选，nodes.status 枚举）', () => {
    expect(_runSnapshot.resumedFromRunId).toBeUndefined()
    expect(_runSnapshot.nodes[0].status).toBe('ok')
    // 编译期守卫：RunSnapshot.status 必须属于 RunStatus（持久化六态，不含节点级 pending）。
    const status: RunStatus = _runSnapshot.status
    expect(status).toBe('running')
  })

  it('ServiceState 关键字段（status/port/apiKeyHash 可选）', () => {
    expect(_serviceState.status).toBe('stopped')
    expect(_serviceState.port).toBeUndefined()
  })

  it('模板契约与持久化层写入字段对齐（createdAt/updatedAt 可选但受支持）', () => {
    expect(_roleTemplate.createdAt).toBe('2026-01-01T00:00:00Z')
    expect(_roleTemplate.updatedAt).toBe('2026-01-02T00:00:00Z')
    expect(_fileTemplate.createdAt).toBeUndefined()
    expect(_groupTemplate.updatedAt).toBeUndefined()
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

  it('WorkflowTemplate 与 OrgMeta/OrgBudget 经 barrel 可解析（契约路径稳定）', () => {
    expect(_workflowTemplate.mode).toBe('mode1')
    expect(_orgMeta.nodeMax).toBe(12)
    expect(_orgBudget.nodeRemaining).toBe(12)
  })

  it('定时任务契约最小形状成立（实体 + 运行态 + 视图）', () => {
    expect(_scheduledTask.triggerMode).toBe('daily_time')
    expect(_scheduledTask.intervalConfig).toBeNull()
    expect(_runtime.status).toBe('idle')
    expect(_taskView.task.taskId).toBe('task-1')
  })
})
