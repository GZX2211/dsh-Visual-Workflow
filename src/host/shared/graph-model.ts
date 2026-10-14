// src/host/shared/graph-model.ts
//
// 工作流图模型纯类型（shared 层）。
//
// 本文件是「节点/连线判别模型」的类型规范本体，定义节点与连线的判别类型形状，
// 并补充业务语义说明。
//
// 约束：
//   - 本文件为 client 半区可零风险类型引用的纯形状层：**只允许 `import type`**
//     （编译期完全擦除），**禁止运行时 import，也不得定义运行时值**（函数/对象常量
//     一律不放这里，运行时校验与工厂归相关模块负责，本文件只约束「形状」）。
//   - 每个字段均以中文 JSDoc 说明业务语义。

import type { OrgMeta } from './org-meta.js'

// ---------------------------------------------------------------------------
// 节点判别联合
// ---------------------------------------------------------------------------

/** 节点种类：9 种判别的稳定字面量。 */
export type NodeKind =
  | 'parent' // 父代理节点：调度中枢与最终汇总者
  | 'agent' // 子代理节点：任务执行单元
  | 'file' // 文件节点：文本/受管文件数据源
  | 'database' // 数据库节点：本地/服务器数据源
  | 'start' // 启动阶段节点（模式一入口）
  | 'end' // 结束阶段节点（模式一出口）
  | 'pause' // 暂停阶段节点（流程门）
  | 'group' // Team 节点：Team 卡片 + 组内角色并行
  | 'proxy' // 虚拟节点：主节点别名引用，无独立配置

/** 节点公共基座：所有节点的共有最小字段。 */
export interface BaseNode {
  /** 节点稳定标识（画布内唯一；运行期以 sessionId:flowId:nodeId 复用子代理）。 */
  id: string
  /** 节点种类，判别联合的判据。 */
  kind: NodeKind
  /** 画布栅格坐标（仅视图用途，不参与执行语义）。 */
  position: { x: number; y: number }
}

/**
 * 角色节点：父代理（kind='parent'）与子代理（kind='agent'）共用的数据形状。
 * Kind 收窄为 'parent' | 'agent'，二者合一为 RoleNode 判别。
 * 父代理与子代理分别对应不同章节。
 */
export interface RoleNode extends BaseNode {
  kind: 'parent' | 'agent'
  data: {
    /** 名称（左侧栏截断展示）。 */
    label: string
    /** 系统提示词：场景独立生效，不继承父/子任何一方。 */
    systemPrompt: string
    /** 服务商（模型提供方，经宿主适配器解析）。 */
    provider: string
    /** 模型标识（如 deepseek-chat 等）。 */
    model: string
    /** 思考强度（可选；取值域以官方适配器公布的 reasoning efforts 为准）。 */
    reasoning?: string
    /** 官方 Agent 预设 id（父代理仅 preset；子代理 preset 或自定义组合）。 */
    presetId?: string | null
    /** 回流重试次数上限（节点级尝试计数护栏）。 */
    retryLimit: number
    /** ReAct 迭代次数上限（软截停语义；null 表示不设限）。 */
    reactLimit?: number | null
    /**
     * 输入契约（柔性文本，不强校验）：告诉子代理「应当收到什么输入」；空串即不配置（不注入）。
     */
    inputSchema?: string
    /**
     * 输出契约（柔性文本）：子代理最终回复必须按其组织；空串即不配置（不注入该段）。
     * 新建 agent 节点时默认落盘为 shared/protocol.ts 的 DEFAULT_OUTPUT_CONTRACT_TEXT。
     */
    outputSchema?: string
    /** System Prompt 来源文件名（从 .md 加载时记录，左侧栏卡片展示用）。 */
    systemPromptSource?: string
    /**
     * 官方系统提示词注入开关（默认 true；界面上是「人设段」开关）。
     * true（开）= 官方 harness:identity / 人设前缀（deployment:persona-prefix）/ 系统 / 上下文段正常注入；
     * false（关）= 仅保留角色 Prompt 段（visual-workflow:prompt）+ tool:* 散文段
     *              + Code Mode 协议段 + 工具 schema，清空其余全部官方**散文**段
     *              与 runtime context 快照（不再对官方段做任何插入/替换）。
     * 例外（恒保留，不受本开关管辖）：环境事实段 `deployment:persona-suffix`，
     * 即部署方配置的工作目录事实。
     * 设置角色 Prompt 时只替换 identity 与前缀；工作目录事实始终注入。
     * 父/子代理节点均有此字段。
     */
    injectSystemPrompt?: boolean
    /**
     * 工具提示词（tool:* 散文段）注入开关（默认 true）。
     * true（开）= 各工具包注册的使用指引段正常注入（tool:read / tool:write / tool:pwsh…）；
     * false（关）= 移除所有 tool:* 散文段，但**始终保留** Code Mode 协议段
     *              （tools:sdk / tools:ptc-only）与 tools[] 工具 Schema（模型仍能看到工具清单）。
     * 注意：与 injectSystemPrompt 独立；关闭它不改变工具能否被调用（调用能力由 Schema 决定，
     * 本开关只重写 assembly.sections，assembly.tools[] 原样透传）。
     * 对比：正菜单的「全局工具开关」会同时剔除 tools[] 条目与该工具的 tool:<name> 段，
     * 那才会真正剥夺调用能力。
     * 父/子代理节点均有此字段。
     */
    injectToolSections?: boolean
    /**
     * 角色 Prompt 的宿主绝对路径（可选）。设置后运行时每次节点创建从该文件读取注入，
     * 文件指纹（mtime+size）纳入子代理签名：文件改动时签名变化 → 重建子代理 → 自动重载新内容；
     * 未改动时复用原子代理、不重复读取。为空则直接使用 systemPrompt 文本。
     */
    promptFilePath?: string
    /** 所属 Team id（组内成员节点字段）。 */
    groupId?: string | null
    /**
     * 来源角色资产 id（可选；仅「从资产拖入画布」时写入，从模版/实例拖入不写）。
     * 用途：工作流资产保存时，据此把内联角色登记为**源资产的新版本**（内容已被改过时）
     * 或仅登记引用（内容与源版本全等时触发去重）。
     * 语义边界：这是「节点来源」事实，不参与执行；wf_graph_patch 不暴露该字段（保留现值）。
     */
    sourceAssetId?: string
  }
}

/**
 * 文件节点：文本或受管文件的上下文数据源。
 * 为独立 FileNode 接口。
 */
export interface FileNode extends BaseNode {
  kind: 'file'
  data: {
    /** 名称（左侧栏/右侧属性栏均展示）。 */
    label: string
    /** 文件类型：文本内容直通，或受管文件（仅注入路径索引）。 */
    fileKind: 'text' | 'file'
    /** 文本内容（fileKind='text' 时直通；注入上限默认 20000 字）。 */
    content?: string
    /** 受管文件路径（fileKind='file' 单选时；复制进 data/files/ 避免源删除失效）。 */
    managedPath?: string
    /** 源文件名（非文本类型展示用）。 */
    fileName?: string
    /** 多选文件列表（fileKind='file'；每项含受管路径与源文件名）。 */
    files?: Array<{ fileName: string; managedPath: string }>
  }
}

/**
 * 数据库节点：本地/服务器数据库数据源。
 * 内容绝不直接注入上下文，仅转换为检索/查询工具供代理调用。
 */
export interface DatabaseNode extends BaseNode {
  kind: 'database'
  data: {
    /** 名称（卡片设计）。 */
    label: string
    /** 描述（卡片设计）。 */
    description: string
    /** 类型：本地（SQLite + 内置向量检索）或服务器（结构化只读查询）。 */
    dbType: 'local' | 'server'
    /** 数据库引擎（服务器类型限定 MySQL / PostgreSQL）。 */
    dbKind: 'sqlite' | 'mysql' | 'postgresql'
    /** 本地数据库文件路径（dbType='local' 时）。 */
    localPath?: string
    /** 服务器连接信息（dbType='server' 时）。 */
    conn?: { host: string; port: number; user: string; password: string; db: string }
    /** 向量检索模式：语义嵌入或 BM25 降级（本地类型）。 */
    vectorSource?: 'embedding' | 'bm25'
    /**
     * 检索高级选项（UI 高级选项区可调；均有内置默认值，未配置时用默认）：
     * 召回条数 / 分块窗口 / 相似度阈值 / 索引构建行数上限。
     */
    vectorOptions?: {
      /** 召回条数（默认 5，search 内夹到 [1,50]）。 */
      topK?: number
      /** 分块窗口大小（字符，默认 384）。 */
      chunkSize?: number
      /** 分块重叠长度（字符，默认 128，须小于 chunkSize）。 */
      overlap?: number
      /** 召回相似度阈值（仅保留余弦/BM25 得分 > 此值；默认 0）。 */
      scoreThreshold?: number
      /** 索引构建行数上限（默认 10000）。 */
      maxRows?: number
    }
  }
}

/**
 * 阶段节点：启动/结束/暂停三态。
 * Kind 收窄为 'start' | 'end' | 'pause'，三者合一为 StageNode。
 * 属性锁定不可编辑（仅 label 硬编码名称）。
 */
export interface StageNode extends BaseNode {
  kind: 'start' | 'end' | 'pause'
  data: { label: string }
}

/**
 * Team 节点：Team 卡片 + 组内角色并行执行。
 * 组内成员节点经 memberIds 关联；Team 卡片仅提供流程入/出连接点。
 */
export interface GroupNode extends BaseNode {
  kind: 'group'
  data: {
    /** 组名称（左侧栏/右侧属性栏展示）。 */
    label: string
    /** 协作 Prompt：追加到组内所有成员**首条用户消息（任务块）末尾**，不注入系统提示词；无论文本是否为空都默认列出组内全部成员 ID + 角色名。 */
    collabPrompt: string
    /** 组内成员节点 id 列表（成员为角色节点，并行启动，规则 3）。 */
    memberIds: string[]
    /** 卡片尺寸（拉伸/滚动布局用）。 */
    size?: { w: number; h: number }
  }
}

/**
 * 虚拟节点（ProxyNode）：主节点的别名引用，用于拓扑复用。
 * 无独立配置——运行时 wf_run_node 指向虚拟节点时解析为主节点 key，与主节点共享
 * 同一子代理执行实例与上下文。
 * 引用主节点 id 由**节点接口顶层**的 proxySourceId 字段承载（非 data 内）；
 * 未单列 ProxyNode 接口，此处为补充定义，并以 kind='proxy'
 * 显式标识虚拟节点，避免与被引用的主节点 RoleNode 混淆。
 */
export interface ProxyNode extends BaseNode {
  kind: 'proxy'
  /** 引用主节点的 id（虚拟节点不存储独立配置，仅此一个引用字段）。 */
  proxySourceId: string
  /** 可选视图数据（仅画布展示，不参与运行判定）。 */
  data?: {
    /** 画布显示名（如「阶段复核」）。 */
    label?: string
  }
}

/**
 * 节点判别联合：按 kind 判别具体数据形状。
 * 注：元参数规模统计口径的「可执行单元节点种类」是跨层常量，
 * 本文件保持纯形状，不含运行时值。
 */
export type GraphNode =
  | RoleNode
  | FileNode
  | DatabaseNode
  | StageNode
  | GroupNode
  | ProxyNode

// ---------------------------------------------------------------------------
// 连线模型
// ---------------------------------------------------------------------------

/**
 * 连接点类型（Handle）：节点上的物理接线端，分方向属类。
 *  - 入侧：flow-in（流程入）、ctx-in（上下文入）、db-in（数据库入）
 *  - 出侧：flow-out（流程出）、ctx-out（上下文出）、db-out（数据库出）
 * 语义对应连接点定义表（角色节点 5 连接点）。
 */
export type Handle =
  | 'flow-in' // 流程入：接收流程控制信号，触发节点执行
  | 'ctx-in' // 上下文入：接收上游节点传递的文本内容/文件索引
  | 'db-in' // 数据库入：接数据节点，转换为检索/查询工具（不注入上下文）
  | 'flow-out' // 流程出：发送流程控制信号给下游
  | 'ctx-out' // 上下文出：将最终输出注入下游（非记忆注入）
  | 'db-out' // 数据库出：注入数据库服务标识

/** 条件连线类型：通过/不通过/内容。 */
export type ConditionType = 'pass' | 'fail' | 'content'

/**
 * 连线（Line）：两节点间有向线段。
 * 条件连线仅适用于「流程出 → 流程入」；上下文/数据库连线无条件。
 */
export interface Line {
  /** 连线稳定标识。 */
  id: string
  /** 源节点 id。 */
  source: string
  /** 目标节点 id。 */
  target: string
  /** 源侧连接点类型（Handle）。 */
  sourceHandle: Handle
  /** 目标侧连接点类型（Handle）。 */
  targetHandle: Handle
  /** 条件（可选）：仅流程线可带条件；条件判断由父代理语义判定。 */
  condition?: { type: ConditionType; label?: string }
}

// ---------------------------------------------------------------------------
// 工作流文档（实例定义：节点 + 连线）
// ---------------------------------------------------------------------------

/** 运行模式：模式一编排执行、模式二后台服务。 */
export type WorkflowMode = 'mode1' | 'mode2'

/**
 * 工作流模板（WorkflowTemplate）：图2 交互改造新增——左侧「工作流模板」列表的
 * 模板实体，与工作流实例同构（nodes/lines 全量内联），但**全局共享、跨会话可见**
 * （不按 sessionId 隔离），拖入画布保存后通过「创建实例」转为当前会话的实例。
 */
export interface WorkflowTemplate {
  /** 模板稳定标识（模板库内唯一）。 */
  id: string
  /** 运行模式（mode1 模板 / mode2 服务模板）。 */
  mode: WorkflowMode
  /** 模板名称（可编辑）。 */
  name: string
  /** 模板描述（可编辑）。 */
  description: string
  /** 节点列表（全量内联，判别联合）。 */
  nodes: GraphNode[]
  /** 连线列表（全量内联）。 */
  lines: Line[]
  /**
   * 【已退役，仅旧数据兼容】启动时是否开启新会话（不再写入/不再被运行逻辑消费）。
   * 新语义（工作台全局化改版）：「开启新会话」是「从模板创建实例」时的一次性
   * 临时选项——勾选后先新建主会话（官方 agents.create 无父根会话），实例绑定该
   * 新会话 id；运行只认实例绑定的会话。该选项不持久化到模板/实例文档。
   */
  startNewSession?: boolean
  /** 【已退役，仅旧数据兼容】新会话工作区（同上：创建时一次性消费，不落盘）。 */
  workspacePath?: string
  /** 修订版本号（可选，与实例保存对齐）。 */
  revision?: number
  /**
   * 元参数（可选）：父代理自主编排的可调节参数（三层之「模板层」）。
   * 全部可选、缺省即不约束；旧模板不含该字段，读到时按缺省处理（向后兼容）。
   */
  meta?: OrgMeta
  /** 最近一次父代理补丁记录（P4 画布「AI 调整」角标；用户保存经 stripClientMeta 清除）。 */
  lastPatch?: LastAgentPatch
  /** 创建时间（ISO 字符串）。 */
  createdAt?: string
  /** 最近更新时间（ISO 字符串）。 */
  updatedAt?: string
}

/**
 * 最近一次**父代理补丁**记录（P4 画布角标）：只记录 origin='agent' 的写图补丁——
 * 用户手动保存会经 `stripClientMeta` 清除本字段（用户改过的画布不再标注「AI 调整」）。
 */
export interface LastAgentPatch {
  /** 固定为 agent：该字段只描述代理改动；用户改动即清除。 */
  origin: 'agent'
  /** 补丁落盘时间（ISO 字符串）。 */
  at: string
  /** 本次补丁触碰的节点 id（新增/修改/删除的节点；画布据此显示角标）。 */
  nodeIds: string[]
}

/** 工作流文档（WorkflowDocument）：完整编排流程定义，关联画布所有节点与连线
 * 「节点 JSON 即事实源」：nodes/lines 为全量内联快照，不含 templateId 引用
 * （数据模型核心规则）。
 */
export interface WorkflowDocument {
  // 说明：meta 字段类型即 OrgMeta 本体（type-only 引用，编译期擦除）
  /** 工作流稳定标识（flowId，会话内唯一；按 sessionId + flowId 维度隔离）。 */
  id: string
  /** 归属会话 id（会话隔离存储）。 */
  sessionId: string
  /** 运行模式：强制二选一（mode1 编排执行 / mode2 后台服务）。 */
  mode: WorkflowMode
  /** 工作流名称（可编辑）。 */
  name: string
  /** 工作流描述（可编辑）。 */
  description: string
  /** 节点列表（全量内联，判别联合）。 */
  nodes: GraphNode[]
  /** 连线列表（全量内联）。 */
  lines: Line[]
  /**
   * 【已退役，仅旧数据兼容】启动时是否开启新会话（不再写入/不再被运行逻辑消费）。
   * 新语义（工作台全局化改版）：「开启新会话」是「从模板创建实例」时的一次性
   * 临时选项——勾选后先新建主会话（无父根会话），实例绑定该新会话 id；运行只认
   * 实例绑定的会话（run.sessionId === instance.sessionId 恒成立）。该选项不持久化。
   */
  startNewSession?: boolean
  /** 【已退役，仅旧数据兼容】新会话工作区（同上：创建时一次性消费，不落盘）。 */
  workspacePath?: string
  /** 修订版本号（可选，配合增量/缓存优化用，非必需）。 */
  revision?: number
  /**
   * 元参数（可选）：父代理自主编排的可调节参数（三层之「实例层」）。
   * 有效值 = 实例覆盖模板；startRun 时把有效值冻结进 run 快照（snapshot.meta）。
   */
  meta?: OrgMeta
  /** 最近一次父代理补丁记录（P4 画布「AI 调整」角标；用户保存经 stripClientMeta 清除）。 */
  lastPatch?: LastAgentPatch
  /** 创建时间（ISO 字符串）。 */
  createdAt?: string
  /** 最近更新时间（ISO 字符串）。 */
  updatedAt?: string
}
