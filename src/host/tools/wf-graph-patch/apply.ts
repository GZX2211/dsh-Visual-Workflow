// src/host/tools/wf-graph-patch/apply.ts
//
// wf_graph_patch 的**纯函数内核**（自主编排方案 §4.2）：
//   - applyGraphOpsInPlace：单份副本上的就地逐条应用（整批与容错两条路径共用的唯一实现，
//     分支必须原子：先校验后改动）；
//   - applyGraphOps：按序应用图结构操作，返回新文档（不改写入参，**一次**深拷贝语义）；
//   - applyGraphOpsTolerant：逐条容错（失败 op 记入 errors，其余继续；整批只深拷贝一次）；
//   - ensureGroupConsistency：Team 与成员的 groupId 双向一致（复用画布侧同款语义）。
// 不触盘、不读时钟/随机源——落盘与校验在 tool.ts 执行层。

import {
  CONDITION_TYPES,
  NODE_HANDLES,
  NODE_KINDS,
  makeLineId,
  makeNodeId,
  pairingTargetOf,
  stageLabel,
} from '../../graph/index.js'
import { WfError } from '../../orchestrator/index.js'
import { OP_FIELD_SHAPES } from '../../prompts/index.js'
import { DEFAULT_OUTPUT_CONTRACT_TEXT } from '../../shared/protocol.js'
import type { GraphNode, Handle, Line, WorkflowDocument } from '../../shared/graph-model.js'
import { ROLE_SOURCE_ASSET_ID_FIELD } from './types.js'
import type { GraphPatchOp, GraphPatchResult, PatchOpFailure } from './types.js'

/**
 * 参数层错误（WF_BAD_ARGS）：字段没给对，**不是**图语义问题。
 * 与 WF_GRAPH_INVALID 分开的理由：后者会诱导模型去改图，而真正要改的是自己的入参形状。
 */
function badArgs(message: string): never {
  throw new WfError(message, 'WF_BAD_ARGS')
}

/** 校验连接点是否属于该节点种类；不属于则报出可用值（而不是写出一条无效连线）。 */
function resolveHandle(handle: string, kind: string, side: 'out' | 'in'): Handle {
  const def = NODE_HANDLES[kind as keyof typeof NODE_HANDLES]
  const allowed = (side === 'out' ? def?.outputs : def?.inputs) ?? []
  if (!allowed.includes(handle as Handle)) {
    throw new WfError(
      `connect: node kind "${kind}" has no ${side === 'out' ? 'output' : 'input'} handle "${handle}" (available: ${allowed.join('/') || 'none'})`,
      'WF_GRAPH_INVALID',
    )
  }
  return handle as Handle
}

/** 深拷贝文档骨架（保持元数据字段；节点/连线走 JSON 深拷贝避免共享引用）。 */
export function cloneDoc(doc: WorkflowDocument): WorkflowDocument {
  return {
    ...doc,
    nodes: JSON.parse(JSON.stringify(doc.nodes ?? [])) as GraphNode[],
    lines: JSON.parse(JSON.stringify(doc.lines ?? [])) as Line[],
  }
}

/** 阶段节点标签（判定/补默认都走同一实现，避免两处硬编码漂移）。 */
function stageLabelOf(kind: 'start' | 'end' | 'pause', mode: 'mode1' | 'mode2'): string {
  return stageLabel(kind, mode)
}

/**
 * task 节点 data 归一化：只保留 label/content。
 * 旧文件节点的受管字段随形态退役；创建与更新都走同一归一化，避免旧字段回流。
 * 调用的 `raw` 可以是既有 data 与 patch 的合并结果；label 为空时回退节点 id。
 */
function normalizeTaskNodeData(raw: Record<string, unknown>, fallbackLabel: string): Record<string, unknown> {
  return {
    label: String(raw.label ?? '').trim() || fallbackLabel,
    content: String(raw.content ?? ''),
  }
}

/**
 * Team 一致性：成员节点的 groupId 与组的 memberIds 双向对齐。
 * 入组：写 node.data.groupId；出组：置 null。组不存在或成员不存在 → 稳定错误。
 */
export function ensureGroupConsistency(nodes: GraphNode[], groupId: string, memberIds: string[]): GraphNode[] {
  const group = nodes.find((node) => node.id === groupId)
  if (!group || group.kind !== 'group') {
    throw new WfError(`WF_GRAPH_INVALID: Team not found: ${groupId}`, 'WF_GRAPH_INVALID')
  }
  const unique = [...new Set(memberIds.map(String).filter(Boolean))]
  for (const memberId of unique) {
    const member = nodes.find((node) => node.id === memberId)
    if (!member) throw new WfError(`WF_GRAPH_INVALID: Team member not found: ${memberId}`, 'WF_GRAPH_INVALID')
    if (member.kind !== 'agent' && member.kind !== 'parent') {
      throw new WfError(`WF_GRAPH_INVALID: a Team member must be a role node (${memberId} is ${member.kind})`, 'WF_GRAPH_INVALID')
    }
  }
  return nodes.map((node) => {
    if (node.id === groupId && node.kind === 'group') {
      return { ...node, data: { ...node.data, memberIds: unique } } as GraphNode
    }
    if (node.kind === 'agent' || node.kind === 'parent') {
      const current = (node.data as { groupId?: string | null }).groupId ?? null
      // 只改本组相关的成员：其它组的成员保持不变
      const next = unique.includes(node.id) ? groupId : (current === groupId ? null : current)
      if (next === current) return node
      return { ...node, data: { ...(node.data as Record<string, unknown>), groupId: next } } as GraphNode
    }
    return node
  })
}

/**
 * 虚拟节点 data 归一化：只保留 `label`（画布显示名）。
 * 未知字段一律静默丢弃（含退役字段），归一化后无有效字段则返回 undefined
 * （调用方删除 data，保持文档形状最小）。
 */
function normalizeProxyData(raw: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  const label = raw?.label
  if (label !== undefined && label !== null && String(label).trim()) out.label = String(label).trim()
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * 角色节点默认重试上限（父代理不可配置；与画布新建角色节点保持一致）。
 */
export const DEFAULT_ROLE_RETRY_LIMIT = 3

/**
 * 父代理**不可配置**的角色节点字段（画布所有；用户裁决）。
 *
 * 为什么：这些字段属于运行治理、提示词注入与「节点来源」范畴——retryLimit / reactLimit
 * 影响重试与 ReAct 截停，promptFilePath 会把角色提示词指向宿主文件，
 * injectSystemPrompt / injectToolSections 决定官方系统提示词段与工具散文段的注入；
 * sourceAssetId 是「该节点由哪个角色资产拖入而来」的事实，资产入库时据此登记源资产新版本，
 * 由父代理随意写入会让资产版本链指向错误的来源。
 * 因此一律不进入它的配置面：
 *   - create_node：剥离传入值，按系统默认写入；
 *   - update_node_data：剥离传入值，保留节点现值（用户手动改过的值不被覆盖）。
 * 注意：关闭注入开关只影响散文段与 assembly.contexts（工具调用能力由 tools[] 决定），
 * 且环境事实段（工作目录）不受该开关管辖。
 */
export const PARENT_UNCONFIGURABLE_ROLE_FIELDS = [
  'retryLimit',
  'reactLimit',
  'promptFilePath',
  'injectSystemPrompt',
  'injectToolSections',
  'sourceAssetId',
] as const

/** 剥离父代理不可配置字段（入参不被修改）。 */
function stripParentUnconfigurableRoleFields(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data }
  for (const key of PARENT_UNCONFIGURABLE_ROLE_FIELDS) delete out[key]
  return out
}

/**
 * 读取角色引用展开层注入的来源资产字段。
 *
 * 为什么来源走 op 顶层而不是 data：sourceAssetId 是父代理不可配置字段，模型手写值
 * 必须继续被剥离；展开层是系统内部写入方，只有它设置的这个字段被 apply 接受。
 * 出现但为空串 = 「引用成功但没有来源」（内联角色未绑定资产），update 据此清除旧绑定。
 */
function roleSourceAssetIdOf(op: unknown): string | undefined {
  const record = op as Record<string, unknown>
  if (!(ROLE_SOURCE_ASSET_ID_FIELD in record)) return undefined
  return String(record[ROLE_SOURCE_ASSET_ID_FIELD] ?? '').trim()
}

/**
 * 创建路径的系统默认值（父代理传入的对应字段一律忽略）。
 * 官方人设/系统散文段对节点子代理没有价值，只会与角色提示词重复，故注入开关固定关闭；
 * 重试与 ReAct 上限取系统默认。
 */
export function applyRoleNodeCreateDefaults(raw: unknown): Record<string, unknown> {
  const data = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const out = stripParentUnconfigurableRoleFields(data)
  out.retryLimit = DEFAULT_ROLE_RETRY_LIMIT
  out.reactLimit = null
  out.injectSystemPrompt = false
  out.injectToolSections = false
  return out
}

/**
 * 创建路径的输出契约默认值：agent 节点未提供 outputSchema 时写入默认契约文本，
 * 与画布新建（graph/model.ts 的 newRoleNode）保持一致——界面显示、运行期注入与磁盘同值。
 * 父代理不参与节点交接，故不落默认；显式传入（含空串）一律不覆盖，空串即「明确清空」。
 */
export function applyRoleNodeOutputContractDefault(
  data: Record<string, unknown>,
  kind: 'parent' | 'agent',
): Record<string, unknown> {
  if (kind !== 'agent') return data
  if (data.outputSchema !== undefined && data.outputSchema !== null) return data
  return { ...data, outputSchema: DEFAULT_OUTPUT_CONTRACT_TEXT }
}

/**
 * 角色节点 data 补全（图结构补丁的**唯一规范化入口**）。
 *
 * 为什么必须有（2026.09 实机取证）：ops 是自由对象，`create_node` 只把 raw 原样落盘，
 * 父代理最自然的写法 `{ kind:'agent', data:{ label, systemPrompt } }` 会产出
 * `presetId: undefined` 的节点——而运行期 `resolveAgentTools` 对空 presetId 的判定是
 * **零工具集**（连 read/write 都调不到），`provider/model` 为空也会退化成宿主默认。
 * 检查器与 validateFlow 都不校验节点 data 形状，于是这类「空壳节点」会一路落盘到运行期
 * 才暴露。补齐默认值与画布新建角色（graph/model.ts 的 newRoleNode）完全一致，
 * 保证「父代理建出来的节点」与「用户拖出来的节点」形状无差异。
 *
 * 语义：`null` 与 `undefined` 一律视为未提供（补默认）；显式 `''` / 数字 / 布尔原样保留。
 */
export function normalizeRoleNodeData(raw: unknown): Record<string, unknown> {
  const data = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const presetId = data.presetId
  return {
    ...data,
    label: data.label === undefined || data.label === null ? '' : String(data.label),
    systemPrompt: data.systemPrompt === undefined || data.systemPrompt === null ? '' : String(data.systemPrompt),
    provider: data.provider === undefined || data.provider === null ? '' : String(data.provider),
    model: data.model === undefined || data.model === null ? '' : String(data.model),
    // presetId 空 → 运行期零工具集（见函数头）；此处只做类型收口，不替模型猜一个组合
    presetId: presetId === undefined || presetId === null || String(presetId).trim() === '' ? null : String(presetId),
    retryLimit: typeof data.retryLimit === 'number' ? data.retryLimit : DEFAULT_ROLE_RETRY_LIMIT,
    reactLimit: data.reactLimit ?? null,
    inputSchema: data.inputSchema === undefined || data.inputSchema === null ? '' : String(data.inputSchema),
    outputSchema: data.outputSchema === undefined || data.outputSchema === null ? '' : String(data.outputSchema),
    injectSystemPrompt: data.injectSystemPrompt !== false,
    injectToolSections: data.injectToolSections !== false,
    groupId: data.groupId ?? null,
  }
}

/** 逐 op 结果收集器（整批路径与容错路径共用；只在 op 成功后才写入）。 */
interface OpOutcome {
  createdNodeIds: string[]
  removedNodeIds: string[]
  updatedNodeIds: string[]
  connectedLineIds: string[]
  disconnectedLineIds: string[]
}

function emptyOpOutcome(): OpOutcome {
  return {
    createdNodeIds: [],
    removedNodeIds: [],
    updatedNodeIds: [],
    connectedLineIds: [],
    disconnectedLineIds: [],
  }
}

/**
 * 父代理节点只能由用户手工调整（用户裁决 2026-10）：wf_graph_patch 只服务「编排子代理」。
 * 父代理经它增删改自身节点或连线，等于重写自己的运行时角色——父代理是否被流程线驱动，
 * 会直接改变它自己的执行模式（纯编排 / 编排+自执行 / 纯执行）。
 */
function rejectParentSelfEdit(nodeId: string, opName: string): never {
  throw new WfError(
    `WF_PARENT_SELF_EDIT: ${opName}: the parent-agent node "${nodeId}" can only be adjusted by the user on the canvas; `
      + 'the parent agent must not orchestrate itself — coordinate child nodes with wf_run_node / wf_send_message instead',
    'WF_PARENT_SELF_EDIT',
  )
}

/** 目标节点是父代理时拒绝（改图写路径共用；节点不存在时由调用方另行处理）。 */
function assertNotParentNode(doc: WorkflowDocument, nodeId: string, opName: string): void {
  const node = doc.nodes.find((item) => item.id === nodeId)
  if (node?.kind === 'parent') rejectParentSelfEdit(nodeId, opName)
}

/** 连线任一端是父代理时拒绝（连/断父代理节点的流程线都会改变它的执行模式）。 */
function assertNoParentEndpoint(doc: WorkflowDocument, source: string, target: string, opName: string): void {
  for (const nodeId of [source, target]) {
    if (doc.nodes.some((item) => item.id === nodeId && item.kind === 'parent')) rejectParentSelfEdit(nodeId, opName)
  }
}

/**
 * **就地**按序应用图结构操作（内部）：改动直接落在传入的 doc 上，成功项写入 outcome。
 *
 * 为什么要就地：整图深拷贝按 op 计费（每条 op 都要重算一次全图），N 条 op 即 N 次全图往返；
 * 一次深拷贝 + 逐条就地让拷贝次数与 op 数无关。
 *
 * **原子性是本函数的硬前提**：调用方在同一份副本上连续推进，没有第二份副本可回退，
 * 因此每个分支都必须先完成全部可能抛错的校验，再改动 doc 与 outcome——
 * 「失败 op 不污染后续判定基础」由此保证，而不是由「内部副本 + 整份丢弃」保证。
 * （容错层逐条调用，传单元素数组；严格应用器一次传入全部 op。）
 */
function applyGraphOpsInPlace(
  doc: WorkflowDocument,
  ops: readonly GraphPatchOp[],
  mode: 'mode1' | 'mode2',
  outcome: OpOutcome,
): void {
  for (const op of ops) {
    switch (op.op) {
      case 'create_node': {
        const opTop = op as unknown as Record<string, unknown>
        const hasNodeObject = opTop.node !== undefined && opTop.node !== null
          && typeof opTop.node === 'object' && !Array.isArray(opTop.node)
        if (!hasNodeObject) {
          // 实测最常见的写法错误：把 kind/data 平铺到 op 顶层。
          // 以前这里只报「非法节点种类「」」，模型无法定位到自己少了一层 node 包装。
          const flattened = 'kind' in opTop || 'data' in opTop
          badArgs(
            `create_node: missing the node object${flattened ? ' (kind/data was written directly on the op instead of inside node)' : ''}; correct shape: ${OP_FIELD_SHAPES.create_node}`,
          )
        }
        const raw = opTop.node as Record<string, unknown>
        const rawKind = String(raw.kind ?? '').trim()
        if (!rawKind) {
          badArgs(`create_node: node.kind is required; correct shape: ${OP_FIELD_SHAPES.create_node}`)
        }
        // 旧提示词/旧调用方可能仍写 kind='file'：按任务节点接收（读取兼容，不告警）。
        const kind = rawKind === 'file' ? 'task' : rawKind
        if (!NODE_KINDS.includes(kind as GraphNode['kind'])) {
          throw new WfError(`WF_GRAPH_INVALID: create_node: invalid node kind "${kind}" (allowed: ${NODE_KINDS.join('/')})`, 'WF_GRAPH_INVALID')
        }
        const id = String(raw.id ?? '').trim() || makeNodeId()
        if (kind === 'parent') rejectParentSelfEdit(id, 'create_node')
        if (doc.nodes.some((node) => node.id === id)) {
          throw new WfError(`WF_GRAPH_INVALID: create_node: node id already exists "${id}"`, 'WF_GRAPH_INVALID')
        }
        const position = (raw.position as { x?: unknown; y?: unknown } | undefined) ?? { x: 0, y: 0 }
        const node = {
          ...raw,
          id,
          kind,
          // 坐标纯视图数据（D-16）：父代理不产出坐标；缺省写哨兵 {0,0}，由客户端自动布局接手
          position: { x: Number(position?.x) || 0, y: Number(position?.y) || 0 },
        } as unknown as GraphNode
        if (node.kind === 'start' || node.kind === 'end' || node.kind === 'pause') {
          // 阶段节点属性锁定：label 由系统硬编码（忽略补丁传入值）
          ;(node as { data: { label: string } }).data = { label: stageLabelOf(node.kind, mode) }
        } else if (node.kind === 'parent' || node.kind === 'agent') {
          // 角色节点 data 补全（缺 data 也不崩：按空对象补默认值）
          const withCreateDefaults = applyRoleNodeCreateDefaults(raw.data)
          const data = normalizeRoleNodeData(
            applyRoleNodeOutputContractDefault(withCreateDefaults, node.kind),
          )
          // 引用来源在默认值归一之后落盘：sourceAssetId 被创建默认值剥离，
          // 只有展开层注入的内部字段能把它写回新节点。
          const sourceAssetId = roleSourceAssetIdOf(op)
          if (sourceAssetId) data.sourceAssetId = sourceAssetId
          ;(node as { data: Record<string, unknown> }).data = data
        }
        if (node.kind === 'proxy') {
          const sourceId = String((raw as { proxySourceId?: unknown }).proxySourceId ?? '')
          const source = doc.nodes.find((item) => item.id === sourceId)
          if (!source || (source.kind !== 'agent' && source.kind !== 'parent')) {
            throw new WfError(`WF_GRAPH_INVALID: create_node: a proxy node must reference an existing role node (${sourceId || 'proxySourceId not provided'})`, 'WF_GRAPH_INVALID')
          }
          // 虚拟节点 data 只认 label（未知字段静默丢弃）
          const proxyData = normalizeProxyData((raw.data ?? {}) as Record<string, unknown>)
          if (proxyData) (node as { data?: Record<string, unknown> }).data = proxyData
          else delete (node as { data?: unknown }).data
        }
        if (node.kind === 'group') {
          const data = (raw.data ?? {}) as { label?: unknown; collabPrompt?: unknown; size?: unknown }
          ;(node as unknown as { data: Record<string, unknown> }).data = {
            label: String(data.label ?? node.id),
            collabPrompt: String(data.collabPrompt ?? ''),
            memberIds: [],
            // Team 卡片尺寸（视图数据；缺省与画布默认一致）
            size: (data.size as { w: number; h: number } | undefined) ?? { w: 300, h: 220 },
          }
        }
        if (node.kind === 'task') {
          // 任务节点只落 label/content；旧受管字段（fileKind/managedPath/files）随形态退役。
          ;(node as unknown as { data: Record<string, unknown> }).data = normalizeTaskNodeData((raw.data ?? {}) as Record<string, unknown>, id)
        }
        doc.nodes.push(node)
        outcome.createdNodeIds.push(id)
        break
      }
      case 'remove_node': {
        const nodeId = String(op.nodeId ?? '').trim()
        if (!nodeId) badArgs(`remove_node: nodeId is required; correct shape: ${OP_FIELD_SHAPES.remove_node}`)
        const node = doc.nodes.find((item) => item.id === nodeId)
        if (!node) throw new WfError(`WF_GRAPH_INVALID: remove_node: node not found "${nodeId}"`, 'WF_GRAPH_INVALID')
        assertNotParentNode(doc, nodeId, 'remove_node')
        const cascade = op.cascade !== false
        const removed = new Set<string>([nodeId])
        if (cascade) {
          // 级联：其虚拟节点 + 组内成员引用清理（与画布删除语义一致）
          for (const item of doc.nodes) {
            if (item.kind === 'proxy' && item.proxySourceId === nodeId) removed.add(item.id)
          }
        }
        doc.lines = doc.lines.filter((line) => !removed.has(line.source) && !removed.has(line.target))
        doc.nodes = doc.nodes.filter((item) => !removed.has(item.id))
        // 组内成员被删：从各组成员清单移除（Team 卡片保持可用）
        doc.nodes = doc.nodes.map((item) => {
          if (item.kind !== 'group') return item
          const members = (item.data.memberIds ?? []).filter((memberId) => !removed.has(memberId))
          return members.length === (item.data.memberIds ?? []).length
            ? item
            : { ...item, data: { ...item.data, memberIds: members } } as GraphNode
        })
        if (node.kind === 'group') {
          // 删除 Team 卡片：成员出组（groupId 置 null）
          doc.nodes = doc.nodes.map((item) => {
            if (item.kind !== 'agent' && item.kind !== 'parent') return item
            return (item.data.groupId === nodeId) ? { ...item, data: { ...item.data, groupId: null } } as GraphNode : item
          })
        }
        outcome.removedNodeIds.push(...removed)
        break
      }
      case 'update_node_data': {
        const nodeId = String(op.nodeId ?? '').trim()
        if (!nodeId) badArgs(`update_node_data: nodeId is required; correct shape: ${OP_FIELD_SHAPES.update_node_data}`)
        const node = doc.nodes.find((item) => item.id === nodeId)
        if (!node) throw new WfError(`WF_GRAPH_INVALID: update_node_data: node not found "${nodeId}"`, 'WF_GRAPH_INVALID')
        assertNotParentNode(doc, nodeId, 'update_node_data')
        if (node.kind === 'start' || node.kind === 'end' || node.kind === 'pause') {
          throw new WfError(`WF_GRAPH_INVALID: update_node_data: stage-node properties (${node.kind}) are locked; only the label can change and it is system-managed`, 'WF_GRAPH_INVALID')
        }
        const isRoleNode = node.kind === 'parent' || node.kind === 'agent'
        const rawPatch = { ...(op.data ?? {}) } as Record<string, unknown>
        delete rawPatch.kind
        // 角色节点：父代理不可配置字段直接剥离——保留节点现值（用户手动改过的值不被覆盖）
        const patch = isRoleNode ? stripParentUnconfigurableRoleFields(rawPatch) : rawPatch
        if (node.kind === 'proxy') {
          // 虚拟节点：引用字段在顶层；data 只认 label
          let nextProxySourceId: string | undefined
          if ('proxySourceId' in patch) {
            const sourceId = String(patch.proxySourceId ?? '')
            const source = doc.nodes.find((item) => item.id === sourceId)
            if (!source || (source.kind !== 'agent' && source.kind !== 'parent')) {
              throw new WfError(`WF_GRAPH_INVALID: update_node_data: a proxy node must reference an existing role node (${sourceId})`, 'WF_GRAPH_INVALID')
            }
            nextProxySourceId = sourceId
          }
          const merged = { ...((node as { data?: Record<string, unknown> }).data ?? {}), ...patch }
          // 先规范化再落账：本函数必须原子，失败 op 不得留下半成品引用。
          const proxyData = normalizeProxyData(merged)
          if (nextProxySourceId !== undefined) (node as { proxySourceId: string }).proxySourceId = nextProxySourceId
          if (proxyData) (node as { data?: Record<string, unknown> }).data = proxyData
          else delete (node as { data?: unknown }).data
        } else if (node.kind === 'task' || String((node as unknown as { kind?: unknown }).kind ?? '') === 'file') {
          // 任务节点：合并后只保留 label/content；旧 file 节点（读取兼容前）一并落任务形状。
          const target = node as unknown as { kind: string; data?: Record<string, unknown> }
          target.kind = 'task'
          target.data = normalizeTaskNodeData({ ...(target.data ?? {}), ...patch }, nodeId)
        } else {
          const target = node as unknown as { data?: Record<string, unknown> }
          const next = { ...(target.data ?? {}), ...patch }
          // 成员关系只能经 set_group_members 维护；此处保守地忽略成员字段（防组内清单与节点不一致）
          delete next.memberIds
          // 角色节点：合并后再过一次规范化（补全被手改/导入数据抹掉的必填字段）
          target.data = isRoleNode ? normalizeRoleNodeData(next) : next
          if (isRoleNode) {
            // 引用来源：非空写入、空串清除。清除是必要的——把节点切换到无来源的内联角色后，
            // 旧绑定若保留，下一次入库会把角色版本登记到错误的来源资产上。
            const sourceAssetId = roleSourceAssetIdOf(op)
            if (sourceAssetId !== undefined) {
              if (sourceAssetId) target.data.sourceAssetId = sourceAssetId
              else delete target.data.sourceAssetId
            }
          }
        }
        outcome.updatedNodeIds.push(nodeId)
        break
      }
      case 'connect': {
        const opc = op as unknown as Record<string, unknown>
        if (opc.from !== undefined || opc.to !== undefined) {
          // 实测最常见的写法错误：端点字段猜成 from/to（契约是 source/target）。
          badArgs(`connect: the endpoint fields are source/target (not from/to); correct shape: ${OP_FIELD_SHAPES.connect}`)
        }
        const source = String(opc.source ?? '').trim()
        const target = String(opc.target ?? '').trim()
        if (!source || !target) {
          badArgs(
            `connect: source/target are required (received source=${JSON.stringify(opc.source ?? null)}, target=${JSON.stringify(opc.target ?? null)}); `
            + `correct shape: ${OP_FIELD_SHAPES.connect}`,
          )
        }
        const sourceNode = doc.nodes.find((item) => item.id === source)
        const targetNode = doc.nodes.find((item) => item.id === target)
        if (!sourceNode) {
          throw new WfError(`WF_GRAPH_INVALID: connect: source node not found "${source}" (node ids come from the orchestration directive or the wf_org_catalog workflow skeleton)`, 'WF_GRAPH_INVALID')
        }
        if (!targetNode) {
          throw new WfError(`WF_GRAPH_INVALID: connect: target node not found "${target}" (node ids come from the orchestration directive or the wf_org_catalog workflow skeleton)`, 'WF_GRAPH_INVALID')
        }
        assertNoParentEndpoint(doc, source, target, 'connect')
        // handle：缺省按流程通道补全。
        // 为什么不能沿用旧的 `?? ''` 兜底：'' 会写出 isFlowLine()=false 的**幽灵线**——
        // 该线在流程 DAG 中不存在，检查器随后报「启动节点没有流程出线 / 悬空节点」，
        // 把「handle 没写」误诊成「图缺线」，真因被完全掩盖。
        const sourceHandle = resolveHandle(String(opc.sourceHandle ?? '').trim() || 'flow-out', sourceNode.kind, 'out')
        const targetHandle = resolveHandle(String(opc.targetHandle ?? '').trim() || 'flow-in', targetNode.kind, 'in')
        const expectedTarget = pairingTargetOf(sourceHandle)
        if (targetHandle !== expectedTarget) {
          throw new WfError(`WF_GRAPH_INVALID: connect: ${sourceHandle} can only connect ${expectedTarget} (received ${targetHandle})`, 'WF_GRAPH_INVALID')
        }
        // condition：必须显式带 type，否则条件线会**静默**退化成普通流程线（成对校验随之失效）。
        // 放在「重复连线」之前：参数层错误优先于图状态错误，报错才指向模型真正该改的地方。
        const rawCondition = opc.condition
        let conditionType = ''
        let conditionLabel: string | undefined
        if (rawCondition !== undefined && rawCondition !== null) {
          if (typeof rawCondition === 'string') {
            conditionType = rawCondition.trim()
          } else if (typeof rawCondition === 'object' && !Array.isArray(rawCondition)) {
            const box = rawCondition as { type?: unknown; label?: unknown }
            conditionType = String(box.type ?? '').trim()
            if (box.label !== undefined && box.label !== null) conditionLabel = String(box.label)
          }
          if (!CONDITION_TYPES.includes(conditionType as (typeof CONDITION_TYPES)[number])) {
            badArgs(
              `connect: condition.type must be ${CONDITION_TYPES.join('/')} (received ${JSON.stringify(conditionType)}); `
              + `omitting type silently degrades a condition line into a plain flow line; correct shape: ${OP_FIELD_SHAPES.connect}`,
            )
          }
          if (conditionType === 'content' && !conditionLabel) {
            badArgs(`connect: condition.type='content' requires a label (the condition text); correct shape: ${OP_FIELD_SHAPES.connect}`)
          }
        }
        if (doc.lines.some((line) => line.source === source && line.target === target
          && line.sourceHandle === sourceHandle && line.targetHandle === targetHandle)) {
          throw new WfError('WF_GRAPH_INVALID: connect: this line already exists (duplicate line)', 'WF_GRAPH_INVALID')
        }
        const lineId = makeLineId()
        doc.lines.push({
          id: lineId,
          source,
          target,
          sourceHandle: sourceHandle as Line['sourceHandle'],
          targetHandle: targetHandle as Line['targetHandle'],
          ...(conditionType
            ? { condition: { type: conditionType as 'pass' | 'fail' | 'content', ...(conditionLabel ? { label: conditionLabel } : {}) } }
            : {}),
        })
        outcome.connectedLineIds.push(lineId)
        break
      }
      case 'disconnect': {
        const before = doc.lines.length
        // 父代理节点的连线同样不可由父代理自己断开（会改变它自己的执行模式）
        if (op.lineId) {
          const line = doc.lines.find((item) => item.id === op.lineId)
          if (line) assertNoParentEndpoint(doc, line.source, line.target, 'disconnect')
        } else if (op.key) {
          assertNoParentEndpoint(doc, op.key.source, op.key.target, 'disconnect')
        }
        // 先算出目标连线集再落账：失败（没有匹配连线）时不得改动 doc。
        let next: Line[]
        if (op.lineId) {
          next = doc.lines.filter((line) => line.id !== op.lineId)
        } else if (op.key) {
          const key = op.key
          next = doc.lines.filter((line) => !(line.source === key.source && line.target === key.target
            && line.sourceHandle === key.sourceHandle && line.targetHandle === key.targetHandle))
        } else {
          badArgs(`disconnect: lineId or key (all four endpoint fields) is required; correct shape: ${OP_FIELD_SHAPES.disconnect}`)
        }
        if (next.length === before) {
          throw new WfError('WF_GRAPH_INVALID: disconnect: no matching line found (lines come from the orchestration directive topology or the wf_org_catalog workflow skeleton)', 'WF_GRAPH_INVALID')
        }
        doc.lines = next
        break
      }
      case 'create_group': {
        const groupId = String(op.groupId ?? '').trim()
        if (!groupId) badArgs(`create_group: groupId is required; correct shape: ${OP_FIELD_SHAPES.create_group}`)
        if (doc.nodes.some((item) => item.id === groupId)) {
          throw new WfError(`WF_GRAPH_INVALID: create_group: node id already exists "${groupId}"`, 'WF_GRAPH_INVALID')
        }
        const withGroup = [...doc.nodes, {
          id: groupId,
          kind: 'group',
          position: { x: 0, y: 0 },
          data: {
            label: String(op.label ?? groupId),
            collabPrompt: String(op.collabPrompt ?? ''),
            memberIds: [],
            size: { w: 300, h: 220 },
          },
        } as GraphNode]
        // 成员校验可能抛错：先在临时数组上完成，成功后才写回 doc（原子性；见函数头）。
        doc.nodes = Array.isArray(op.memberIds) && op.memberIds.length > 0
          ? ensureGroupConsistency(withGroup, groupId, op.memberIds)
          : withGroup
        outcome.createdNodeIds.push(groupId)
        break
      }
      case 'set_group_members': {
        const groupId = String(op.groupId ?? '').trim()
        if (!groupId) badArgs(`set_group_members: groupId is required; correct shape: ${OP_FIELD_SHAPES.set_group_members}`)
        // 旧实现把缺失的 memberIds 兜底成 []，等于「悄悄清空全组成员」——破坏性默认值必须拒绝。
        if (!Array.isArray(op.memberIds)) {
          badArgs(`set_group_members: memberIds must be an array (pass [] explicitly to clear members); correct shape: ${OP_FIELD_SHAPES.set_group_members}`)
        }
        doc.nodes = ensureGroupConsistency(doc.nodes, groupId, op.memberIds)
        outcome.updatedNodeIds.push(groupId)
        break
      }
      default: {
        throw new WfError(`WF_GRAPH_INVALID: unknown graph op: ${String((op as { op?: unknown }).op)}`, 'WF_GRAPH_INVALID')
      }
    }
  }
}

/**
 * 应用图结构操作（按序，纯函数）：入参分毫不动，全部改动落在**一次**深拷贝出的副本上。
 * 失败一律抛 WfError（稳定 code），调用方据此返回带修复建议的补丁错误。
 */
export function applyGraphOps(input: {
  doc: WorkflowDocument
  ops: GraphPatchOp[]
}): GraphPatchResult {
  const doc = cloneDoc(input.doc)
  const outcome = emptyOpOutcome()
  const mode: 'mode1' | 'mode2' = doc.mode === 'mode2' ? 'mode2' : 'mode1'
  applyGraphOpsInPlace(doc, input.ops ?? [], mode, outcome)
  return { doc, ...outcome }
}

/**
 * 容错应用：逐条就地复用单 op 应用器，失败的 op 记入 errors 并跳过，其余操作继续。
 *
 * 为什么容错（而不是遇到第一条就停）：ops 之间存在有序依赖，父代理最常见的失败模式是
 * 一批里多条字段写错；一次只报一条会让它把同一批补丁反复重试，而失败清单一次列全后
 * 可以一轮改完。
 * 为什么只拷贝一次：本层要按 op 隔离失败，而隔离不需要第二份副本——单 op 应用器**原子**
 * （先校验后改动），失败时工作副本分毫未动，因此一次深拷贝即可，无需按 op 回滚或重拷贝；
 * 判定基础与逐条严格应用逐字节等价。
 * 为什么只捕获 WfError：非 WfError 属于工具自身的缺陷，不能被伪装成「某条 op 写错了」。
 * 语义前提：调用方在 errors 非空时**整批不落盘**，因此返回的结果仅供错误报告与后续 op
 * 的判定基础使用。
 */
export function applyGraphOpsTolerant(input: {
  doc: WorkflowDocument
  ops: GraphPatchOp[]
  /**
   * 预校验（角色引用展开）已判定失败的索引：不应用，也不产生 apply 层错误。
   * 用索引而不是过滤数组，是为了让错误项下标继续对应原批（一次列全、便于修正）。
   */
  skipped?: ReadonlySet<number>
}): { result: GraphPatchResult; errors: PatchOpFailure[] } {
  const errors: PatchOpFailure[] = []
  const outcome = emptyOpOutcome()
  const doc = cloneDoc(input.doc)
  const mode: 'mode1' | 'mode2' = doc.mode === 'mode2' ? 'mode2' : 'mode1'
  const ops = input.ops ?? []
  for (let index = 0; index < ops.length; index += 1) {
    if (input.skipped?.has(index)) continue
    const op = ops[index]
    try {
      applyGraphOpsInPlace(doc, [op], mode, outcome)
    } catch (error) {
      if (!(error instanceof WfError)) throw error
      errors.push({
        index,
        op: String((op as { op?: unknown })?.op ?? ''),
        code: String(error.code ?? ''),
        message: error.message,
      })
    }
  }
  return { result: { doc, ...outcome }, errors }
}
