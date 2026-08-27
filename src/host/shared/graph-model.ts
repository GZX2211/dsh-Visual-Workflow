// 工作流图模型纯类型（shared 层）。
//
// 本文件是「节点/连线判别模型」的类型规范本体，逐字对齐架构文档 AD-001 §4.2
// 「graph/（工作流数据模型与校验）」代码块，并补充需求文档 PRD-001 §4.2（节点
// 管理模块）/ §4.3（连线管理模块）的业务语义说明。
//
// 约束（架构文档 §2.3 / SKILL.md §6.3）：
//   - 本文件为 client 半区可零风险类型引用的纯类型层，**禁止任何 import**，
//     也不得定义运行时值（函数/对象常量一律不放这里，运行时校验归 T-013 的
//     src/host/graph/ 负责，本文件只约束「形状」）。
//   - 每个字段均以中文 JSDoc 说明业务语义，并引用需求条款号（PRD §4.x.y）。

// ---------------------------------------------------------------------------
// 节点判别联合（架构文档 §4.2 代码块 + 需求文档 §4.2）
// ---------------------------------------------------------------------------

/** 节点种类：9 种判别的稳定字面量（架构文档 §4.2；需求文档 §4.2.3~§4.2.5）。 */
export type NodeKind =
  | 'parent' // 父代理节点：调度中枢与最终汇总者（需求文档 §4.2.3.1）
  | 'agent' // 子代理节点：任务执行单元（需求文档 §4.2.3.2）
  | 'file' // 文件节点：文本/受管文件数据源（需求文档 §4.2.4.1）
  | 'database' // 数据库节点：本地/服务器数据源（需求文档 §4.2.4.2）
  | 'start' // 启动阶段节点（模式一入口，需求文档 §4.2.5.1）
  | 'end' // 结束阶段节点（模式一出口，需求文档 §4.2.5.1）
  | 'pause' // 暂停阶段节点（流程门，需求文档 §4.2.5.1）
  | 'group' // 协作组节点：组卡片 + 组内角色并行（需求文档 §4.2.5.2）
  | 'proxy' // 虚拟节点：主节点别名引用，无独立配置（需求文档 §4.2.3.2 规则 4/7）

/** 节点公共基座：所有节点的共有最小字段（架构文档 §4.2 代码块）。 */
export interface BaseNode {
  /** 节点稳定标识（画布内唯一；运行期以 sessionId:flowId:nodeId 复用子代理，§4.2.3.2 规则 3）。 */
  id: string
  /** 节点种类，判别联合的判据。 */
  kind: NodeKind
  /** 画布栅格坐标（仅视图用途，不参与执行语义）。 */
  position: { x: number; y: number }
}

/**
 * 角色节点：父代理（kind='parent'）与子代理（kind='agent'）共用的数据形状。
 * 架构文档 §4.2 代码块将二者合一为 RoleNode 判别（kind 收窄为 'parent' | 'agent'）。
 * 对应需求文档 §4.2.3.1（父代理）与 §4.2.3.2（子代理）。
 */
export interface RoleNode extends BaseNode {
  kind: 'parent' | 'agent'
  data: {
    /** 名称（左侧栏截断展示；见需求文档 §4.2.3.1 卡片设计）。 */
    label: string
    /** 系统提示词：场景独立生效，不继承父/子任何一方（需求文档 §4.2.3.2 规则 1）。 */
    systemPrompt: string
    /** 服务商（模型提供方，经宿主适配器解析）。 */
    provider: string
    /** 模型标识（如 deepseek-chat 等）。 */
    model: string
    /** 思考强度（可选；取值域以官方适配器公布的 reasoning efforts 为准，需求文档 §开放问题 V-02）。 */
    reasoning?: string
    /** 官方 Agent 预设 id（父代理仅 preset；子代理 preset 或自定义组合，需求文档 §4.2.3.1 规则 4）。 */
    presetId?: string | null
    /** 回流重试次数上限（节点级尝试计数护栏，需求文档 §4.2.3.2 规则 3）。 */
    retryLimit: number
    /** ReAct 迭代次数上限（软截停语义；null 表示不设限，需求文档 §4.2.3.2 规则 3 / V-01）。 */
    reactLimit?: number | null
    /** 输入结构描述（模型理解占位，不强校验，需求文档 §4.2.3.2 规则 3 注 Q18）。 */
    inputSchema?: string
    /** 输出结构描述（同上，占位不强校验）。 */
    outputSchema?: string
    /** System Prompt 来源文件名（从 .md 加载时记录，左侧栏卡片展示用，需求文档 §4.2.3.1）。 */
    systemPromptSource?: string
    /**
     * 官方系统提示词注入开关（默认 true）。
     * true（开）= 官方 harness:identity / 人设 / 系统 / 上下文段正常注入；
     * false（关）= 仅保留角色 Prompt 段（visual-workflow:prompt）与 tool:* 段 + 工具 schema，
     *              清空官方系统提示词段（不再对官方段做任何插入/替换）。
     * 父/子代理节点均有此字段。
     */
    injectSystemPrompt?: boolean
    /**
     * 角色 Prompt 的宿主绝对路径（可选）。设置后运行时每次节点创建从该文件读取注入，
     * 文件指纹（mtime+size）纳入子代理签名：文件改动时签名变化 → 重建子代理 → 自动重载新内容；
     * 未改动时复用原子代理、不重复读取。为空则直接使用 systemPrompt 文本。
     */
    promptFilePath?: string
    /** 所属协作组 id（组内成员节点字段，需求文档 §4.2.5.2）。 */
    groupId?: string | null
    /** 虚拟节点引用主节点 id：仅 kind='proxy' 的虚拟节点携带（需求文档 §4.2.3.2 规则 4/7）。 */
    proxySourceId?: string | null
  }
}

/**
 * 文件节点：文本或受管文件的上下文数据源（需求文档 §4.2.4.1）。
 * 架构文档 §4.2 代码块为独立 FileNode 接口。
 */
export interface FileNode extends BaseNode {
  kind: 'file'
  data: {
    /** 名称（需求文档 §4.2.4.1 卡片设计：左侧栏/右侧属性栏均展示）。 */
    label: string
    /** 文件类型：文本内容直通，或受管文件（仅注入路径索引）。 */
    fileKind: 'text' | 'file'
    /** 文本内容（fileKind='text' 时直通；注入上限默认 20000 字，§4.2.4.1 规则 1）。 */
    content?: string
    /** 受管文件路径（fileKind='file' 单选时；复制进 data/files/ 避免源删除失效，§4.2.4.1 规则 2）。 */
    managedPath?: string
    /** 源文件名（非文本类型展示用）。 */
    fileName?: string
    /** 多选文件列表（fileKind='file'；每项含受管路径与源文件名，用户验收：支持多选所有类型文件）。 */
    files?: Array<{ fileName: string; managedPath: string }>
  }
}

/**
 * 数据库节点：本地/服务器数据库数据源（需求文档 §4.2.4.2）。
 * 内容绝不直接注入上下文，仅转换为检索/查询工具供代理调用（需求文档 §4.2.4.2 规则 4）。
 */
export interface DatabaseNode extends BaseNode {
  kind: 'database'
  data: {
    /** 名称（需求文档 §4.2.4.2 卡片设计）。 */
    label: string
    /** 描述（需求文档 §4.2.4.2 卡片设计）。 */
    description: string
    /** 类型：本地（SQLite + 内置向量检索）或服务器（结构化只读查询）。 */
    dbType: 'local' | 'server'
    /** 数据库引擎（服务器类型限定 MySQL / PostgreSQL，需求文档 §4.2.4.2 规则 2）。 */
    dbKind: 'sqlite' | 'mysql' | 'postgresql'
    /** 本地数据库文件路径（dbType='local' 时）。 */
    localPath?: string
    /** 服务器连接信息（dbType='server' 时）。 */
    conn?: { host: string; port: number; user: string; password: string; db: string }
    /** 向量检索模式：语义嵌入或 BM25 降级（本地类型，架构文档 §6.5；需求文档 §4.2.4.2 规则 1）。 */
    vectorSource?: 'embedding' | 'bm25'
  }
}

/**
 * 阶段节点：启动/结束/暂停三态（需求文档 §4.2.5.1）。
 * 架构文档 §4.2 代码块将三者合一为 StageNode（kind 收窄为 'start' | 'end' | 'pause'）。
 * 属性锁定不可编辑（仅 label 硬编码名称）。
 */
export interface StageNode extends BaseNode {
  kind: 'start' | 'end' | 'pause'
  data: { label: string }
}

/**
 * 协作组节点：组卡片 + 组内角色并行执行（需求文档 §4.2.5.2）。
 * 组内成员节点经 memberIds 关联；组卡片仅提供流程入/出连接点。
 */
export interface GroupNode extends BaseNode {
  kind: 'group'
  data: {
    /** 组名称（左侧栏/右侧属性栏展示）。 */
    label: string
    /** 协作 Prompt：追加注入到组内所有成员 System Prompt 末尾（需求文档 §4.2.5.2 规则 2）。 */
    collabPrompt: string
    /** 组内成员节点 id 列表（成员为角色节点，并行启动，规则 3）。 */
    memberIds: string[]
    /** 卡片尺寸（拉伸/滚动布局用，需求文档 §4.2.5.2 规则 8/9）。 */
    size?: { w: number; h: number }
  }
}

/**
 * 虚拟节点（ProxyNode）：主节点的别名引用，用于拓扑复用。
 * 无独立配置——运行时 wf_run_node 指向虚拟节点时解析为主节点 key，与主节点共享
 * 同一子代理执行实例与上下文（需求文档 §4.2.3.2 规则 4/6/7）。
 * 架构文档 §4.2 代码块中未单列 ProxyNode，此处为补充定义（数据模型将 proxySourceId
 * 承载于 RoleNode.data 以承载 role 型主节点的引用了；本判别联合以 kind='proxy'
 * 显式标识虚拟节点，避免与被引用的主节点 RoleNode 混淆）。
 */
export interface ProxyNode extends BaseNode {
  kind: 'proxy'
  /** 引用主节点的 id（虚拟节点不存储独立配置，仅此一个引用字段）。 */
  proxySourceId: string
}

/** 节点判别联合：按 kind 判别具体数据形状（架构文档 §4.2）。 */
export type GraphNode =
  | RoleNode
  | FileNode
  | DatabaseNode
  | StageNode
  | GroupNode
  | ProxyNode

// ---------------------------------------------------------------------------
// 连线模型（架构文档 §4.2 代码块 + 需求文档 §4.3）
// ---------------------------------------------------------------------------

/**
 * 连接点类型（Handle）：节点上的物理接线端，分方向属类（架构文档 §4.2 代码块）。
 *  - 入侧：flow-in（流程入）、ctx-in（上下文入）、db-in（数据库入）
 *  - 出侧：flow-out（流程出）、ctx-out（上下文出）、db-out（数据库出）
 * 语义对应需求文档 §4.2.3.1 连接点定义表（角色节点 5 连接点）。
 */
export type Handle =
  | 'flow-in' // 流程入：接收流程控制信号，触发节点执行
  | 'ctx-in' // 上下文入：接收上游节点传递的文本内容/文件索引
  | 'db-in' // 数据库入：接数据节点，转换为检索/查询工具（不注入上下文）
  | 'flow-out' // 流程出：发送流程控制信号给下游
  | 'ctx-out' // 上下文出：将最终输出注入下游（非记忆注入）
  | 'db-out' // 数据库出：注入数据库服务标识

/** 条件连线类型（需求文档 §4.3 连线类型表：通过/不通过/内容）。 */
export type ConditionType = 'pass' | 'fail' | 'content'

/**
 * 连线（Line）：两节点间有向线段（架构文档 §4.2 代码块）。
 * 条件连线仅适用于「流程出 → 流程入」（需求文档 §4.3 规则 4）；上下文/数据库连线无条件。
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
  /** 条件（可选）：仅流程线可带条件；条件判断由父代理语义判定（需求文档 §4.3 规则 3/4）。 */
  condition?: { type: ConditionType; label?: string }
}

// ---------------------------------------------------------------------------
// 工作流文档（实例定义：节点 + 连线，架构文档 §3 目录 / 需求文档 §4.2.2）
// ---------------------------------------------------------------------------

/** 运行模式：模式一编排执行、模式二后台服务（需求文档 §1 双模式架构）。 */
export type WorkflowMode = 'mode1' | 'mode2'

/**
 * 工作流文档（WorkflowDocument）：完整编排流程定义，关联画布所有节点与连线
 * （需求文档 §4.2.2 工作流实例定义）。
 * 「节点 JSON 即事实源」：nodes/lines 为全量内联快照，不含 templateId 引用
 * （需求文档 §4.2.1 数据模型核心规则）。
 */
export interface WorkflowDocument {
  /** 工作流稳定标识（flowId，会话内唯一；按 sessionId + flowId 维度隔离，需求文档 §4.2.2 规则 3）。 */
  id: string
  /** 归属会话 id（会话隔离存储，需求文档 §4.2.2 规则 3）。 */
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
  /** 修订版本号（可选，配合增量/缓存优化用，非必需）。 */
  revision?: number
  /** 创建时间（ISO 字符串）。 */
  createdAt?: string
  /** 最近更新时间（ISO 字符串）。 */
  updatedAt?: string
}
