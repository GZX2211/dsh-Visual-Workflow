import type { NodeKind } from './graph-model.js';
/** 工作流列表端点名。 */
export declare const EP_LIST_WORKFLOWS = "listWorkflows";
/** 获取单个工作流。 */
export declare const EP_GET_WORKFLOW = "getWorkflow";
/** 保存工作流（含创建工作流。按 §4.6 清单逐字列出）。 */
export declare const EP_PUT_WORKFLOW = "putWorkflow";
/** 删除工作流。 */
export declare const EP_DELETE_WORKFLOW = "deleteWorkflow";
/** 创建工作流（§4.6 清单逐字列出；与 putWorkflow 并存属于端点白名单）。 */
export declare const EP_CREATE_WORKFLOW = "createWorkflow";
/** 服务列表端点名。 */
export declare const EP_LIST_SERVICES = "listServices";
/** 获取单个服务。 */
export declare const EP_GET_SERVICE = "getService";
/** 保存服务。 */
export declare const EP_PUT_SERVICE = "putService";
/** 删除服务。 */
export declare const EP_DELETE_SERVICE = "deleteService";
/** 启动服务（模式二 fork 子进程）。 */
export declare const EP_SERVICE_START = "serviceStart";
/** 停止服务。 */
export declare const EP_SERVICE_STOP = "serviceStop";
/** 查询服务状态。 */
export declare const EP_SERVICE_STATUS = "serviceStatus";
/**
 * 服务调试流式端点名（服务控制台调试框：代理运行中服务的 /v1/chat/completions，
 * SSE 逐块转发回浏览器打字机渲染）。
 * 为什么走 Host 代理而非浏览器直连：服务进程无 CORS 头，同源代理避免跨域失败；
 * apiKey 鉴权由 Host 侧配置持有，不落浏览器。
 */
export declare const EP_SERVICE_DEBUG = "serviceDebug";
/**
 * 创建会话端点名（「开启新会话」一次性动作：从模板创建实例时先新建主会话，
 * 实例绑定该新会话 id——官方 agents.create 不传 parentSession 即无父根会话）。
 * 参数 { sessionId?, workspacePath?, label? }，返回 { sessionId }。
 */
export declare const EP_CREATE_SESSION = "createSession";
/** 模板列表端点名（角色/文件/数据库三类共用）。 */
export declare const EP_LIST_TEMPLATES = "listTemplates";
/** 保存模板。 */
export declare const EP_PUT_TEMPLATE = "putTemplate";
/** 删除模板。 */
export declare const EP_DELETE_TEMPLATE = "deleteTemplate";
/** 工作流模板列表端点名（图2 交互改造：工作流模板全局共享，跨会话可见）。 */
export declare const EP_LIST_FLOW_TEMPLATES = "listFlowTemplates";
/** 保存工作流模板（新建/更新统一；模板全局共享，不按会话隔离）。 */
export declare const EP_PUT_FLOW_TEMPLATE = "putFlowTemplate";
/** 删除工作流模板。 */
export declare const EP_DELETE_FLOW_TEMPLATE = "deleteFlowTemplate";
/** 删除模板预览（角色/文件/数据库）。 */
export declare const EP_DELETE_TEMPLATE_PREVIEW = "deleteTemplatePreview";
/** 受管文件上传端点名（非文本文件：base64 内容 → data/files/ 受管拷贝，§4.2.4.1 规则 2）。 */
export declare const EP_FILE_UPLOAD = "fileUpload";
/** 官方预设列表端点名。 */
export declare const EP_PRESETS = "presets";
/** 工具目录列表端点名（组合管理工具勾选清单用）。 */
export declare const EP_TOOLS = "tools";
/** 模型列表端点名（思考强度列表来自适配器公布的 reasoning efforts）。 */
export declare const EP_MODELS = "models";
/** 工具组合列表端点名。 */
export declare const EP_TOOL_COMBOS = "toolCombos";
/** 保存工具组合。 */
export declare const EP_TOOL_COMBO_PUT = "toolComboPut";
/** 删除工具组合。 */
export declare const EP_TOOL_COMBO_DELETE = "toolComboDelete";
/** 插件目录列表端点名（组合管理用）。 */
export declare const EP_PLUGIN_CATALOG = "pluginCatalog";
/** MCP 服务器列表端点名。 */
export declare const EP_MCP_LIST = "mcpList";
/** 保存 MCP 服务器。 */
export declare const EP_MCP_PUT = "mcpPut";
/** 删除 MCP 服务器。 */
export declare const EP_MCP_DELETE = "mcpDelete";
/** 切换 MCP 服务器启用状态。 */
export declare const EP_MCP_TOGGLE = "mcpToggle";
/** 全局工具开关列表端点名（父代理工具白名单「关闭」侧；关闭后所有会话的代理上下文中不可见）。 */
export declare const EP_TOOL_SWITCHES = "toolSwitches";
/** 设置单个工具开/关状态端点名（全局即时生效）。 */
export declare const EP_TOOL_SWITCH_PUT = "toolSwitchPut";
/** 批量设置一组工具开/关状态端点名（组合管理「标签一键开关」用；全局即时生效）。 */
export declare const EP_TOOL_SWITCH_PUT_MANY = "toolSwitchPutMany";
/** 运行启动端点名。 */
export declare const EP_RUN = "run";
/** 运行状态轮询端点名。 */
export declare const EP_RUN_STATUS = "runStatus";
/** 会话活跃 run 列表端点名（工作台进入时自动选中运行中实例用；running/paused 保留锁）。 */
export declare const EP_ACTIVE_RUNS = "activeRuns";
/** 运行停止端点名。 */
export declare const EP_RUN_STOP = "runStop";
/** 运行历史端点名。 */
export declare const EP_RUN_HISTORY = "runHistory";
/** 断点续跑端点名。 */
export declare const EP_RUN_RESUME = "runResume";
/** 数据库连接测试端点名。 */
export declare const EP_DB_TEST = "dbTest";
/** 数据库表结构端点名。 */
export declare const EP_DB_SCHEMA = "dbSchema";
/** 数据库检索预览端点名。 */
export declare const EP_DB_SEARCH_PREVIEW = "dbSearchPreview";
/** 导出工作流端点名（v2 bundle）。 */
export declare const EP_EXPORT_WORKFLOW = "exportWorkflow";
/** 导入工作流端点名（v2 bundle）。 */
export declare const EP_IMPORT_WORKFLOW = "importWorkflow";
/** 导出角色模板端点名（v2 bundle）。 */
export declare const EP_EXPORT_AGENT_TEMPLATE = "exportAgentTemplate";
/** 导入角色模板端点名（v2 bundle）。 */
export declare const EP_IMPORT_AGENT_TEMPLATE = "importAgentTemplate";
/** 启动节点子代理工具名（父代理；模式一编排执行：异步非阻塞启动，暂停门三语义）。 */
export declare const WF_RUN_NODE = "wf_run_node";
/** 启动节点子代理工具名（父代理；模式二后台服务：阻塞等待节点完成，暂停门仍立即返回）。 */
export declare const WF_RUN_NODE_WAIT = "wf_run_node_wait";
/** 幂等收尾工具名（父代理；释放运行锁）。 */
export declare const WF_FINISH = "wf_finish";
/** 子代理向主会话用户提问工具名（官网提问卡，可选注入）。 */
export declare const WF_ASK = "wf_ask";
/** Agent 间阻塞通信工具名（ask/reply/resolve 三态，可选注入）。 */
export declare const WF_ASK_AGENT = "wf_ask_agent";
/** 单工具三模式数据访问工具名（search/query/schema，有 db-in 连线时注入）。 */
export declare const WF_DB_QUERY = "wf_db_query";
/** 父代理自主编排的只读勘察工具名（角色模板/组合/工具开关/preset/数据源/模板库 + 元参数预算）。 */
export declare const WF_ORG_CATALOG = "wf_org_catalog";
/** 父代理自主编排的写图工具名（三分区：图结构 / 元参数 / 运行状态标记）。 */
export declare const WF_GRAPH_PATCH = "wf_graph_patch";
/** 父代理（主会话 Agent）可见工具集：wf_run_node / wf_run_node_wait、wf_finish、wf_ask_agent。 */
export declare const PARENT_AGENT_VISIBLE_TOOLS: readonly ["wf_run_node", "wf_run_node_wait", "wf_finish", "wf_ask_agent"];
/**
 * 子代理永久隐藏工具集（双保险：resolveAgentTools 的 allow 名单剔除 +
 * child scope `tools.restrict({ deny })` 显式隐藏，两处均直接引用本常量）：
 * wf_run_node / wf_run_node_wait / wf_finish（仅父代理可调度）+ wf_org_catalog /
 * wf_graph_patch（自主编排方案 §4：勘察与改图都是「父代理的组织权限」，子代理不得改图）。
 * 注意：全局工具开关（tool-switches）只影响「是否可见」，本集合是「永不进子代理」，
 * 两者正交——组合管理仍列出本集合工具（同一页面兼作全局开关面板），但永不随组合下发。
 */
export declare const CHILD_AGENT_HIDDEN_TOOLS: readonly ["wf_run_node", "wf_run_node_wait", "wf_finish", "wf_org_catalog", "wf_graph_patch"];
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
export declare const ORG_AUTHORING_TOOLS: readonly ["wf_org_catalog", "wf_graph_patch"];
/**
 * 官方保留的 Code Mode presentation transport 名（run_code）：
 *  - 官方 core/tools 在非 native 模式为每个 scope 自动注入（子代理本就自带，无需勾选）；
 *  - tools.restrict 的 allow/deny 名单禁止出现该名（官方校验抛错，见 @repo packages/core/tools/src/index.ts L1085）；
 *  - 因此组合管理可选列表必须剔除、resolveAgentTools 的 allow 名单必须剔除（双保险）。
 */
export declare const RESERVED_TRANSPORT_TOOL = "run_code";
/**
 * 可选注入工具集（默认不注入任何代理，仅勾选/存在连线时按需进入子代理工具集）。
 *  - wf_ask：组合/白名单勾选时注入（需求文档 §4.6 规则 6）
 *  - wf_ask_agent：组合/白名单勾选时注入（协作组内通信，需求文档 §4.4.1 规则 5）
 *  - wf_db_query：存在数据库连线（db-in）时按连线自动注入（需求文档 §4.4.3 规则 5）
 */
export declare const OPTIONAL_INJECT_TOOLS: readonly ["wf_ask", "wf_ask_agent", "wf_db_query"];
/**
 * 工具可见性元数据总表：以「工具名 → 可见性描述」的统一视图汇总 §4.5 规则，
 * 供测试做关键规则断言与消费侧做静态判定（as const，零运行时 import）。
 */
export declare const TOOL_VISIBILITY: {
    /** 父代理可见集（wf_run_node / wf_run_node_wait / wf_finish / wf_ask_agent(resolve) + 有 db-in 时的 wf_db_query）。 */
    readonly parentVisible: readonly ["wf_run_node", "wf_run_node_wait", "wf_finish", "wf_ask_agent"];
    /** 子代理永久隐藏集（wf_run_node / wf_run_node_wait / wf_finish + 自主编排两工具）。 */
    readonly childHidden: readonly ["wf_run_node", "wf_run_node_wait", "wf_finish", "wf_org_catalog", "wf_graph_patch"];
    /** 可选注入集（wf_ask / wf_ask_agent / wf_db_query）。 */
    readonly optionalInject: readonly ["wf_ask", "wf_ask_agent", "wf_db_query"];
    /** 自主编排工具集（wf_org_catalog / wf_graph_patch；默认开启、父代理专属，可经全局工具开关关闭）。 */
    readonly orgAuthoring: readonly ["wf_org_catalog", "wf_graph_patch"];
};
/**
 * 运行状态枚举（RUN_STATUSES）：与 ./run-types.js 的 RunStatus / 架构文档 §6.1
 * RunSnapshot.status 逐字一致（六态）。
 * running <-> paused -> completed / failed / stopped；宿主重启后
 * running/paused -> interrupted（可恢复）（架构文档 §4.3）。
 * 注意：pending 仅为**节点级**待执行状态（NODE_STATUSES，§6.1 nodes[].status），
 * 不作为 run 级持久化状态——run 快照创建即进入 running，不存在「排队/待启动」
 * 的持久化中间态（需求文档 §4.7 规则 3 断点数据字段同样不含 pending）。
 */
export declare const RUN_STATUSES: readonly ["running", "paused", "completed", "failed", "stopped", "interrupted"];
/**
 * 节点状态枚举（NODE_STATUSES）：与 ./run-types.js 的 NodeRunStatus /
 * 架构文档 §6.1 RunSnapshot.nodes[].status 逐字一致（七态，含协作组「待命」armed——
 * 非终态：回合结束但仍在协作组内可被唤醒，父代理 wf_finish 后终态化，P0-1）。
 * react-capped 为 ReAct 软截停（非失败，正常产出）。
 * 与该类型的双向穷尽由测试的编译期断言锁定（禁止固定长度断言）。
 */
export declare const NODE_STATUSES: readonly ["pending", "running", "armed", "ok", "fail", "skipped", "react-capped"];
/** 模式枚举：mode1 编排执行 / mode2 后台服务（需求文档 §1 双模式架构）。 */
export declare const MODES: readonly ["mode1", "mode2"];
/**
 * 可执行单元节点种类（元参数规模统计口径，自主编排方案 §6.4）：
 * 子代理（agent）、父代理（parent）与协作组卡片（group，组内成员并行执行为一单元）。
 * 为什么放在协议常量层而不是纯形状层：该口径是 Host 检查器 / 写图工具 / 客户端预算
 * 展示共用的跨层契约常量，改一处必须三端一致；纯形状文件不得含运行时值。
 * 口径漂移会直接导致预算判定与展示不一致，故以 NodeKind 标注类型并由测试锁定取值。
 */
export declare const EXECUTABLE_UNIT_KINDS: readonly NodeKind[];
/** 流程连线颜色变量（冷灰/银白）。 */
export declare const COLOR_VAR_FLOW = "--wf-flow";
/** 上下文连线颜色变量（琥珀金）。 */
export declare const COLOR_VAR_CONTEXT = "--wf-context";
/** 数据库连线颜色变量（天蓝）。 */
export declare const COLOR_VAR_DATABASE = "--wf-database";
/** 条件通过颜色变量（翠绿）。 */
export declare const COLOR_VAR_PASS = "--wf-pass";
/** 条件不通过颜色变量（珊瑚红）。 */
export declare const COLOR_VAR_FAIL = "--wf-fail";
/** 条件内容颜色变量（紫罗兰）。 */
export declare const COLOR_VAR_CONTENT = "--wf-content";
/**
 * 连线颜色变量名列表（按需求文档 §4.3 连线类型顺序：流程/上下文/数据库/通过/不通过/内容）。
 * 供测试断言 6 个颜色变量齐全。
 */
export declare const COLOR_VARS: readonly ["--wf-flow", "--wf-context", "--wf-database", "--wf-pass", "--wf-fail", "--wf-content"];
/** 定时任务列表端点名（含运行态合并视图）。 */
export declare const EP_SCHEDULER_TASKS = "schedulerTasks";
/** 保存定时任务端点名（新建/更新统一）。 */
export declare const EP_SCHEDULER_TASK_PUT = "schedulerTaskPut";
/** 删除定时任务端点名。 */
export declare const EP_SCHEDULER_TASK_DELETE = "schedulerTaskDelete";
/**
 * 定时任务「常用时区」下拉建议列表（**唯一本体**）。
 *
 * 为什么放在共享协议层：该清单同时服务两端——host 侧的任务配置默认值/文档示例与
 * client 侧的下拉候选。此前 host（scheduler/task-config.ts 的 COMMON_TIMEZONES）与
 * client（SchedulerManager.tsx 的 TIMEZONE_SUGGESTIONS）各维护一份逐项相同的字面量，
 * 任一端增删都会静默漂移（AGENTS.md「同一语义只允许一处本体」）。
 *
 * 语义限定：这是**展示建议**，不是校验白名单——时区合法性一律由
 * `Intl.DateTimeFormat` 的 IANA 名称解析裁决（见 scheduler/calendar.ts），本列表
 * 只决定下拉里先给出哪些候选，用户可以填任意合法 IANA 时区。
 * 排序：按使用频次（Asia 主要时区 → 欧美 → UTC 兜底）。
 *
 * 类型标注为 `readonly string[]`（而非字面量联合）：调用方要往候选里插入本机时区
 * （`Intl` 解析出的任意 IANA 名），字面量联合会让 includes/unshift 需要窄化断言。
 */
export declare const SCHEDULER_TIMEZONE_SUGGESTIONS: readonly string[];
/** 乐观锁冲突：资源在客户端加载后已被别的写入修改（HTTP 409）。 */
export declare const ERR_REVISION_CONFLICT = "FLOW_REVISION_CONFLICT";
