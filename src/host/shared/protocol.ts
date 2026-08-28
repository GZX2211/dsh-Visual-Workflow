// Host + Client 共享协议常量与类型（protocol.ts）。
//
// 本文件集中定义 GUI API 端点名常量、wf_* 工具名常量、工具可见性元数据、
// 运行/节点状态枚举、模式枚举与颜色变量名常量——全部为纯字面量常量（as const），
// 供 host 半区（remote/api.ts、tools/*、orchestrator/*）与 client 半区（remote.ts、
// styles.ts、i18n.ts）共用，避免两端字符串漂移。
//
// 约束（架构文档 §2.3 / SKILL.md §6.3）：
//   - **零 import**：本文件不 import 任何模块（纯常量，无依赖）。
//   - 全部 `as const`，字面量值逐字对齐架构文档 AD-001 §4.5 / §4.6 与需求文档。
//   - 中文注释说明语义与依据（W-04）。

// ---------------------------------------------------------------------------
// GUI API 端点名常量（架构文档 §4.6 端点清单，逐字对齐）
// ---------------------------------------------------------------------------
// 端点挂载形态：POST /visual-workflow/<endpoint>，body { args }，响应 { ok, value/error }
// （架构文档 §4.6）。以下常量即 <endpoint> 段字符串，host remote/api.ts 与
// client lib/remote.ts 共用，保证前后端路径零漂移。

/** 工作流列表端点名。 */
export const EP_LIST_WORKFLOWS = 'listWorkflows'
/** 获取单个工作流。 */
export const EP_GET_WORKFLOW = 'getWorkflow'
/** 保存工作流（含创建工作流。按 §4.6 清单逐字列出）。 */
export const EP_PUT_WORKFLOW = 'putWorkflow'
/** 删除工作流。 */
export const EP_DELETE_WORKFLOW = 'deleteWorkflow'
/** 创建工作流（§4.6 清单逐字列出；与 putWorkflow 并存属于端点白名单）。 */
export const EP_CREATE_WORKFLOW = 'createWorkflow'

/** 服务列表端点名。 */
export const EP_LIST_SERVICES = 'listServices'
/** 获取单个服务。 */
export const EP_GET_SERVICE = 'getService'
/** 保存服务。 */
export const EP_PUT_SERVICE = 'putService'
/** 删除服务。 */
export const EP_DELETE_SERVICE = 'deleteService'
/** 启动服务（模式二 fork 子进程）。 */
export const EP_SERVICE_START = 'serviceStart'
/** 停止服务。 */
export const EP_SERVICE_STOP = 'serviceStop'
/** 查询服务状态。 */
export const EP_SERVICE_STATUS = 'serviceStatus'
/**
 * 服务调试流式端点名（服务控制台调试框：代理运行中服务的 /v1/chat/completions，
 * SSE 逐块转发回浏览器打字机渲染）。
 * 为什么走 Host 代理而非浏览器直连：服务进程无 CORS 头，同源代理避免跨域失败；
 * apiKey 鉴权由 Host 侧配置持有，不落浏览器。
 */
export const EP_SERVICE_DEBUG = 'serviceDebug'

/** 模板列表端点名（角色/文件/数据库三类共用）。 */
export const EP_LIST_TEMPLATES = 'listTemplates'
/** 保存模板。 */
export const EP_PUT_TEMPLATE = 'putTemplate'
/** 删除模板。 */
export const EP_DELETE_TEMPLATE = 'deleteTemplate'
/** 工作流模板列表端点名（图2 交互改造：工作流模板全局共享，跨会话可见）。 */
export const EP_LIST_FLOW_TEMPLATES = 'listFlowTemplates'
/** 保存工作流模板（新建/更新统一；模板全局共享，不按会话隔离）。 */
export const EP_PUT_FLOW_TEMPLATE = 'putFlowTemplate'
/** 删除工作流模板。 */
export const EP_DELETE_FLOW_TEMPLATE = 'deleteFlowTemplate'
/** 删除模板预览（角色/文件/数据库）。 */
export const EP_DELETE_TEMPLATE_PREVIEW = 'deleteTemplatePreview'
/** 受管文件上传端点名（非文本文件：base64 内容 → data/files/ 受管拷贝，§4.2.4.1 规则 2）。 */
export const EP_FILE_UPLOAD = 'fileUpload'

/** 官方预设列表端点名。 */
export const EP_PRESETS = 'presets'
/** 工具目录列表端点名（组合管理工具勾选清单用）。 */
export const EP_TOOLS = 'tools'
/** 模型列表端点名（思考强度列表来自适配器公布的 reasoning efforts）。 */
export const EP_MODELS = 'models'

/** 工具组合列表端点名。 */
export const EP_TOOL_COMBOS = 'toolCombos'
/** 保存工具组合。 */
export const EP_TOOL_COMBO_PUT = 'toolComboPut'
/** 删除工具组合。 */
export const EP_TOOL_COMBO_DELETE = 'toolComboDelete'
/** 插件目录列表端点名（组合管理用）。 */
export const EP_PLUGIN_CATALOG = 'pluginCatalog'
/** MCP 服务器列表端点名。 */
export const EP_MCP_LIST = 'mcpList'
/** 保存 MCP 服务器。 */
export const EP_MCP_PUT = 'mcpPut'
/** 删除 MCP 服务器。 */
export const EP_MCP_DELETE = 'mcpDelete'
/** 切换 MCP 服务器启用状态。 */
export const EP_MCP_TOGGLE = 'mcpToggle'

/** 运行启动端点名。 */
export const EP_RUN = 'run'
/** 运行状态轮询端点名。 */
export const EP_RUN_STATUS = 'runStatus'
/** 会话活跃 run 列表端点名（工作台进入时自动选中运行中实例用；running/paused 保留锁）。 */
export const EP_ACTIVE_RUNS = 'activeRuns'
/** 运行停止端点名。 */
export const EP_RUN_STOP = 'runStop'
/** 运行历史端点名。 */
export const EP_RUN_HISTORY = 'runHistory'
/** 断点续跑端点名。 */
export const EP_RUN_RESUME = 'runResume'

/** 数据库连接测试端点名。 */
export const EP_DB_TEST = 'dbTest'
/** 数据库表结构端点名。 */
export const EP_DB_SCHEMA = 'dbSchema'
/** 数据库检索预览端点名。 */
export const EP_DB_SEARCH_PREVIEW = 'dbSearchPreview'

/** 导出工作流端点名（v2 bundle）。 */
export const EP_EXPORT_WORKFLOW = 'exportWorkflow'
/** 导入工作流端点名（v2 bundle）。 */
export const EP_IMPORT_WORKFLOW = 'importWorkflow'
/** 导出角色模板端点名（v2 bundle）。 */
export const EP_EXPORT_AGENT_TEMPLATE = 'exportAgentTemplate'
/** 导入角色模板端点名（v2 bundle）。 */
export const EP_IMPORT_AGENT_TEMPLATE = 'importAgentTemplate'

// ---------------------------------------------------------------------------
// wf_* 工具名常量（架构文档 §4.5 工具表）
// ---------------------------------------------------------------------------

/** 启动节点子代理工具名（父代理；模式一编排执行：异步非阻塞启动，暂停门三语义）。 */
export const WF_RUN_NODE = 'wf_run_node'
/** 启动节点子代理工具名（父代理；模式二后台服务：阻塞等待节点完成，暂停门仍立即返回）。 */
export const WF_RUN_NODE_WAIT = 'wf_run_node_wait'
/** 幂等收尾工具名（父代理；释放运行锁）。 */
export const WF_FINISH = 'wf_finish'
/** 子代理向主会话用户提问工具名（官网提问卡，可选注入）。 */
export const WF_ASK = 'wf_ask'
/** Agent 间阻塞通信工具名（ask/reply/resolve 三态，可选注入）。 */
export const WF_ASK_AGENT = 'wf_ask_agent'
/** 单工具三模式数据访问工具名（search/query/schema，有 db-in 连线时注入）。 */
export const WF_DB_QUERY = 'wf_db_query'

// ---------------------------------------------------------------------------
// 工具可见性元数据（架构文档 §4.5 工具可见性表 + 需求文档 §4.4.2 规则 7）
// ---------------------------------------------------------------------------
// 说明：以下 as const 常量表描述三类工具集的静态划分，供 host 半区
// resolveAgentTools()（T-022）与 tools.restrict 显式隐藏（双保险）引用，也供
// client 组合管理（T-048）判定哪些 wf_* 工具可勾选（可选注入集）。

/** 父代理（主会话 Agent）可见工具集：wf_run_node / wf_run_node_wait、wf_finish、wf_ask_agent。 */
export const PARENT_AGENT_VISIBLE_TOOLS = [
  WF_RUN_NODE,
  WF_RUN_NODE_WAIT,
  WF_FINISH,
  WF_ASK_AGENT, // resolve 裁决能力内聚于父代理（架构文档 §4.5）
] as const

/** 子代理永久隐藏工具集（经 tools.restrict 显式隐藏，双保险）：wf_run_node / wf_run_node_wait、wf_finish。 */
export const CHILD_AGENT_HIDDEN_TOOLS = [WF_RUN_NODE, WF_RUN_NODE_WAIT, WF_FINISH] as const

/**
 * 官方保留的 Code Mode presentation transport 名（run_code）：
 *  - 官方 core/tools 在非 native 模式为每个 scope 自动注入（子代理本就自带，无需勾选）；
 *  - tools.restrict 的 allow/deny 名单禁止出现该名（官方校验抛错，见 @repo packages/core/tools/src/index.ts L1085）；
 *  - 因此组合管理可选列表必须剔除、resolveAgentTools 的 allow 名单必须剔除（双保险）。
 */
export const RESERVED_TRANSPORT_TOOL = 'run_code'

/**
 * 可选注入工具集（默认不注入任何代理，仅勾选/存在连线时按需进入子代理工具集）。
 *  - wf_ask：组合/白名单勾选时注入（需求文档 §4.6 规则 6）
 *  - wf_ask_agent：组合/白名单勾选时注入（协作组内通信，需求文档 §4.4.1 规则 5）
 *  - wf_db_query：存在数据库连线（db-in）时按连线自动注入（需求文档 §4.4.3 规则 5）
 */
export const OPTIONAL_INJECT_TOOLS = [WF_ASK, WF_ASK_AGENT, WF_DB_QUERY] as const

/**
 * 工具可见性元数据总表：以「工具名 → 可见性描述」的统一视图汇总 §4.5 规则，
 * 供测试做关键规则断言与消费侧做静态判定（as const，零运行时 import）。
 */
export const TOOL_VISIBILITY = {
  /** 父代理可见集（wf_run_node / wf_run_node_wait / wf_finish / wf_ask_agent(resolve) + 有 db-in 时的 wf_db_query）。 */
  parentVisible: PARENT_AGENT_VISIBLE_TOOLS,
  /** 子代理永久隐藏集（wf_run_node / wf_run_node_wait / wf_finish）。 */
  childHidden: CHILD_AGENT_HIDDEN_TOOLS,
  /** 可选注入集（wf_ask / wf_ask_agent / wf_db_query）。 */
  optionalInject: OPTIONAL_INJECT_TOOLS,
} as const

// ---------------------------------------------------------------------------
// 运行状态 / 节点状态 / 模式枚举（架构文档 §4.3 状态机 + §6.1）
// ---------------------------------------------------------------------------

/**
 * 运行状态枚举（RUN_STATUSES）：与 types.ts 的 RunStatus / 架构文档 §6.1
 * RunSnapshot.status 逐字一致（六态）。
 * running <-> paused -> completed / failed / stopped；宿主重启后
 * running/paused -> interrupted（可恢复）（架构文档 §4.3）。
 * 注意：pending 仅为**节点级**待执行状态（NODE_STATUSES，§6.1 nodes[].status），
 * 不作为 run 级持久化状态——run 快照创建即进入 running，不存在「排队/待启动」
 * 的持久化中间态（需求文档 §4.7 规则 3 断点数据字段同样不含 pending）。
 */
export const RUN_STATUSES = [
  'running', // 运行中
  'paused', // 已暂停（暂停门，保留锁）
  'completed', // 已完成
  'failed', // 失败
  'stopped', // 已停止
  'interrupted', // 已中断（宿主重启标记，可恢复）
] as const

/**
 * 节点状态枚举（NODE_STATUSES）：与架构文档 §6.1 RunSnapshot.nodes[].status 一致。
 * react-capped 为 ReAct 软截停（非失败，正常产出）。
 */
export const NODE_STATUSES = [
  'pending', // 待执行
  'running', // 执行中
  'ok', // 成功
  'fail', // 失败
  'skipped', // 已跳过
  'react-capped', // ReAct 软截停（非失败）
] as const

/** 模式枚举：mode1 编排执行 / mode2 后台服务（需求文档 §1 双模式架构）。 */
export const MODES = ['mode1', 'mode2'] as const

// ---------------------------------------------------------------------------
// 颜色变量名常量（架构文档 §10 样式 / 需求文档 §4.3 连线类型与颜色规范）
// ---------------------------------------------------------------------------
// 需求文档 §4.3 连线类型颜色对应 CSS 变量（深/浅色自适应），变量名供 host/client
// 共用（client styles.ts 定义变量，画布组件按连线类型引用变量名渲染）。

/** 流程连线颜色变量（冷灰/银白）。 */
export const COLOR_VAR_FLOW = '--wf-flow'
/** 上下文连线颜色变量（琥珀金）。 */
export const COLOR_VAR_CONTEXT = '--wf-context'
/** 数据库连线颜色变量（天蓝）。 */
export const COLOR_VAR_DATABASE = '--wf-database'
/** 条件通过颜色变量（翠绿）。 */
export const COLOR_VAR_PASS = '--wf-pass'
/** 条件不通过颜色变量（珊瑚红）。 */
export const COLOR_VAR_FAIL = '--wf-fail'
/** 条件内容颜色变量（紫罗兰）。 */
export const COLOR_VAR_CONTENT = '--wf-content'

/**
 * 连线颜色变量名列表（按需求文档 §4.3 连线类型顺序：流程/上下文/数据库/通过/不通过/内容）。
 * 供测试断言 6 个颜色变量齐全。
 */
export const COLOR_VARS = [
  COLOR_VAR_FLOW,
  COLOR_VAR_CONTEXT,
  COLOR_VAR_DATABASE,
  COLOR_VAR_PASS,
  COLOR_VAR_FAIL,
  COLOR_VAR_CONTENT,
] as const
