// src/host/tools/wf-db-query/tool.ts
//
// wf_db_query 工具注册（单工具三模式：search / query / schema）。
//
// 需求语义（数据库节点）：
//   - 本地 SQLite：向量检索（内置嵌入，不可用降级 BM25 并标注）+ 结构化只读查询；
//   - 服务器 MySQL/PostgreSQL：同样支持向量检索（在本地构建向量/BM25 索引）；
//     叠加结构化只读查询 + 表结构；
//   - 数据库内容绝不直接注入上下文，仅经工具查询结果返回。
//
// 归属校验（运行态解耦改造）：主代理在运行中按运行上下文、不在运行中按**实例绑定
// 会话**定位实例（一个会话一个实例）；节点子代理仍必须是运行中工作流的节点，且该
// 节点经 db-in 连线接入目标数据节点（无连线拒绝——与「无连线不注入」可见性一致）。
// SQL 只读白名单在 policy.ts；驱动在 driver.ts；索引构建在 service.ts。
//
// 提示词规范：description 官方标准英文（何时调用/前置条件/失败语义/副作用）。

import { WF_DB_QUERY } from '../../shared/protocol.js'
import type { DatabaseNode, RoleNode, WorkflowDocument } from '../../shared/graph-model.js'
import { dbInEdges } from '../../graph/index.js'
import { WfError, type CallerInfo, type OrchestratorRuntime, type RunEntry } from '../../orchestrator/index.js'
import { SEARCH_TOP_K_MAX, VectorIndex } from '../../embedding/indexer.js'
import { callerOf } from '../infrastructure/caller.js'
import { defineTool, type ToolDefinitionLike, type ToolExecLike } from '../infrastructure/define-tool.js'
import { textRender } from '../infrastructure/text-render.js'
import { createDatabaseDriver } from './driver.js'
import { sanitizeReadOnlySql } from './policy.js'
import { buildIndexForDatabase, INDEX_MAX_ROWS, indexPathOf } from './service.js'
import type { WfDbQueryHost } from './types.js'

/** 查询结果行数上限（防结果集打爆上下文）。 */
const QUERY_ROWS_LIMIT = 50

/** 查询结果单元格值最大长度（超长截断防止向量/BLOB 列打爆上下文；追加标记）。 */
export const QUERY_CELL_MAX_LENGTH = 240

/** 单元格截断标记。 */
const CELL_TRUNCATED_MARK = '…'

/** 对单元格值做长度截断（超长时截断并追加标记；返回是否发生了截断）。 */
function capQueryCell(value: string): { text: string; truncated: boolean } {
  if (value.length <= QUERY_CELL_MAX_LENGTH) return { text: value, truncated: false }
  return { text: `${value.slice(0, QUERY_CELL_MAX_LENGTH)}${CELL_TRUNCATED_MARK}`, truncated: true }
}

/** 运行中 run 的定位（root 按会话 / 子代理按 childIndex 反查）。 */
function resolveActiveRun(
  orchestrator: OrchestratorRuntime,
  caller: CallerInfo,
  exec: ToolExecLike,
): { run: NonNullable<ReturnType<OrchestratorRuntime['activeRunForSession']>>; callerNodeId: string } {
  if (caller.isChild) {
    const childId = String((exec.agent as { id?: unknown } | null | undefined)?.id ?? '')
    const meta = childId ? orchestrator.childMetaFor(childId) : null
    if (!meta) throw new WfError('WF_NO_ACTIVE_RUN: the caller does not belong to any running workflow', 'WF_NO_ACTIVE_RUN')
    // 运行定位经运行时查询（childId 归属反查）：不再由工具层遍历运行表内部结构。
    const run = childId ? orchestrator.runForChild(childId) : null
    if (!run) throw new WfError('WF_STOPPED: the workflow has stopped; the database is not reachable', 'WF_STOPPED')
    return { run, callerNodeId: meta.nodeId }
  }
  const run = caller.sessionId ? orchestrator.activeRunForSession(caller.sessionId) : null
  if (!run) throw new WfError('WF_NO_ACTIVE_RUN: no running workflow orchestration in this session', 'WF_NO_ACTIVE_RUN')
  return { run, callerNodeId: '' }
}

/**
 * 数据查询上下文解析（运行态解耦改造，用户裁决）：
 *   - 有激活运行时：沿用 run 携带的 flowId/sessionId/mode 读取当前实例（行为不变）；
 *   - 无激活运行时（主代理直接在对话里问数据库）：按**实例绑定的会话**定位工作流实例
 *     （一个会话一个实例，取最新；`listWorkflows` 即按 updatedAt 倒序），不需要运行、
 *     不影响任何运行状态。子代理仍要求运行态（其节点身份与 db-in 校验都以 run 为前提）。
 * 前置条件：caller.sessionId 非空——不可识别的调用方在 execute 入口按 WF_BAD_CALLER 拒绝。
 */
async function resolveDataQueryContext(
  host: WfDbQueryHost,
  caller: CallerInfo,
  exec: ToolExecLike,
): Promise<{ flow: WorkflowDocument; callerNodeId: string; run: RunEntry | null }> {
  if (!caller.isChild) {
    const run = host.orchestrator.activeRunForSession(caller.sessionId)
    if (run) {
      const flow = await host.orchestrator.currentResolvedFlow(run)
      return { flow, callerNodeId: callerNodeIdOf(flow, caller, ''), run }
    }
    const instances = await host.store.listWorkflows(caller.sessionId)
    const flow = instances[0] ?? null
    if (!flow) throw new WfError('WF_NO_INSTANCE: this session has no workflow instance; create one on the workbench and connect a database node first', 'WF_NO_INSTANCE')
    return { flow, callerNodeId: callerNodeIdOf(flow, caller, ''), run: null }
  }
  const { run, callerNodeId } = resolveActiveRun(host.orchestrator, caller, exec)
  const flow = await host.orchestrator.currentResolvedFlow(run)
  return { flow, callerNodeId, run }
}

/** 定位调用者节点 id（root 调用时解析父代理节点；无父代理节点返回空）。 */
function callerNodeIdOf(flow: WorkflowDocument, caller: CallerInfo, childNodeId: string): string {
  if (caller.isChild) return childNodeId
  const parent = flow.nodes.find((node): node is RoleNode => node.kind === 'parent')
  return parent?.id ?? ''
}

/**
 * 注册 wf_db_query（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export function registerWfDbQuery(ctx: { get(name: string): unknown }, host: WfDbQueryHost): () => void {
  const tools = ctx.get('tools') as { register(def: ToolDefinitionLike): () => void } | null | undefined
  if (!tools || typeof tools.register !== 'function') {
    throw new Error('[visual-workflow] tools 服务不可用，无法注册 wf_db_query')
  }

  const definition = defineTool({
    name: WF_DB_QUERY,
    description:
      'Query a database node of the current workflow instance. Pick a mode — ' +
      '"search" (vector retrieval; falls back to BM25 when the embedding model is unavailable), ' +
      '"query" (read-only SELECT with a mandatory LIMIT; long cell values are truncated), or "schema" (table list). ' +
      'The first "search" on a database without a persisted index builds one inside this call ' +
      `(reads up to ${INDEX_MAX_ROWS} rows, embeds them and writes the index file) — it can take a while and is not cancellable; later searches reuse it. ` +
      'Available to the session main agent without a running orchestration; node children also require the node to be connected via a db-in edge. ' +
      'Prefer "search" for semantic questions; avoid "SELECT *" on tables with large vector columns.',
    parameters: {
      dataId: { type: 'string', required: true, description: 'Database node id from the flow definition file (nodes[].id).' },
      mode: { type: 'string', required: true, enum: ['search', 'query', 'schema'] as const, description: 'search: vector retrieval; query: read-only SELECT; schema: table list.' },
      query: { type: 'string', description: 'Free-text query for mode "search" (required there). The first search may build the index first (see the tool description).' },
      sql: { type: 'string', description: 'Read-only SQL (single SELECT with LIMIT) for mode "query" (required there).' },
      topK: { type: 'number', description: `Top hits for mode "search" (default 5, max ${SEARCH_TOP_K_MAX}).` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dataId: { type: 'string', required: true, description: 'The queried database node id.' },
          mode: { type: 'string', required: true, enum: ['search', 'query', 'schema'] as const, description: 'Echo of the requested mode.' },
          source: { type: 'string', description: '"embedding" or "bm25" (bm25 marks non-semantic retrieval).' },
          hits: {
            type: 'array',
            description: 'Search hits (mode "search"): index, text, score.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                index: { type: 'integer', required: true, description: 'Chunk index in the index file.' },
                text: { type: 'string', required: true, description: 'Chunk text.' },
                score: { type: 'number', required: true, description: 'Similarity score (higher is better).' },
                rowKey: { type: 'string', description: 'Primary key value of the source row (when known); lets you map the hit back to a full row.' },
              },
            },
          },
          columns: { type: 'array', items: { type: 'string' }, description: 'Result column names (mode "query").' },
          rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Result rows as string values (mode "query", rows and long cells capped).' },
          tables: {
            type: 'array',
            description: 'Table names (mode "schema").',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { name: { type: 'string', required: true, description: 'Table name.' } },
            },
          },
          truncated: { type: 'boolean', description: 'True when results were capped (rows, hits, or tables) or long cell values were truncated.' },
        },
      },
      render: textRender,
    },
    async execute(args, exec) {
      const caller = callerOf(exec)
      const sessionId = caller.sessionId
      if (!sessionId) throw new WfError('WF_BAD_CALLER: cannot identify the caller session', 'WF_BAD_CALLER')
      const dataId = String(args?.dataId ?? '').trim()
      if (!dataId) throw new WfError('WF_BAD_ARGS: wf_db_query requires dataId', 'WF_BAD_ARGS')
      const mode = String(args?.mode ?? '')
      if (mode !== 'search' && mode !== 'query' && mode !== 'schema') {
        throw new WfError(`WF_BAD_ARGS: wf_db_query mode must be search/query/schema (received ${mode})`, 'WF_BAD_ARGS')
      }

      // 归属校验（运行态解耦）：入口先校验会话身份（不可识别只报 WF_BAD_CALLER，同一事实一个码），
      // 再分派运行上下文 / 实例定位；子代理仍严格要求归属当前运行（节点身份 + db-in 双校验）。
      const { flow, callerNodeId, run } = await resolveDataQueryContext(host, caller, exec)
      const dataNode = flow.nodes.find((node): node is DatabaseNode => node.id === dataId && node.kind === 'database')
      if (!dataNode) throw new WfError(`WF_DB_BAD_DATA: database node not found or removed from the canvas: ${dataId}`, 'WF_DB_BAD_DATA')
      // 连线校验：调用者节点必须经 db-in 接入该数据节点。
      // 主代理无父代理节点（callerNodeId 为空）时跳过连线校验——主代理不在流程线上，
      // 「在画布中连接该数据库节点」即为其授权依据（用户裁决）；子代理恒有 callerNodeId，
      // 仍严格按 db-in 连线拒绝（无连线不注入工具、不可访问，与可见性一致）。
      const mustBeConnected = caller.isChild || callerNodeId !== ''
      if (mustBeConnected && !dbInEdges(flow, callerNodeId).some((line) => line.source === dataId)) {
        throw new WfError('WF_DB_NO_LINE: this node is not connected to that database node by a database edge', 'WF_DB_NO_LINE')
      }
      // 运行中才需刷新空闲基准（无运行时无 run 可触碰）
      if (run) host.orchestrator.touchRun(run)

      if (mode === 'search') {
        const queryText = String(args?.query ?? '').trim()
        if (!queryText) throw new WfError('WF_BAD_ARGS: wf_db_query mode=search requires query', 'WF_BAD_ARGS')
        const index = new VectorIndex(indexPathOf(host.dataDir, dataId))
        // 索引缺失/为空时惰性自动构建（等价 GUI 数据库面板「建立索引」，仅首次触发、
        // 落盘后复用）：运行期首次检索无需手动预建，嵌入不可用时自动落 BM25（结果标注）。
        let file = await index.load()
        if (!file || file.chunks.length === 0) {
          file = (await buildIndexForDatabase(host.dataDir, dataNode, host.engine)).file
        }
        const result = await index.search(
          queryText,
          Number(args?.topK) || Number(dataNode.data?.vectorOptions?.topK) || 5,
          host.engine,
          { threshold: Number(dataNode.data?.vectorOptions?.scoreThreshold) || 0 },
        )
        if (!result) throw new WfError('WF_DB_INDEX_MISSING: no searchable index for this database; confirm the source has indexable content', 'WF_DB_INDEX_MISSING')
        // 检索事实如实透传：source 表达通道（bm25 = 非语义降级），truncated 表达上限截断
        return { dataId, mode: 'search', source: result.source, hits: result.hits, ...(result.truncated ? { truncated: true } : {}) }
      }

      if (mode === 'query') {
        const sql = String(args?.sql ?? '')
        const checked = sanitizeReadOnlySql(sql)
        if (!checked.ok) throw new WfError(`WF_DB_SQL: SQL rejected: ${checked.error}`, 'WF_DB_SQL')
        const driver = createDatabaseDriver(dataNode)
        try {
          const result = await driver.query(checked.sql)
          const truncatedRows = result.rows.length > QUERY_ROWS_LIMIT
          const rows = result.rows.slice(0, QUERY_ROWS_LIMIT)
          // 单元格超长（如向量/BLOB 列）截断，防止巨量字符串打爆上下文
          let cellTruncated = false
          const cappedRows = rows.map((row) =>
            row.map((cell) => {
              const capped = capQueryCell(cell)
              if (capped.truncated) cellTruncated = true
              return capped.text
            }),
          )
          const truncated = truncatedRows || cellTruncated
          return { dataId, mode: 'query', columns: result.columns, rows: cappedRows, ...(truncated ? { truncated: true } : {}) }
        } finally {
          driver.close()
        }
      }

      // mode === 'schema'
      const driver = createDatabaseDriver(dataNode)
      try {
        // 驱动内部多取一行精确判定：正好满上限不算截断（与 search 的 truncated 判据同一口径）
        const { tables, truncated } = await driver.schemaPage()
        return { dataId, mode: 'schema', tables, ...(truncated ? { truncated: true } : {}) }
      } finally {
        driver.close()
      }
    },
  })

  const dispose = tools.register(definition)
  return () => {
    try {
      dispose()
    } catch {
      // 注销尽力而为
    }
  }
}
