// tests/host/transfer/fixtures/flow-fixtures.ts
//
// 导入导出领域测试夹具：真实 FlowStore（临时目录）+ 最小图文档与三类模板构造器。
// 资源回收约定：使用方在测试文件内 `afterEach(cleanupAll)`。

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FlowStore } from '../../../../src/host/storage/flow-store.js'
import { stageLabel } from '../../../../src/host/graph/index.js'
import type { DatabaseNode, RoleNode, StageNode, WorkflowDocument } from '../../../../src/host/shared/graph-model.js'

/** 待回收资源（测试文件 afterEach 经 cleanupAll 回收）。 */
export const cleanups: Array<() => Promise<void>> = []

/** 回收全部登记资源（可重复调用）。 */
export async function cleanupAll(): Promise<void> {
  await Promise.all(cleanups.splice(0).map((fn) => fn()))
}

export function stage(id: string, kind: 'start' | 'end' | 'pause'): StageNode {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: stageLabel(kind, 'mode1') } }
}

export function agent(id: string, label: string): RoleNode {
  return {
    id,
    kind: 'agent',
    position: { x: 0, y: 0 },
    data: {
      label,
      systemPrompt: `任务：${label}`,
      provider: '',
      model: '',
      presetId: null,
      retryLimit: 3,
      reactLimit: null,
      inputSchema: '',
      outputSchema: '',
      groupId: null,
    },
  }
}

export function databaseNode(id: string, localPath: string): DatabaseNode {
  return {
    id,
    kind: 'database',
    position: { x: 0, y: 0 },
    data: { label: '本地库', description: '', dbType: 'local', dbKind: 'sqlite', localPath },
  }
}

export function makeFlow(): WorkflowDocument {
  return {
    id: 'flow-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '测试流程',
    description: '测试目标',
    revision: 1,
    nodes: [stage('n-start', 'start'), agent('n-a1', '子任务A'), stage('n-pause', 'pause'), agent('n-a2', '子任务B'), stage('n-end', 'end')],
    lines: [
      { id: 'l1', source: 'n-start', target: 'n-a1', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l2', source: 'n-a1', target: 'n-pause', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l3', source: 'n-pause', target: 'n-a2', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
      { id: 'l4', source: 'n-a2', target: 'n-end', sourceHandle: 'flow-out', targetHandle: 'flow-in' },
    ],
  }
}

/** 含协作组节点的图文档（验证 embedded.groups 内联语义）。 */
export function makeFlowWithGroup(): WorkflowDocument {
  const flow = makeFlow()
  return {
    ...flow,
    nodes: [
      ...flow.nodes,
      {
        id: 'g1',
        kind: 'group',
        position: { x: 0, y: 0 },
        data: { label: '协作组一', collabPrompt: '成员互相质询', memberIds: ['n-a1', 'n-a2'] },
      },
    ] as WorkflowDocument['nodes'],
  }
}

/** 角色模板（导入导出往返用）。 */
export function roleTemplate(): Record<string, unknown> {
  return { id: 'role-1', kind: 'agent', name: '研究员', systemPrompt: 'x', provider: '', model: '', presetId: 'standard', retryLimit: 3 }
}

/** 文件模板（嵌入资源重建用）。 */
export function fileTemplate(): Record<string, unknown> {
  return { id: 'file-1', name: '资料.pdf', fileKind: 'file', managedPath: 'data/files/x.pdf', fileName: '资料.pdf' }
}

/** 数据库模板（嵌入资源重建用）。 */
export function databaseTemplate(): Record<string, unknown> {
  return { id: 'db-1', name: '本地库', description: 'd', dbType: 'local', dbKind: 'sqlite', localPath: '/tmp/x.db' }
}

/** 构造独立数据目录的 FlowStore（每次调用独立，互不干扰）。 */
export async function makeStore(): Promise<FlowStore> {
  const dir = await mkdtemp(join(tmpdir(), 'vw-transfer-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const store = new FlowStore(dir)
  await store.init()
  return store
}
