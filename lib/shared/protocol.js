// src/host/shared/protocol.ts
//
// Host + Client 共享协议常量与类型（protocol.ts）。
//
// 本文件集中定义 GUI API 端点名常量、wf_* 工具名常量、工具可见性元数据、
// 运行/节点状态枚举、模式枚举、跨层口径常量与颜色变量名常量——全部为纯字面量常量
// （as const），供 host 半区与 client 半区共用，避免两端字符串漂移。
//
// 约束：
//   - **禁止运行时 import**：本文件不得引入任何运行时依赖（纯常量模块）；
//     仅允许 `import type`（编译期完全擦除）用于给常量标注契约类型。
//   - 全部 `as const`，字面量值逐字对齐；枚举/取值域必须与类型层**双向穷尽**：
//     任一侧增删取值都要同步，并由测试以「类型 ⊆ 常量 ∧ 常量 ⊆ 类型」编译期断言锁定（禁止用固定
//     长度断言代替穷尽断言）。
//   - 中文注释说明语义与依据（W-04）。
// ---------------------------------------------------------------------------
// GUI API 端点名常量
// ---------------------------------------------------------------------------
// 端点挂载形态：POST /visual-workflow/<endpoint>，body { args }，响应 { ok, value/error }。
// 以下常量即 <endpoint> 段字符串，host 与 client 共用，保证前后端路径零漂移。
/** 工作流列表端点名。 */
export const EP_LIST_WORKFLOWS = 'listWorkflows';
/** 获取单个工作流。 */
export const EP_GET_WORKFLOW = 'getWorkflow';
/** 保存工作流（含创建工作流）。 */
export const EP_PUT_WORKFLOW = 'putWorkflow';
/** 删除工作流。 */
export const EP_DELETE_WORKFLOW = 'deleteWorkflow';
/** 服务列表端点名。 */
export const EP_LIST_SERVICES = 'listServices';
/** 获取单个服务。 */
export const EP_GET_SERVICE = 'getService';
/** 保存服务。 */
export const EP_PUT_SERVICE = 'putService';
/** 删除服务。 */
export const EP_DELETE_SERVICE = 'deleteService';
/** 启动服务（模式二 fork 子进程）。 */
export const EP_SERVICE_START = 'serviceStart';
/** 停止服务。 */
export const EP_SERVICE_STOP = 'serviceStop';
/** 查询服务状态。 */
export const EP_SERVICE_STATUS = 'serviceStatus';
/**
 * 服务调试流式端点名（服务控制台调试框：代理运行中服务的 /v1/chat/completions，
 * SSE 逐块转发回浏览器打字机渲染）。
 * 为什么走 Host 代理而非浏览器直连：服务进程无 CORS 头，同源代理避免跨域失败；
 * apiKey 鉴权由 Host 侧配置持有，不落浏览器。
 */
export const EP_SERVICE_DEBUG = 'serviceDebug';
/**
 * 创建会话端点名（「开启新会话」一次性动作：从模板创建实例时先新建主会话，
 * 实例绑定该新会话 id——官方 agents.create 不传 parentSession 即无父根会话）。
 * 参数 { sessionId?, workspacePath? }，返回 { sessionId }。
 * 会话标题不在此定义：官方 agents.create 的会话元信息不接受自定义字段，故不带 label 入参。
 */
export const EP_CREATE_SESSION = 'createSession';
/** 模板列表端点名（角色/文件/数据库三类共用）。 */
export const EP_LIST_TEMPLATES = 'listTemplates';
/** 保存模板。 */
export const EP_PUT_TEMPLATE = 'putTemplate';
/** 删除模板。 */
export const EP_DELETE_TEMPLATE = 'deleteTemplate';
/** 工作流模板列表端点名（图2 交互改造：工作流模板全局共享，跨会话可见）。 */
export const EP_LIST_FLOW_TEMPLATES = 'listFlowTemplates';
/** 保存工作流模板（新建/更新统一；模板全局共享，不按会话隔离）。 */
export const EP_PUT_FLOW_TEMPLATE = 'putFlowTemplate';
/** 删除工作流模板。 */
export const EP_DELETE_FLOW_TEMPLATE = 'deleteFlowTemplate';
/** 受管文件上传端点名（非文本文件：base64 内容 → data/files/ 受管拷贝）。 */
export const EP_FILE_UPLOAD = 'fileUpload';
/** 官方预设列表端点名。 */
export const EP_PRESETS = 'presets';
/** 模型列表端点名（思考强度列表来自适配器公布的 reasoning efforts）。 */
export const EP_MODELS = 'models';
/** 工具组合列表端点名。 */
export const EP_TOOL_COMBOS = 'toolCombos';
/** 保存工具组合。 */
export const EP_TOOL_COMBO_PUT = 'toolComboPut';
/** 删除工具组合。 */
export const EP_TOOL_COMBO_DELETE = 'toolComboDelete';
/** 插件目录列表端点名（组合管理用）。 */
export const EP_PLUGIN_CATALOG = 'pluginCatalog';
/** 保存 MCP 服务器。 */
export const EP_MCP_PUT = 'mcpPut';
/** 删除 MCP 服务器。 */
export const EP_MCP_DELETE = 'mcpDelete';
/** 切换 MCP 服务器启用状态。 */
export const EP_MCP_TOGGLE = 'mcpToggle';
/** 设置单个工具开/关状态端点名（全局即时生效）。 */
export const EP_TOOL_SWITCH_PUT = 'toolSwitchPut';
/** 批量设置一组工具开/关状态端点名（组合管理「标签一键开关」用；全局即时生效）。 */
export const EP_TOOL_SWITCH_PUT_MANY = 'toolSwitchPutMany';
/** 运行启动端点名。 */
export const EP_RUN = 'run';
/** 运行状态轮询端点名。 */
export const EP_RUN_STATUS = 'runStatus';
/** 会话活跃 run 列表端点名（工作台进入时自动选中运行中实例用；running/paused 保留锁）。 */
export const EP_ACTIVE_RUNS = 'activeRuns';
/** 运行停止端点名。 */
export const EP_RUN_STOP = 'runStop';
/** 运行历史端点名。 */
export const EP_RUN_HISTORY = 'runHistory';
/** 断点续跑端点名。 */
export const EP_RUN_RESUME = 'runResume';
/**
 * 运行期配置下发端点名（host 插件配置 → 前端可调参数；前端不得自读 host config）。
 * 响应 `{ runPollMs }`：运行状态回显轮询间隔毫秒数——消费方在缺失/非法时回退自持缺省（600ms）。
 */
export const EP_RUNTIME_CONFIG = 'runtimeConfig';
/** 数据库连接测试端点名。 */
export const EP_DB_TEST = 'dbTest';
/** 导出工作流端点名（v2 bundle）。 */
export const EP_EXPORT_WORKFLOW = 'exportWorkflow';
/** 导入工作流端点名（v2 bundle）。 */
export const EP_IMPORT_WORKFLOW = 'importWorkflow';
/** 导出角色模板端点名（v2 bundle）。 */
export const EP_EXPORT_AGENT_TEMPLATE = 'exportAgentTemplate';
/** 导入角色模板端点名（v2 bundle）。 */
export const EP_IMPORT_AGENT_TEMPLATE = 'importAgentTemplate';
// ---------------------------------------------------------------------------
// 资产（Asset）端点名常量
// ---------------------------------------------------------------------------
// 语义：「资产」是模版的晋升形态，带版本控制与回滚；模版是可随意修改的草稿。
// 资产库落盘为 SQLite（<dataDir>/assets.db），与模版 JSON 文件是两套事实源，
// 端点只暴露资产事实，不承担「模版何时该晋升」的业务判断。
/** 列出资产端点名（按 kind 取 Active 版本索引：工作流资产 / 角色资产）。 */
export const EP_LIST_ASSETS = 'listAssets';
/** 取单个资产端点名（Active 版本详情；属性栏编辑与资产态画布打开共用）。 */
export const EP_GET_ASSET = 'getAsset';
/** 资产入库端点名（模版 → 资产版本；同一模版再次入库即同一 asset 的新版本）。 */
export const EP_PROMOTE_ASSET = 'promoteAsset';
/** 资产态保存端点名（登记该资产的新版本；不覆盖历史版本）。 */
export const EP_SAVE_ASSET_VERSION = 'saveAssetVersion';
/** 资产版本列表端点名（回滚上拉列表；含 Active 标记）。 */
export const EP_LIST_ASSET_VERSIONS = 'listAssetVersions';
/** 资产回滚端点名（改 Active 指针指向历史版本；不新增版本）。 */
export const EP_ROLLBACK_ASSET = 'rollbackAsset';
/** 资产退役（归档）端点名（Active 移除、历史版本保留；UI 侧二次确认；不删除任何版本行）。 */
export const EP_RETIRE_ASSET = 'retireAsset';
/**
 * 资产级联影响预览端点名（保存前的影响面告知）。
 *
 * 只读：按「本次要保存的内容」推演哪些**其他**工作流资产会受牵连（共享角色资产将被登记
 * 新版本），不落库、不改 Active 指针。为什么不由客户端自行推演：角色字段映射与共享判定
 * 都是 Host 的事实，客户端复制一份必然漂移。
 */
export const EP_PREVIEW_ASSET_CASCADE = 'previewAssetCascade';
/**
 * 资产恢复端点名（历史资产 → 活跃资产）。
 *
 * 与回滚的职责分工（用户裁决）：`restore` 管**状态转换**（把归档资产恢复为活跃），
 * `rollback` 只管**版本与 Active 指针**。恢复取该资产的最新版本行重建 Active 指针。
 */
export const EP_RESTORE_ASSET = 'restoreAsset';
// ---------------------------------------------------------------------------
// 经验（Experience）端点名常量
// ---------------------------------------------------------------------------
// 语义：经验是自主主体沉淀的可复用决策原则，**没有版本控制**（无历史表、无 Active 指针），
// 只有「活跃 / 已归档」两态；归档即退出召回面（wf_experience_recall 不再召回它）。
// 因此界面侧只有「保存」与「归档 / 恢复」两组按钮，不提供回滚。
// 保存可编辑的九个语义字段：检索文本与向量由 Host 在事务外重算后落库，界面只读展示。
/** 列出经验端点名（活跃 + 已归档，一次返回；条目自带 active 标记）。 */
export const EP_LIST_EXPERIENCES = 'listExperiences';
/** 保存经验端点名（就地改写可编辑字段；无版本语义，不产生历史行）。 */
export const EP_SAVE_EXPERIENCE = 'saveExperience';
/** 归档经验端点名（置为非活跃：退出父代理召回面，内容全部保留）。 */
export const EP_RETIRE_EXPERIENCE = 'retireExperience';
/** 恢复经验端点名（置为活跃：重新进入父代理召回面）。 */
export const EP_RESTORE_EXPERIENCE = 'restoreExperience';
// ---------------------------------------------------------------------------
// wf_* 工具名常量
// ---------------------------------------------------------------------------
/** 启动节点子代理工具名（父代理；模式一编排执行：异步非阻塞启动，暂停门三语义）。 */
export const WF_RUN_NODE = 'wf_run_node';
/** 启动节点子代理工具名（父代理；模式二后台服务：阻塞等待节点完成，暂停门仍立即返回）。 */
export const WF_RUN_NODE_WAIT = 'wf_run_node_wait';
/** 幂等收尾工具名（父代理；释放运行锁）。 */
export const WF_FINISH = 'wf_finish';
/** 向用户提问工具名（官方提问卡；任何 agent 可用，可选注入）。 */
export const WF_ASK_USER = 'wf_ask_user';
/**
 * 向本 run 的另一成员投递一条持久消息的工具名（单向，随即返回，不等待回复）。
 *
 * 寻址面只有两种形态——`nodeId`（覆盖普通子代理与 Team 成员，由插件内部解析投递
 * 通道）与父代理固定别名 `parent`。父代理与子代理均可调用。
 */
export const WF_SEND_MESSAGE = 'wf_send_message';
/** 单工具三模式数据访问工具名（search/query/schema，有 db-in 连线时注入）。 */
export const WF_DB_QUERY = 'wf_db_query';
/** 父代理自主编排的只读勘察工具名（编排规则 / 角色模板 / 组合 / preset / 模型 / 工作流模板，按需召回详情）。 */
export const WF_ORG_CATALOG = 'wf_org_catalog';
/** 父代理自主编排的写图工具名（两组：图结构 / 运行状态标记）。 */
export const WF_GRAPH_PATCH = 'wf_graph_patch';
/**
 * 经验学习工具名（所有代理可用；单工具双态：空集取当前主体类型的生成 Prompt，
 * 传候选即校验后入库）。
 * 与自主编排工具不同：经验是「每个主体自己的学习」，子代理同样需要——
 * 是否进入子代理工具集由组合勾选决定（runner.resolveAgentTools 的 combo ∩ 可见）。
 */
export const WF_EXPERIENCE_LEARN = 'wf_experience_learn';
/**
 * 经验召回工具名（所有代理可用；两阶段：先按 query 取候选摘要，再按 ids 取完整内容）。
 * 与 wf_org_catalog 的分工：后者只勘察组织资产，不再承担经验召回。
 */
export const WF_EXPERIENCE_RECALL = 'wf_experience_recall';
/**
 * 经验反馈工具名（所有代理可用；提交本次任务中**实际使用过**的经验评价）。
 *
 * 阶段语义（用户裁决）：召回发生在任务开始或执行途中，而反馈与学习一样只发生在
 * **任务最终完成阶段**——只有做完整件事，才有资格评价某条经验带来的实际效果。
 * 只接受已被显式注入（wf_experience_recall 的 ids 阶段）过的经验，"没有使用的经验不能评价"。
 */
export const WF_EXPERIENCE_FEEDBACK = 'wf_experience_feedback';
// ---------------------------------------------------------------------------
// 工具可见性元数据
// ---------------------------------------------------------------------------
/**
 * 子代理永久隐藏工具集（双保险：resolveAgentTools 的 allow 名单剔除 +
 * child scope `tools.restrict({ deny })` 显式隐藏，两处均直接引用本常量）：
 * wf_run_node / wf_run_node_wait / wf_finish（仅父代理可调度）+ wf_org_catalog /
 * wf_graph_patch（勘察与改图都是「父代理的组织权限」，子代理不得改图）。
 * 注意：全局工具开关（tool-switches）只影响「是否可见」，本集合是「永不进子代理」，
 * 两者正交——组合管理仍列出本集合工具（同一页面兼作全局开关面板），但永不随组合下发。
 * 经验三工具（wf_experience_learn / wf_experience_recall / wf_experience_feedback）**不在**本集合：
 * 每个主体都有自己的经验，子代理经可选注入集勾选后方可使用。
 */
export const CHILD_AGENT_HIDDEN_TOOLS = [
    WF_RUN_NODE,
    WF_RUN_NODE_WAIT,
    WF_FINISH,
    WF_ORG_CATALOG,
    WF_GRAPH_PATCH,
];
// ---------------------------------------------------------------------------
// 官方 Agent Team 工具名常量
// ---------------------------------------------------------------------------
// 运行事实：官方 tool-agent-team 包在**每个 Team 成员作用域**（含 Lead 自身）注册
// 9 个同名工具，并注入固定协作策略段。名字即官方对外契约，插件只消费不转写。
//
// 两个机制事实决定了插件侧的处理方式（改代码前必须遵守）：
//   - 这 9 个工具注册在成员**自身作用域层**；`tools.restrict` 只过滤「继承面」
//     （全局层与祖先层），永不隐藏自身层注册 —— 因此成员的工具白名单 allow 名单
//     **既不能也不必要**列出这些名字（列出会因「未知全局工具」校验而抛错）；
//   - 唯一能隐藏它们的机制是插件侧按 `assembly.tools` 过滤的全局工具开关瀑布。
//
// Lead 专属：只有 Lead 可创建与中断 teammate；子代理调用会收到 LEAD_REQUIRED 拒绝。
/** 创建 teammate 工具名（Lead 专属）。 */
export const TEAM_SPAWN_TEAMMATE = 'spawn_teammate';
/** 向其他成员发送一条持久消息工具名。 */
export const TEAM_SEND_MESSAGE = 'send_message';
/** 列出成员与可用状态工具名。 */
export const TEAM_LIST_AGENTS = 'list_agents';
/** 等待下一次团队变化工具名。 */
export const TEAM_WAIT_AGENT = 'wait_agent';
/** 中断某成员当前回合工具名（Lead 专属）。 */
export const TEAM_INTERRUPT_AGENT = 'interrupt_agent';
/** 共享任务板：新建任务。 */
export const TEAM_TASK_CREATE = 'team_task_create';
/** 共享任务板：列出任务。 */
export const TEAM_TASK_LIST = 'team_task_list';
/** 共享任务板：读取单个任务。 */
export const TEAM_TASK_GET = 'team_task_get';
/** 共享任务板：按 revision 更新任务。 */
export const TEAM_TASK_UPDATE = 'team_task_update';
/** 官方 Team 工具全量清单（9 个；组合管理页展示与全局开关的目标集）。 */
export const TEAM_TOOL_NAMES = [
    TEAM_SPAWN_TEAMMATE,
    TEAM_SEND_MESSAGE,
    TEAM_LIST_AGENTS,
    TEAM_WAIT_AGENT,
    TEAM_INTERRUPT_AGENT,
    TEAM_TASK_CREATE,
    TEAM_TASK_LIST,
    TEAM_TASK_GET,
    TEAM_TASK_UPDATE,
];
/**
 * 首次安装（tool-switches.json 尚不存在）时写入磁盘的默认关闭清单。
 *
 * 语义：只在「文件不存在」这一个条件下播种一次，写入后磁盘即唯一权威；此后查询、
 * 展示、生效三者读同一份磁盘清单，不存在「内置种子 ∪ 用户项」的第二份状态。
 *   - spawn_teammate 默认关闭的理由（运行事实）：自行拉人会绕过插件的成员编排，
 *     而插件创建成员走宿主对官方服务的直接调用，不经过工具注册与开关，不受本项影响；
 *   - send_message 默认关闭的理由（用户裁决 2026-10）：消息发送统一收口到
 *     wf_send_message（官方 Team 版 send_message 只认 teammate 名，且父代理给普通
 *     子代理投递会失败），避免同一语义存在两条互不可达的通道；官方 Team 的
 *     list_agents / interrupt_agent / 任务板仍保留官方能力。
 *     注意：本项只在首次安装播种——既有部署的磁盘清单不会被改写，需用户在全局开关
 *     面板自行关闭官方 send_message。
 */
export const DEFAULT_DISABLED_ON_FIRST_INSTALL = [TEAM_SPAWN_TEAMMATE, TEAM_SEND_MESSAGE];
/**
 * 官方保留的 Code Mode presentation transport 名（run_code）：
 *  - 官方 core/tools 在非 native 模式为每个 scope 自动注入（子代理本就自带，无需勾选）；
 *  - tools.restrict 的 allow/deny 名单禁止出现该名（官方校验抛错，见 @repo packages/core/tools/src/index.ts L1085）；
 *  - 因此组合管理可选列表必须剔除、resolveAgentTools 的 allow 名单必须剔除（双保险）。
 */
export const RESERVED_TRANSPORT_TOOL = 'run_code';
// ---------------------------------------------------------------------------
// 运行状态 / 节点状态 / 模式枚举
// ---------------------------------------------------------------------------
/**
 * 运行状态枚举（RUN_STATUSES）：与 run-types.js 的 RunStatus 逐字一致（六态）。
 * running <-> paused -> completed / failed / stopped；宿主重启后
 * running/paused -> interrupted（可恢复）。
 * 注意：pending 仅为**节点级**待执行状态（NODE_STATUSES），
 * 不作为 run 级持久化状态——run 快照创建即进入 running，不存在「排队/待启动」
 * 的持久化中间态（断点数据字段同样不含 pending）。
 */
export const RUN_STATUSES = [
    'running', // 运行中
    'paused', // 已暂停（暂停门，保留锁）
    'completed', // 已完成
    'failed', // 失败
    'stopped', // 已停止
    'interrupted', // 已中断（宿主重启标记，可恢复）
];
/**
 * 节点状态枚举（NODE_STATUSES）：与 run-types.js 的 NodeRunStatus 逐字一致（七态，含 Team「待命」armed——
 * 非终态：回合结束但仍在 Team 内可被唤醒，父代理 wf_finish 后终态化）。
 * react-capped 为 ReAct 软截停（非失败，正常产出）。
 * 与该类型的双向穷尽由测试的编译期断言锁定（禁止固定长度断言）。
 */
export const NODE_STATUSES = [
    'pending', // 待执行
    'running', // 执行中
    'armed', // 待命（Team 成员非终态）
    'ok', // 成功
    'fail', // 失败
    'skipped', // 已跳过
    'react-capped', // ReAct 软截停（非失败）
];
/** 模式枚举：mode1 编排执行 / mode2 后台服务。 */
export const MODES = ['mode1', 'mode2'];
// ---------------------------------------------------------------------------
// 跨层口径常量（元参数规模统计口径）
// ---------------------------------------------------------------------------
/**
 * 可执行单元节点种类（元参数规模统计口径）：
 * 子代理（agent）、父代理（parent）与 Team 卡片（group，组内成员并行执行为一单元）。
 * 为什么放在协议常量层而不是纯形状层：该口径是 Host 检查器 / 写图工具 / 客户端预算
 * 展示共用的跨层契约常量，改一处必须三端一致；纯形状文件不得含运行时值。
 * 口径漂移会直接导致预算判定与展示不一致，故以 NodeKind 标注类型并由测试锁定取值。
 */
export const EXECUTABLE_UNIT_KINDS = ['agent', 'parent', 'group'];
// ---------------------------------------------------------------------------
// 颜色变量名常量（样式 / 连线类型与颜色规范）
// ---------------------------------------------------------------------------
// 连线类型颜色对应 CSS 变量（深/浅色自适应），变量名供 host/client 共用。
/** 流程连线颜色变量（冷灰/银白）。 */
export const COLOR_VAR_FLOW = '--wf-flow';
/** 上下文连线颜色变量（琥珀金）。 */
export const COLOR_VAR_CONTEXT = '--wf-context';
/** 数据库连线颜色变量（天蓝）。 */
export const COLOR_VAR_DATABASE = '--wf-database';
/** 条件通过颜色变量（翠绿）。 */
export const COLOR_VAR_PASS = '--wf-pass';
/** 条件不通过颜色变量（珊瑚红）。 */
export const COLOR_VAR_FAIL = '--wf-fail';
/** 条件内容颜色变量（紫罗兰）。 */
export const COLOR_VAR_CONTENT = '--wf-content';
/**
 * 连线颜色变量名列表（按连线类型顺序：流程/上下文/数据库/通过/不通过/内容）。
 * 供测试断言 6 个颜色变量齐全。
 */
export const COLOR_VARS = [
    COLOR_VAR_FLOW,
    COLOR_VAR_CONTEXT,
    COLOR_VAR_DATABASE,
    COLOR_VAR_PASS,
    COLOR_VAR_FAIL,
    COLOR_VAR_CONTENT,
];
// ---------------------------------------------------------------------------
// 定时任务端点名常量（新功能：host scheduler/ + client scheduler-ui）
// ---------------------------------------------------------------------------
// 说明：本功能为新增独立功能，端点挂载形态与其余端点一致（POST /visual-workflow/<endpoint>）。
/** 定时任务列表端点名（含运行态合并视图）。 */
export const EP_SCHEDULER_TASKS = 'schedulerTasks';
/** 保存定时任务端点名（新建/更新统一）。 */
export const EP_SCHEDULER_TASK_PUT = 'schedulerTaskPut';
/** 删除定时任务端点名。 */
export const EP_SCHEDULER_TASK_DELETE = 'schedulerTaskDelete';
/**
 * GUI 端点名清单（**唯一端点本体**；GUI API 白名单只从它派生）。
 *
 * 为什么需要它：白名单原先由本文件的**全部字符串导出**派生（`Object.values(EP)`），
 * 于是错误码常量、`wf_*` 工具名、时区建议等在 `Set` 里也被登记为「合法端点」——
 * 白名单失去「端点集合」的语义，任何新增协议字符串都会无声扩张可路由面。
 * 本数组是有序的端点全集；`boundary.ts` 的白名单与契约测试都以此为准。
 *
 * 新增端点：在对应段落新增 `EP_*` 常量后，必须把字面量同步登记到本数组
 * （缺失即端点 404；多余项由契约测试的「白名单每个名字都有实现方法」断言拦住）。
 */
export const ENDPOINT_NAMES = [
    'listWorkflows',
    'getWorkflow',
    'putWorkflow',
    'deleteWorkflow',
    'listServices',
    'getService',
    'putService',
    'deleteService',
    'serviceStart',
    'serviceStop',
    'serviceStatus',
    'serviceDebug',
    'createSession',
    'listTemplates',
    'putTemplate',
    'deleteTemplate',
    'listFlowTemplates',
    'putFlowTemplate',
    'deleteFlowTemplate',
    'fileUpload',
    'presets',
    'models',
    'toolCombos',
    'toolComboPut',
    'toolComboDelete',
    'pluginCatalog',
    'mcpPut',
    'mcpDelete',
    'mcpToggle',
    'toolSwitchPut',
    'toolSwitchPutMany',
    'run',
    'runStatus',
    'activeRuns',
    'runStop',
    'runHistory',
    'runResume',
    'runtimeConfig',
    'dbTest',
    'exportWorkflow',
    'importWorkflow',
    'exportAgentTemplate',
    'importAgentTemplate',
    'listAssets',
    'getAsset',
    'promoteAsset',
    'saveAssetVersion',
    'listAssetVersions',
    'rollbackAsset',
    'retireAsset',
    'previewAssetCascade',
    'restoreAsset',
    'listExperiences',
    'saveExperience',
    'retireExperience',
    'restoreExperience',
    'schedulerTasks',
    'schedulerTaskPut',
    'schedulerTaskDelete',
];
/**
 * 定时任务「常用时区」下拉建议列表（**唯一本体**）。
 *
 * 为什么放在共享协议层：该清单同时服务两端——host 侧的任务配置默认值/文档示例与
 * client 侧的下拉候选。此前 host 与 client 各维护一份逐项相同的字面量，
 * 任一端增删都会静默漂移（同一语义只允许一处本体）。
 *
 * 语义限定：这是**展示建议**，不是校验白名单——时区合法性一律由
 * `Intl.DateTimeFormat` 的 IANA 名称解析裁决，本列表
 * 只决定下拉里先给出哪些候选，用户可以填任意合法 IANA 时区。
 * 排序：按使用频次（Asia 主要时区 → 欧美 → UTC 兜底）。
 *
 * 类型标注为 `readonly string[]`（而非字面量联合）：调用方要往候选里插入本机时区
 * （`Intl` 解析出的任意 IANA 名），字面量联合会让 includes/unshift 需要窄化断言。
 */
export const SCHEDULER_TIMEZONE_SUGGESTIONS = [
    'Asia/Shanghai',
    'Asia/Hong_Kong',
    'Asia/Tokyo',
    'Asia/Singapore',
    'Asia/Seoul',
    'Asia/Taipei',
    'Asia/Kolkata',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'America/New_York',
    'America/Chicago',
    'America/Los_Angeles',
    'America/Sao_Paulo',
    'Australia/Sydney',
    'UTC',
];
// ---------------------------------------------------------------------------
// 节点契约默认值（Host / Client 共用）
// ---------------------------------------------------------------------------
// 输入契约与输出契约的默认文本：新建 agent 节点时**直接写入节点数据**（不是读取期兜底），
// 所以界面显示、运行期注入与磁盘存储是同一个值——「所见即生效」（用户裁决 2026-10）。
// 为什么默认文本必须是共享常量：client 负责落盘与展示、host 负责注入，两端各写一份
// 字面量必然漂移。
//
// 空值语义：契约字段为空串 = 该节点不配置契约（运行期不再注入任何契约相关内容），
// 界面显示空输入框；旧数据里的空值按此解释，不回填默认文本。
/** 输出契约的默认文本（新建 agent 节点时写入 `data.outputSchema`）。 */
export const DEFAULT_OUTPUT_CONTRACT_TEXT = '结论 / 产出文件路径 / 关键决策 / 未决问题';
// ---------------------------------------------------------------------------
// 稳定错误码常量（Host 产出 / Client 按语义消费）
// ---------------------------------------------------------------------------
// 说明：领域模块抛稳定 code，边界层翻译为 HTTP 状态；Client 侧
// 按 code 分支处理（如 ERR_REVISION_CONFLICT 走乐观锁冲突语义，而非仅展示通用
// message）。字面量只在本文件出现一次，两端引用本体，禁止在调用点硬编码。
/** 乐观锁冲突：资源在客户端加载后已被别的写入修改（HTTP 409）。 */
export const ERR_REVISION_CONFLICT = 'FLOW_REVISION_CONFLICT';
/**
 * 目标工作流不存在**或不属于本会话**（HTTP 404）。
 *
 * 为什么两义合一：写路径的归属校验必须与读/删路径同口径（不匹配按「不存在」处理），
 * 否则「他人实例」与「不存在」可用响应码区分，等于给调用方一个存在性预言。
 * 为什么需要稳定码而不是普通 Error：它经 GUI 边界映射状态，无码会落成 500，
 * 违反 api/AGENTS.md「调用方错误不得被响应成 500」。
 */
export const ERR_FLOW_NOT_FOUND = 'FLOW_NOT_FOUND';
/**
 * 资产不存在（Active 索引里没有该 asset_id / 该资产已退役），HTTP 404。
 * 消费方语义：客户端提示「资产已退役或不存在」并刷新资产列表。
 */
export const ERR_ASSET_NOT_FOUND = 'WF_ASSET_NOT_FOUND';
/** 资产版本不存在（回滚目标版本号非法），HTTP 404。 */
export const ERR_ASSET_VERSION_NOT_FOUND = 'WF_ASSET_VERSION_NOT_FOUND';
/**
 * 资产重复登记被拦截（HTTP 409）。
 * 触发场景（用户裁决）：standalone 角色资产与已有 standalone 角色资产 system_prompt 全等
 * ——直接取消当次入库；工作流资产与已有工作流资产内容全等——同样取消。
 */
export const ERR_ASSET_DUPLICATE = 'WF_ASSET_DUPLICATE';
/** 资产入参非法（kind/assetId/版本号/载荷形状），HTTP 400。 */
export const ERR_ASSET_BAD_ARGS = 'WF_ASSET_BAD_ARGS';
/**
 * 经验不存在（经验 id 在经验表里查不到），HTTP 404。
 * 消费方语义：客户端提示「经验不存在或已被清理」并刷新经验列表。
 */
export const ERR_EXPERIENCE_NOT_FOUND = 'WF_EXPERIENCE_NOT_FOUND';
/** 经验入参非法（id / 载荷形状 / 可编辑字段类型），HTTP 400。 */
export const ERR_EXPERIENCE_BAD_ARGS = 'WF_EXPERIENCE_BAD_ARGS';
/**
 * 经验生成 Prompt 尚未初始化即提交候选。
 * 消费方语义：模型必须先调用 `wf_experience_learn`（空集）取得当前主体类型的生成 Prompt，
 * 再按 Prompt 产出候选并提交——该错误消息必须直接给出这一动作。
 */
export const ERR_EXPERIENCE_NOT_INITIALIZED = 'WF_EXPERIENCE_NOT_INITIALIZED';
/** 经验候选不符合入库协议（未知字段、类型不符、长度或数量超限），HTTP 400。 */
export const ERR_EXPERIENCE_VALIDATION = 'WF_EXPERIENCE_VALIDATION';
/**
 * 语义嵌入能力不可用（嵌入服务退化到 BM25 词法检索）。
 * 消费方语义：持久化 V1 要求语义去重，此时**不写入**并如实上报；调用方可稍后重试。
 */
export const ERR_EXPERIENCE_EMBEDDING_UNAVAILABLE = 'WF_EXPERIENCE_EMBEDDING_UNAVAILABLE';
/**
 * 经验类型越界：子代理只能使用 agent 类型（该码当前唯一触发者）。
 * 消费方语义：拒绝本次调用并要求改用 "agent"；父代理按此刻执行的内容自选类型，不受此码约束
 * （父代理侧职责门禁已按用户裁决永久移除）。
 */
export const ERR_EXPERIENCE_WRONG_TYPE = 'WF_EXPERIENCE_WRONG_TYPE';
/** 经验召回失败（检索通道不可用且词法回退亦失败）。 */
export const ERR_EXPERIENCE_RECALL_FAILED = 'WF_EXPERIENCE_RECALL_FAILED';
/**
 * 经验反馈失败（评价写入或统计聚合失败；经验本体不受影响）。
 * 消费方语义：本次评价未落库，调用方可稍后在任务收尾阶段重试；已有评价历史一律不被改写。
 */
export const ERR_EXPERIENCE_FEEDBACK_FAILED = 'WF_EXPERIENCE_FEEDBACK_FAILED';
/** Persisted stage labels are a storage contract, independent of the UI language. */
export const STAGE_LABELS = {
    mode1: { start: '启动', end: '结束', pause: '暂停' },
    mode2: { start: '输入', end: '输出', pause: '暂停' },
};
//# sourceMappingURL=protocol.js.map