// Host + Client 共享契约（纯类型，零运行时 import）。
//
// 本文件定义运行快照（RunSnapshot）、服务状态（ServiceState）、模板（Role/File/
// Database/Group）、工具组合（ToolCombo）、导入导出 v2 bundle（BundleV2）、
// userId→sessionId 映射（UserIdMap）与断点回填用的节点输出记录（NodeOutputRecord）。
//
// 约束（架构文档 §2.3 / SKILL.md §6.3）：
//   - **零运行时 import**：client 半区经 type-only import 零风险引用本层结构，不得
//     引入任何运行时值（避免 double tsconfig 的 Context augmentation 相互污染）。
//     跨文件的类型复用（如 ServiceState.nodes: GraphNode[]）使用 `import type`
//     （纯类型引用，编译期被完全擦除，不产生任何运行时依赖）。
//   - 结构逐字对齐架构文档 AD-001 §6.1~§6.4。
//   - 每个字段以中文 JSDoc 说明业务语义，并引用需求条款号（PRD §4.x.y）。

import type { GraphNode, Line, WorkflowTemplate } from './graph-model.js'

// ---------------------------------------------------------------------------
// run 快照（runs/<runId>.json，架构文档 §6.1）
// ---------------------------------------------------------------------------

/** run 运行状态：运行/暂停/完成/失败/停止/中断（架构文档 §4.3 状态机 + §6.1）。 */
export type RunStatus =
  | 'running' // 运行中
  | 'paused' // 已暂停（暂停门触发，保留运行锁，需求文档 §4.7 规则 4）
  | 'completed' // 已完成
  | 'failed' // 失败
  | 'stopped' // 已停止（用户主动停止）
  | 'interrupted' // 已中断（宿主重启导致，可恢复，需求文档 §4.7 规则 5）

/** 单节点运行状态（架构文档 §6.1 nodes[].status）。 */
export type NodeRunStatus =
  | 'pending' // 待执行
  | 'running' // 执行中
  | 'ok' // 成功（产出可回填）
  | 'fail' // 失败
  | 'skipped' // 已跳过
  | 'react-capped' // ReAct 软截停（非失败，正常收尾产出，架构文档 §4.4 护栏）

/**
 * 运行快照：一次 run 的完整持久化状态（架构文档 §6.1 逐字段）。
 * 断点续跑：每次续跑生成一条新 run 记录，节点快照=全量节点，已 ok 节点状态继承
 * 自旧 run 并标记来源，经 resumedFromRunId 追溯继承链（需求文档 §4.7 规则 2）。
 */
export interface RunSnapshot {
  /** run 稳定标识（runId）。 */
  id: string
  /** 关联工作流 id（flowId）。 */
  flowId: string
  /** 工作流名称（历史面板展示用）。 */
  flowName: string
  /** 归属会话 id。 */
  sessionId: string
  /** 运行模式（mode1 编排执行 / mode2 后台服务）。 */
  mode: 'mode1' | 'mode2'
  /** 运行状态。 */
  status: RunStatus
  /** 开始时间（ISO 字符串）。 */
  startedAt: string
  /** 结束时间（ISO 字符串，未结束时为 null）。 */
  endedAt: string | null
  /** 运行摘要文本（最终汇总/失败原因提示）。 */
  summary: string
  /** 断点续跑：继承的旧 run id（新 run 记录继承链，需求文档 §4.7 规则 2）。 */
  resumedFromRunId?: string
  /** 断点续跑：从哪个节点恢复（暂停节点 id，需求文档 §4.7 规则 3）。 */
  resumeFromNodeId?: string
  /** 节点执行记录列表（全量节点，含已 ok 节点继承标记）。 */
  nodes: Array<{
    /** 节点 id。 */
    nodeId: string
    /** 该节点当前执行状态。 */
    status: NodeRunStatus
    /** 尝试次数（回流重试计数，需求文档 §4.2.3.2 规则 3）。 */
    attempts: number
    /** 节点开始时间（ISO 字符串或 null）。 */
    startedAt: string | null
    /** 节点结束时间（ISO 字符串或 null）。 */
    endedAt: string | null
    /** 节点完整输出（默认上限 100KB，用于断点/上下文传递，需求文档 §4.7 规则 7）。 */
    output: string
    /** 输出摘要（显示截断，默认 6000 字，需求文档 §4.7 规则 7）。 */
    outputSummary: string
    /** 是否继承自旧 run（断点恢复，已 ok 节点不重跑，需求文档 §4.7 规则 6）。 */
    resumed?: boolean
  }>
}

// ---------------------------------------------------------------------------
// 服务（services/<serviceId>.json，架构文档 §6.2）
// ---------------------------------------------------------------------------

/** 服务进程状态：停止/运行中/崩溃（架构文档 §6.2；需求文档 §4.1.3）。 */
export type ServiceStatus = 'stopped' | 'running' | 'crashed'

/**
 * 服务状态（模式二工作流实例 + 端口/鉴权/进程状态，架构文档 §6.2 逐字段）。
 * 一个服务 = 一个模式二工作流 + 一个常驻子进程 + 一个 REST API 端口（术语 §2）。
 */
export interface ServiceState {
  /** 服务稳定标识（serviceId）。 */
  id: string
  /** 归属会话 id。 */
  sessionId: string
  /** 服务名称。 */
  name: string
  /** 服务描述。 */
  description: string
  /** 修订版本号。 */
  revision: number
  /** 节点列表（工作流定义，判别联合引用 graph-model）。 */
  nodes: GraphNode[]
  /** 连线列表（工作流定义）。 */
  lines: Line[]
  /** 创建时间（ISO 字符串）。 */
  createdAt: string
  /** 最近更新时间（ISO 字符串）。 */
  updatedAt: string
  /** 服务进程状态（崩溃标记可重启，需求文档 §4.1.3 规则 3）。 */
  status: ServiceStatus
  /** 服务端口（端口池分配，基础 7860 起自动递增，需求文档 §4.1.3 规则 1）。 */
  port?: number
  /** API Key 哈希（鉴权配置，需求文档 §4.1.3 REST API 鉴权行）。 */
  apiKeyHash?: string
  /** 最近启动时间（ISO 字符串，可选）。 */
  lastStartedAt?: string
  /** 最近停止时间（ISO 字符串，可选）。 */
  lastStoppedAt?: string
}

// ---------------------------------------------------------------------------
// 模板（架构文档 §6.3）
// 模板与节点深拷贝解耦：拖入画布即深拷贝内联，模板修改不影响已生成节点（需求文档 §4.2.1）。
// ---------------------------------------------------------------------------

/**
 * 角色模板：父代理或子代理模板（架构文档 §6.3）。
 * 左侧栏「角色」Tab 的复用壳；拖入画布深拷贝为 RoleNode（与模板断引用）。
 */
export interface RoleTemplate {
  /** 模板稳定标识（roleId）。 */
  id: string
  /** 角色种类：父代理或子代理。 */
  kind: 'parent' | 'agent'
  /** 模板名称。 */
  name: string
  /** 系统提示词。 */
  systemPrompt: string
  /** 服务商。 */
  provider: string
  /** 模型。 */
  model: string
  /** 思考强度（可选）。 */
  reasoning?: string
  /** 官方预设 id（父代理仅 preset）。 */
  presetId?: string | null
  /** 回流重试次数上限。 */
  retryLimit: number
  /** ReAct 迭代次数上限（可选）。 */
  reactLimit?: number | null
  /** 输入结构描述（可选）。 */
  inputSchema?: string
  /** 输出结构描述（可选）。 */
  outputSchema?: string
  /** System Prompt 来源文件名（从 .md 加载时记录，左侧栏卡片展示用，需求文档 §4.2.3.1）。 */
  systemPromptSource?: string
  /** 官方系统提示词注入开关（默认 true）。 */
  injectSystemPrompt?: boolean
  /** 工具提示词（tool:* 散文段）注入开关（默认 true；false 仅移除 tool:* 段，保留 Code Mode 协议段与工具 Schema）。 */
  injectToolSections?: boolean
  /** 角色 Prompt 的宿主绝对路径（可选；设置后运行时从文件读取，文件指纹纳入签名）。 */
  promptFilePath?: string
}

/**
 * 文件模板（架构文档 §6.3）。
 * 非文本文件选择时复制到插件受管目录 data/files/（需求文档 §4.2.4.1 规则 2）。
 * 支持多选所有类型文件（files 列表，用户验收标注：已选文件列表显示在按钮下方）。
 */
export interface FileTemplate {
  /** 模板稳定标识。 */
  id: string
  /** 模板名称。 */
  name: string
  /** 文件类型。 */
  fileKind: 'text' | 'file'
  /** 文本内容（fileKind='text'）。 */
  content?: string
  /** 受管文件路径（fileKind='file' 单选时的兼容字段）。 */
  managedPath?: string
  /** 源文件名（fileKind='file' 左侧栏展示用，与 FileNode.data.fileName 对齐）。 */
  fileName?: string
  /** 多选文件列表（fileKind='file'；每项含受管路径与源文件名）。 */
  files?: Array<{ fileName: string; managedPath: string }>
}

/**
 * 数据库模板（架构文档 §6.3）。
 * 服务器类型提供结构化只读查询；本地类型提供内置向量检索（需求文档 §4.2.4.2）。
 */
export interface DatabaseTemplate {
  /** 模板稳定标识。 */
  id: string
  /** 模板名称。 */
  name: string
  /** 模板描述。 */
  description: string
  /** 类型：本地或服务器。 */
  dbType: 'local' | 'server'
  /** 数据库引擎。 */
  dbKind: 'sqlite' | 'mysql' | 'postgresql'
  /** 本地数据库文件路径。 */
  localPath?: string
  /** 服务器连接信息。 */
  conn?: { host: string; port: number; user: string; password: string; db: string }
  /** 向量检索模式。 */
  vectorSource?: 'embedding' | 'bm25'
}

/**
 * 工作流模板（架构文档 §6.3 扩展）：图2 交互改造后左侧「工作流模板」列表实体，
 * 与 WorkflowDocument 同构但**全局共享**（跨会话可见，无 sessionId 隔离；
 * 拖入画布 → 保存/「创建实例」→ 转为当前会话实例）。
 */
export type { WorkflowTemplate }

/**
 * 协作组模板（架构文档 §6.4 BundleV2.embedded.groups 引用）。
 * 架构文档 §6.3 未单独列出 GroupTemplate，此接口为架构文档 §6.4 嵌入式 groups
 * 的约束形状；协作 Prompt 追加到组内成员**首条用户消息（任务块）末尾**、不注入
 * 系统提示词，且无论文本是否为空都默认列出组内全部成员 ID + 角色名
 * （需求文档 §4.2.5.2 规则 2；架构文档 §13.1 第 4 条）。
 */
export interface GroupTemplate {
  /** 模板稳定标识。 */
  id: string
  /** 模板名称。 */
  name: string
  /** 协作 Prompt。 */
  collabPrompt: string
}

/**
 * 工具组合（架构文档 §6.3）：用户自定义工具勾选清单（可含 MCP 服务器）。
 * id 以 `combo-` 模板字面量前缀标识（需求文档 §4.6 规则 2）。
 */
export interface ToolCombo {
  /** 组合 id：`combo-` 前缀模板字面量类型（需求文档 §4.6 规则 2；术语 §2）。 */
  id: `combo-${string}`
  /** 组合名称。 */
  name: string
  /** 工具勾选清单（含可选注入的 dsh-vw 工具 wf_ask/wf_ask_agent，需求文档 §4.6 规则 6）。 */
  tools: string[]
  /** 所选 MCP 服务器 id 列表（工具以 mcp__<server>__* 前缀解析，需求文档 §4.6 规则 4）。 */
  mcpServers: string[]
}

// ---------------------------------------------------------------------------
// 导入导出 v2 bundle（架构文档 §6.4）
// ---------------------------------------------------------------------------

/**
 * 导入导出 v2 bundle（架构文档 §6.4 逐字段）。
 * 格式升级为 v2（含数据库节点/协作组/虚拟节点/双模式标记），不兼容旧文件
 * （需求文档 §9.1 导入导出行 / Q22）。
 */
export interface BundleV2 {
  /** 格式标识：固定 'dsh-vw-bundle'。 */
  format: 'dsh-vw-bundle'
  /** 版本：固定 2。 */
  version: 2
  /** 所属模式（导入时按模式落到 workflows/ 或 services/）。 */
  mode: 'mode1' | 'mode2'
  /** 工作流 payload（模式一导入导出；与 service 二选一）。 */
  workflow?: { name: string; description: string; nodes: GraphNode[]; lines: Line[] }
  /** 服务 payload（模式二导入导出；与 workflow 二选一）。 */
  service?: { name: string; description: string; nodes: GraphNode[]; lines: Line[] }
  /** 嵌入式资源（角色/文件/数据库/协作组模板与工具组合；导入时解耦创建模板）。 */
  embedded: {
    roles?: RoleTemplate[]
    files?: FileTemplate[]
    databases?: DatabaseTemplate[]
    groups?: GroupTemplate[]
    combos?: ToolCombo[]
  }
}

// ---------------------------------------------------------------------------
// userId → sessionId 映射（架构文档 §4.7 sessions-map.ts / §6 数据目录）
// ---------------------------------------------------------------------------

/**
 * userId→sessionId 映射记录（services/<serviceId>.sessions.json 持久化，
 * 需求文档 §4.1.3 规则 7 多租户隔离 + §4.7 sessions-map）。
 * 不同 userId 的会话与对话日志完全隔离；映射持久化于服务实例内，服务重启后有效。
 */
export interface UserIdMap {
  /** 持久化键：userId。 */
  userId: string
  /** 映射到的稳定 sessionId（同一 userId 稳定映射，需求文档 §4.1.3 规则 7）。 */
  sessionId: string
}

// ---------------------------------------------------------------------------
// 节点输出记录（断点回填用，架构文档 §6.1 nodes[] 的提取视图 / 需求文档 §4.7 规则 7）
// ---------------------------------------------------------------------------

/**
 * 节点输出记录：运行快照中单节点产出的独立视图，供断点续跑回填 ctx 连线上下文
 * （需求文档 §4.7 规则 6：已 ok 节点完整输出随断点重新可用，作为 ctx 连线注入后续节点）。
 * 与 RunSnapshot.nodes[i] 同源，抽取为独立接口便于 resume 任务（T-027）复用。
 */
export interface NodeOutputRecord {
  /** 节点 id。 */
  nodeId: string
  /** 节点执行状态（回填仅在 ok / react-capped 时注入产出）。 */
  status: NodeRunStatus
  /** 尝试次数。 */
  attempts: number
  /** 节点开始时间（ISO 字符串或 null）。 */
  startedAt: string | null
  /** 节点结束时间（ISO 字符串或 null）。 */
  endedAt: string | null
  /** 节点完整输出（用于断点回填/上下文传递）。 */
  output: string
  /** 输出摘要（界面展示截断）。 */
  outputSummary: string
  /** 是否继承自旧 run。 */
  resumed?: boolean
}
