// Host + Client 共享协议常量与类型（protocol.ts）。
//
// 本文件集中定义 GUI API 端点名常量、wf_* 工具名常量、工具可见性元数据、
// 运行/节点状态枚举、模式枚举、跨层口径常量与颜色变量名常量——全部为纯字面量常量
// （as const），供 host 半区（remote/api.ts、tools/*、orchestrator/*）与 client 半区
// （remote.ts、styles.ts、i18n.ts）共用，避免两端字符串漂移。
//
// 约束（见 ./AGENTS.md）：
//   - **禁止运行时 import**：本文件不得引入任何运行时依赖（纯常量模块）；
//     仅允许 `import type`（编译期完全擦除）用于给常量标注契约类型。
//   - 全部 `as const`，字面量值逐字对齐架构文档 AD-001 §4.5 / §4.6 与需求文档。
//   - 枚举/取值域必须与类型层（./types.js 与其契约本体）**双向穷尽**：任一侧增删取值
//     都要同步，并由测试以「类型 ⊆ 常量 ∧ 常量 ⊆ 类型」编译期断言锁定（禁止用固定
//     长度断言代替穷尽断言）。
//   - 中文注释说明语义与依据（W-04）。

import type { NodeKind } from './graph-model.js'

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

/**
 * 创建会话端点名（「开启新会话」一次性动作：从模板创建实例时先新建主会话，
 * 实例绑定该新会话 id——官方 agents.create 不传 parentSession 即无父根会话）。
 * 参数 { sessionId?, workspacePath?, label? }，返回 { sessionId }。
 */
export const EP_CREATE_SESSION = 'createSession'

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

/** 全局工具开关列表端点名（父代理工具白名单「关闭」侧；关闭后所有会话的代理上下文中不可见）。 */
export const EP_TOOL_SWITCHES = 'toolSwitches'
/** 设置单个工具开/关状态端点名（全局即时生效）。 */
export const EP_TOOL_SWITCH_PUT = 'toolSwitchPut'
/** 批量设置一组工具开/关状态端点名（组合管理「标签一键开关」用；全局即时生效）。 */
export const EP_TOOL_SWITCH_PUT_MANY = 'toolSwitchPutMany'

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
/** 父代理自主编排的只读勘察工具名（角色模板/组合/工具开关/preset/数据源/模板库 + 元参数预算）。 */
export const WF_ORG_CATALOG = 'wf_org_catalog'
/** 父代理自主编排的写图工具名（三分区：图结构 / 元参数 / 运行状态标记）。 */
export const WF_GRAPH_PATCH = 'wf_graph_patch'

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

/**
 * 子代理永久隐藏工具集（双保险：resolveAgentTools 的 allow 名单剔除 +
 * child scope `tools.restrict({ deny })` 显式隐藏，两处均直接引用本常量）：
 * wf_run_node / wf_run_node_wait / wf_finish（仅父代理可调度）+ wf_org_catalog /
 * wf_graph_patch（自主编排方案 §4：勘察与改图都是「父代理的组织权限」，子代理不得改图）。
 * 注意：全局工具开关（tool-switches）只影响「是否可见」，本集合是「永不进子代理」，
 * 两者正交——组合管理仍列出本集合工具（同一页面兼作全局开关面板），但永不随组合下发。
 */
export const CHILD_AGENT_HIDDEN_TOOLS = [
  WF_RUN_NODE,
  WF_RUN_NODE_WAIT,
  WF_FINISH,
  WF_ORG_CATALOG,
  WF_GRAPH_PATCH,
] as const

/**
 * 自主编排工具集（**默认开启**，与其他工具同口径；由用户在组合管理中按需关闭）：
 * 勘察/改图属「组织权限」，但**父代理专属**——子代理经 CHILD_AGENT_HIDDEN_TOOLS
 * 永久隐藏（resolveAgentTools 的 allow 剔除 + child scope tools.restrict 双保险），
 * 工具内另有调用者身份二次校验（WF_NOT_ROOT）。
 *
 * 历史（用户裁决 2026.09）：早期版本把本集合做成「默认关闭种子」
 * （ToolSwitchStore.DEFAULT_DISABLED_TOOLS），造成磁盘权威清单（用户项）与内存生效
 * 快照（用户项 ∪ 种子）两套状态并存——组合管理显示「已开启」而上下文里其实被隐藏。
 * 该种子已删除（默认关闭属方案错误），本常量保留为可见性元数据。
 */
export const ORG_AUTHORING_TOOLS = [WF_ORG_CATALOG, WF_GRAPH_PATCH] as const

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
  /** 子代理永久隐藏集（wf_run_node / wf_run_node_wait / wf_finish + 自主编排两工具）。 */
  childHidden: CHILD_AGENT_HIDDEN_TOOLS,
  /** 可选注入集（wf_ask / wf_ask_agent / wf_db_query）。 */
  optionalInject: OPTIONAL_INJECT_TOOLS,
  /** 自主编排工具集（wf_org_catalog / wf_graph_patch；默认开启、父代理专属，可经全局工具开关关闭）。 */
  orgAuthoring: ORG_AUTHORING_TOOLS,
} as const

// ---------------------------------------------------------------------------
// 运行状态 / 节点状态 / 模式枚举（架构文档 §4.3 状态机 + §6.1）
// ---------------------------------------------------------------------------

/**
 * 运行状态枚举（RUN_STATUSES）：与 ./run-types.js 的 RunStatus / 架构文档 §6.1
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
 * 节点状态枚举（NODE_STATUSES）：与 ./run-types.js 的 NodeRunStatus /
 * 架构文档 §6.1 RunSnapshot.nodes[].status 逐字一致（七态，含协作组「待命」armed——
 * 非终态：回合结束但仍在协作组内可被唤醒，父代理 wf_finish 后终态化，P0-1）。
 * react-capped 为 ReAct 软截停（非失败，正常产出）。
 * 与该类型的双向穷尽由测试的编译期断言锁定（禁止固定长度断言）。
 */
export const NODE_STATUSES = [
  'pending', // 待执行
  'running', // 执行中
  'armed', // 待命（协作组成员非终态）
  'ok', // 成功
  'fail', // 失败
  'skipped', // 已跳过
  'react-capped', // ReAct 软截停（非失败）
] as const

/** 模式枚举：mode1 编排执行 / mode2 后台服务（需求文档 §1 双模式架构）。 */
export const MODES = ['mode1', 'mode2'] as const

// ---------------------------------------------------------------------------
// 跨层口径常量（元参数规模统计口径；自主编排方案 §6.4）
// ---------------------------------------------------------------------------

/**
 * 可执行单元节点种类（元参数规模统计口径，自主编排方案 §6.4）：
 * 子代理（agent）、父代理（parent）与协作组卡片（group，组内成员并行执行为一单元）。
 * 为什么放在协议常量层而不是纯形状层：该口径是 Host 检查器 / 写图工具 / 客户端预算
 * 展示共用的跨层契约常量，改一处必须三端一致；纯形状文件不得含运行时值。
 * 口径漂移会直接导致预算判定与展示不一致，故以 NodeKind 标注类型并由测试锁定取值。
 */
export const EXECUTABLE_UNIT_KINDS: readonly NodeKind[] = ['agent', 'parent', 'group']

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

// ---------------------------------------------------------------------------
// 定时任务端点名常量（新功能：prompt/定时任务开发.md；host scheduler/ + client scheduler-ui）
// ---------------------------------------------------------------------------
// 说明：本功能独立于需求文档/架构文档（用户指令：新功能需求以 prompt/定时任务开发.md 为准，
// 不改写既有两份文档）。端点挂载形态与其余端点一致（POST /visual-workflow/<endpoint>）。

/** 定时任务列表端点名（含运行态合并视图）。 */
export const EP_SCHEDULER_TASKS = 'schedulerTasks'
/** 保存定时任务端点名（新建/更新统一）。 */
export const EP_SCHEDULER_TASK_PUT = 'schedulerTaskPut'
/** 删除定时任务端点名。 */
export const EP_SCHEDULER_TASK_DELETE = 'schedulerTaskDelete'
