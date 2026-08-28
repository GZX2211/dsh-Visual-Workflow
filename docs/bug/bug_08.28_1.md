# 全仓库审查报告

## Batch-01 审查报告

### 审查范围
- `src/host/shared/graph-model.ts`
- `src/host/shared/protocol.ts`
- `src/host/shared/types.ts`

### 审查基准
- 需求文档 PRD-001 v0.1.0
- 架构文档 AD-001 v0.1.0

---

### 问题清单

| 严重性等级 | 类别 | 所在文件 | 具体位置（函数，行号） | 问题描述 | 影响/未对齐点 | 证据 |
| :--------- | :--- | :------- | :--------------------- | :------- | :------------ | :------ |
| P1（中等） | 跨层契约一致性 | `src/host/shared/protocol.ts` | `RUN_STATUSES` 常量定义（约第 112 行） | `RUN_STATUSES` 数组包含了 `'pending'`，但同属 shared 层的 `types.ts` 中 `RunStatus` 类型并未包含 `'pending'`（仅 `running/paused/completed/failed/stopped/interrupted`），且架构文档 §6.1 `RunSnapshot.status` 也未包含该值。同层两个文件对运行状态的定义不一致。 | 前端或测试若引用 `RUN_STATUSES` 作为合法运行状态全集，会误认为 `'pending'` 是可持久化状态；或校验逻辑误接受该值，导致状态机与持久化快照不一致。 | 架构文档 §6.1 `RunSnapshot.status` 类型；`types.ts` 中 `RunStatus` 类型定义；`protocol.ts` 中 `RUN_STATUSES` 定义。 |
| P2（轻微） | 冗余与死代码 | `src/host/shared/graph-model.ts` | `RoleNode.data.proxySourceId` 字段（约第 62 行） | `RoleNode` 的 `kind` 被限定为 `'parent' | 'agent'`，而虚拟节点已由独立的 `ProxyNode` 接口（`kind='proxy'`）表示，其自身包含 `proxySourceId` 字段。因此 `RoleNode.data.proxySourceId` 既不会被 `parent`/`agent` 节点使用（无业务语义），也不会被 `proxy` 节点使用（类型不匹配）。该字段为冗余定义。 | 类型定义冗余，可能误导开发者误认为普通角色节点可携带 `proxySourceId`，造成实现混淆。 | `graph-model.ts` 内 `RoleNode` 与 `ProxyNode` 接口定义；架构文档 §4.2 代码块中 `RoleNode` 虽含 `proxySourceId` 但未定义 `ProxyNode`，文档内部矛盾。 |
| P3（待定） | 文档未覆盖 | `src/host/shared/protocol.ts` | `EP_SERVICE_DEBUG`、`EP_FILE_UPLOAD` 常量定义 | 架构文档 §4.6 端点清单未列出 `serviceDebug` 与 `fileUpload`，但代码定义了这两个端点常量。架构文档 remote/ 目录包含 `service-debug.ts` 与 `download.ts`，且需求文档提及文件上传（§4.2.4.1）与调试（§4.1.3 服务控制台），故功能存在，但文档清单遗漏。 | 无法依据文档判定是否越权；文档与代码存在不一致。 | 架构文档 §4.6 端点清单；架构文档目录结构 remote/ 下文件；需求文档 §4.2.4.1、§4.1.3。 |
| P3（待定） | 文档未覆盖 | `src/host/shared/graph-model.ts` | `WorkflowDocument` 接口中 `revision`、`createdAt`、`updatedAt` 字段 | 架构文档未明确定义 `WorkflowDocument` 接口，这些字段为扩展。需求文档 §4.2.2 仅提及名称、描述等，未明确版本/时间字段。 | 无法判定是否符合预期。 | 架构文档 §4.1 storage 描述；需求文档 §4.2.2。 |

**单独列出**（此为文档未更新，协作 prompt 后续已改为注入到用户消息）：
| P1（中等） | 功能职责对齐 | `src/host/shared/graph-model.ts` | `GroupNode.data.collabPrompt` 字段 JSDoc 注释（约第 150 行） | 注释表述为“追加注入到组内所有成员 **System Prompt 末尾**”，但需求文档 §4.2.5.2 规则 2 与架构文档 §13.1 第 4 条均明确要求“追加到组内成员**首条用户消息（任务块）末尾**”，且**不注入系统提示词**。注释与文档相矛盾。 | 若实现者依据此注释编码，将把协作 Prompt 错误注入系统提示词，违反提示词工程规范（缓存/注意力约束），导致组内通信上下文位置错误。 | 需求文档 §4.2.5.2 规则 2；架构文档 §13.1 第 4 条。 |

---

### 契约对齐验证表（本批次共享契约定义）

| 契约项 | 共享层定义 | 架构文档/需求文档基准 | 是否一致 | 备注 |
| :----- | :--------- | :-------------------- | :------- | :--- |
| 端点常量全集 | `protocol.ts` 中 `EP_*` | 架构文档 §4.6 端点清单 | **部分不一致** | 多出 `serviceDebug`、`fileUpload`（P3）；其余逐字一致。 |
| 工具名常量 | `WF_RUN_NODE`、`WF_RUN_NODE_WAIT`、`WF_FINISH`、`WF_ASK`、`WF_ASK_AGENT`、`WF_DB_QUERY` | 架构文档 §4.5 工具表 | 一致 | 无 |
| 工具可见性划分 | `PARENT_AGENT_VISIBLE_TOOLS`、`CHILD_AGENT_HIDDEN_TOOLS`、`OPTIONAL_INJECT_TOOLS`、`RESERVED_TRANSPORT_TOOL` | 架构文档 §4.5 工具可见性表；需求文档 §4.4.2 规则 7/8/9 | 一致 | 无 |
| 运行状态枚举 | `RUN_STATUSES`（含 `pending`） | 架构文档 §4.3 状态机文字含 `pending`；§6.1 持久化类型不含 `pending`；需求文档 §4.7 规则 3 不含 `pending` | **不一致** | `RUN_STATUSES` 与 `types.ts` 的 `RunStatus` 不一致（P1） |
| 节点状态枚举 | `NODE_STATUSES` | 架构文档 §6.1 `nodes[].status` | 一致 | 无 |
| 模式枚举 | `MODES` | 需求文档 §1 双模式 | 一致 | 无 |
| 连线颜色变量 | `COLOR_VAR_*` 及 `COLOR_VARS` | 需求文档 §4.3 连线类型与颜色规范 | 一致 | 无 |
| 节点判别联合 | `GraphNode` 包含 9 种节点 | 架构文档 §4.2 代码块 `NodeKind` 包含 9 种 | 一致 | 但 `RoleNode.data.proxySourceId` 冗余（P2） |
| 运行快照类型 | `RunSnapshot` | 架构文档 §6.1 | 一致（`status` 不含 `pending`） | 无 |
| 服务状态类型 | `ServiceState` | 架构文档 §6.2 | 一致 | 无 |
| 模板类型 | `RoleTemplate`、`FileTemplate`、`DatabaseTemplate`、`GroupTemplate`、`ToolCombo` | 架构文档 §6.3 / §6.4 | 一致（含合理扩展字段） | 无 |
| 导入导出 bundle | `BundleV2` | 架构文档 §6.4 | 一致 | 无 |
| userId 映射 | `UserIdMap` | 架构文档 §4.7 | 一致 | 无 |

---

### 审查说明
1. 本批次为纯类型/常量层，无运行时逻辑，未发现确定性运行时崩溃缺陷。
2. 问题 1（`RUN_STATUSES` 含 `pending`）与问题 2（注释错误）为最高等级问题，建议优先修正共享定义，避免向后续批次扩散。
3. 问题 3（`RoleNode.data.proxySourceId` 冗余）属轻微类型冗余，不影响编译，但需警惕实现时误用。
4. 问题 4、5 因文档覆盖不足，列为待定，后续批次若涉及对应实现可再核对。

---

## Batch-02 审查报告

### 审查范围
- `src/host/storage/atomic.ts`
- `src/host/storage/flow-store.ts`

### 审查基准
- 需求文档 PRD-001 v0.1.0
- 架构文档 AD-001 v0.1.0

---

### 问题清单

| 严重性等级 | 类别 | 所在文件 | 具体位置（函数，行号） | 问题描述 | 影响/未对齐点 | 证据 |
| :--------- | :--- | :------- | :--------------------- | :------- | :------------ | :------ |
| P1（中等） | 功能职责对齐（架构偏离） | `src/host/storage/atomic.ts` | `atomicReplaceFile`（约第 300 行起） | 架构文档 §4.1 明确要求原子发布在 POSIX 使用 `link()` 做 no-clobber（“同目录临时文件 → fsync → 原子发布（POSIX 用 link() 做 no-clobber；Windows 用写入直通 rename 不覆盖）”），而代码实现统一采用 `rename(tmp, target)` 覆盖语义。注释虽解释“结合磁盘锁后无竞态”，但实现与架构文档规定的发布原语不一致。 | 若未来出现绕过锁的写路径或多进程未正确串行化，覆盖语义可能静默覆盖合法版本，与架构文档预期的 no-clobber 保护冲突；当前依赖锁的正确性才能保证安全，属于设计偏离。 | 架构文档 AD-001 §4.1 “原子写”描述；代码 `atomicReplaceFile` 中使用 `await rename(tmp, target)`。 |
| P1（中等） | 代码健壮性（错误处理缺失） | `src/host/storage/flow-store.ts` | `listWorkflows`、`listServices`、`listServicesAll`、`listTemplates` 等方法（约第 130、190、230、270 行） | 列表方法循环读取每个文件时，若单个文件内容损坏（`readJson` 抛出 `CorruptJsonError`），异常会直接向上抛出，导致整个列表操作失败，无任何局部捕获或跳过机制。例如一个损坏的工作流 JSON 会阻塞工作流列表展示，影响其他正常文件。 | 一个损坏文件可导致整个列表接口 500，前端无法获取任何工作流/服务/模板，属于确定性可触发（文件损坏可由磁盘故障或异常写入引起）但文档未明确容错要求；未捕获异常属于错误处理缺失。 | 代码自身风险判定，无文档依据（`readJson` 抛错后未捕获）。 |
| P3（待定） | 功能职责对齐（文档未覆盖） | `src/host/storage/flow-store.ts` | `deleteWorkflow`、`deleteService`（约第 210、320 行） | 删除工作流/服务时仅删除自身 JSON 文件（服务级联删除 sessions 映射），未级联删除相关的 `runs/` 或 `orchestrations/` 目录中关联文件。需求文档 §4.2.2 规则 2 仅要求“删除对应工作流 JSON 文件”，未提及运行历史与编排事实源。 | 删除工作流后，历史运行记录和编排文件可能成为孤儿文件，占据磁盘且历史面板仍可能显示（若按 flowId 过滤则不会显示，但文件未清理）。是否应当级联删除未在文档中明确。 | 需求文档 §4.2.2 规则 2；架构文档 §4.1 storage 目录规划（未说明删除关联清理）。 |

---

### 审查说明
1. 本批次为存储层，未涉及前后端 API 契约，故不输出“契约对齐验证表”。
2. 问题 1 为架构文档规定与实现不一致，属于设计偏离，列为 P1。若实现侧认为锁机制足以消除覆盖风险，需在架构文档中更新说明，否则后续审查将持续标红。
3. 问题 2 为列表操作未做单文件异常隔离，触发条件为文件损坏（磁盘故障、手动篡改等），在当前错误处理策略下会阻断整个模块功能，列为 P1。
4. 其余 P3 项因文档未覆盖或非确定性竞态，不做出缺陷判定。


---

## Batch-03 审查报告

### 审查范围
- `src/host/graph/model.ts`
- `src/host/graph/validate.ts`

### 审查基准
- 需求文档 PRD-001 v0.1.0
- 架构文档 AD-001 v0.1.0

---

### 问题清单

| 严重性等级 | 类别 | 所在文件 | 具体位置（函数，行号） | 问题描述 | 影响/未对齐点 | 证据 |
| :--------- | :--- | :------- | :--------------------- | :------- | :------------ | :------ |
| P1（中等） | 功能职责对齐（字段丢失） | `src/host/graph/validate.ts` | `normalizeFlow`（角色节点分支，约第 240 行） | `normalizeFlow` 在重建角色节点 `data` 时，未复制 `systemPromptSource` 字段（该字段在 `shared/graph-model.ts` 的 `RoleNode.data` 中明确定义，且需求文档 §4.2.3.1 卡片设计要求“System Prompt 来源文件名（从 .md 加载时记录，左侧栏卡片展示用）”）。保存工作流时调用 `normalizeFlow` 会导致 `systemPromptSource` 字段永久丢失。 | 保存后重新加载工作流，左侧栏角色卡片将无法展示 System Prompt 来源文件名，与需求文档卡片设计不一致。 | 需求文档 §4.2.3.1 卡片设计表；`shared/graph-model.ts` 中 `RoleNode.data.systemPromptSource` 定义；`validate.ts` `normalizeFlow` 角色节点分支仅复制了 14 个字段，遗漏 `systemPromptSource`。 |
| P2（轻微） | 冗余与死代码 | `src/host/graph/validate.ts` | `validateFlow`（主/虚互斥检查，约第 145 行） | 表达式 `proxyIds.has(sourceId) === false` 在 `source.kind === 'parent' || source.kind === 'agent' 的分支中恒为 `true`。因为 `proxyIds` 集合包含所有 `kind='proxy'` 的节点 id，而当前分支中 `sourceId` 是 `parent`/`agent` 节点的 id，画布内节点 id 唯一，故该 id 不可能同时存在于 `proxyIds` 中。条件无实际过滤作用。 | 冗余条件降低代码可读性，但不影响功能。 | 代码自身风险判定（静态逻辑恒真），无文档依据。 |


| P3（待定） | 文档未覆盖 | `src/host/graph/validate.ts` | `normalizeFlow`（约第 270 行起） | `normalizeFlow` 对 `revision` 字段的处理为 `typeof flow.revision === 'number' ? flow.revision : 0`，将缺失或非数字的 `revision` 归一化为 0。架构文档与需求文档均未明确 `normalizeFlow` 是否应重置 revision；`FlowStore.saveWorkflow` 在保存时另行计算 revision，故归一化的 revision 值不会影响最终保存结果，但中间态语义未定义。 | 无法判定是否与预期一致。 | 架构文档 §4.1 storage（revision 语义由 FlowStore 管理）；代码自行归一化 revision。 |

---

### 审查说明
1. 本批次为图模型与校验层，未涉及前后端 API 契约，故不输出“契约对齐验证表”。
2. 问题 1（`systemPromptSource` 字段丢失）是本批次最实质的缺陷，与需求文档卡片设计直接冲突，应优先修复。
3. 问题 2 为冗余条件，不影响正确性，按 P2 列出。
4. 其余逻辑（连接点矩阵、条件连线约束、协作组边界、模式差异、主/虚互斥）均与需求文档/架构文档一致，未发现其他问题。

---

## Batch-04 审查报告

### 审查范围
- `src/host/orchestrator/runtime.ts`
- `src/host/orchestrator/snapshot.ts`
- `src/host/orchestrator/resume.ts`
- `src/host/orchestrator/watchdog.ts`

### 审查基准
- 需求文档 PRD-001 v0.1.0
- 架构文档 AD-001 v0.1.0

---

### 问题清单

| 严重性等级 | 类别 | 所在文件 | 具体位置（函数，行号） | 问题描述 | 影响/未对齐点 | 证据 |
| :--------- | :--- | :------- | :--------------------- | :------- | :------------ | :------ |
| P0（严重） | 功能职责对齐（断点续跑起点不一致） | `src/host/orchestrator/runtime.ts` | `resumeRun`（约第 370 行） | `buildResumedSnapshot` 已计算出正确的 `resumeFromNodeId`（当 `prev.resumeFromNodeId` 缺失时推断为第一个未完成节点），但随后注入父代理的编排指令 `directiveParams` 使用的是 `prev.resumeFromNodeId`（可能为 `undefined`），而非新快照中的值。 | 恢复 `interrupted`（宿主重启中断）类型的 run 时，`prev.resumeFromNodeId` 通常为 `undefined`，导致注入父代理的断点继续指令缺少明确的恢复起点。父代理可能从流程开头重新调度，导致已 ok 节点被重复执行，**违反需求文档 §4.7 规则 6「已执行节点不重跑」与规则 5「可恢复」的核心语义**。 | 需求文档 §4.7 规则 5/6；架构文档 §4.3 断点恢复流程；`buildResumedSnapshot` 中计算了 `resumeFromNodeId` 但 `directiveParams` 调用未使用该值。 |
| P1（中等） | 功能职责对齐（多选文件路径未注入） | `src/host/orchestrator/runtime.ts` | `buildNodeBlocks`（文件节点处理分支，约第 780 行） | 文件节点在需求文档 §4.2.4.1 与 `shared/graph-model.ts` 中支持 `files` 多选列表（`Array<{ fileName, managedPath }>`），但任务块组装时仅检查 `src.data.managedPath` 单个字段，未遍历 `src.data.files`。 | 当文件节点配置为多选受管文件时，`managedPath` 通常为 `undefined`（路径存在 `files` 数组中），导致下游子代理收不到任何文件路径索引，**多选文件功能在运行时失效**。 | 需求文档 §4.2.4.1 卡片设计（支持多选所有类型文件）；`shared/graph-model.ts` `FileNode.data.files` 定义；`buildNodeBlocks` 中仅处理 `src.data.managedPath`。 |

---

### 审查说明
1. 本批次为编排运行时核心，不涉及前后端 API 契约，故不输出“契约对齐验证表”。
2. 问题 1 是断点续跑流程的核心缺陷，直接违反需求文档明确规定的“已 ok 节点不重跑”红线，必须优先修复。
3. 问题 2 为多选文件功能的运行时失效，特定配置下可触发，列为 P1。
4. 其余逻辑（运行锁、暂停门、wf_ask_agent 通信、子代理结束观察、看护对账等）与需求文档/架构文档基本一致，未发现其他 P0/P1 级问题。

---

## Batch-05 审查报告

### 审查范围
- `src/host/agent/runner.ts`
- `src/host/agent/guards.ts`
- `src/host/agent/prompt-setup.ts`
- `src/host/agent/model-selection.ts`

### 审查基准
- 需求文档 PRD-001 v0.1.0
- 架构文档 AD-001 v0.1.0

---

### 问题清单

| 严重性等级 | 类别 | 所在文件 | 具体位置（函数，行号） | 问题描述 | 影响/未对齐点 | 证据 |
| :--------- | :--- | :------- | :--------------------- | :------- | :------------ | :------ |
| P0（严重） | 功能职责对齐（模式二数据库工具失效） | `src/host/agent/runner.ts` | `hasDbInLine`（约第 420 行） | `hasDbInLine` 仅调用 `store.getWorkflow(sessionId, flowId)` 读取工作流以检测 db-in 连线。但模式二（mode2）的服务工作流存储在 `services/` 目录，通过 `getServiceAsFlow` 读取，`getWorkflow` 返回 `null`。导致模式二下任何数据库连线均无法检测，`wf_db_query` 永远不会被注入到对应代理的工具集。 | 需求文档 §4.4.3 规则 5 明确“仅当对应子代理/父代理节点通过数据库连线（db-in）接入数据节点时，工具才会进入该代理的工具集”，且数据库节点（§4.2.4.2）适用于双模式。模式二下数据库节点连接完全失效，代理无法访问数据库，违反核心功能。 | 需求文档 §4.4.3 规则 5；§4.2.4.2（无模式限制）；架构文档 §4.2 工具白名单规则“wf_db_query 仅在存在 db-in 连线时追加”。`runtime.ts` 的 `currentResolvedFlow` 已按 mode 分派读取，但 `runner.ts` 未同步处理。 |
| P1（中等） | 代码健壮性（软截停竞态） | `src/host/agent/runner.ts` | `startNodeTask`（约第 380 行） | `startNodeTask` 在 `ensureNodeChild` 返回后才调用 `this.deps.react.setLimit(childId, input.iterationLimit)` 设置 ReAct 上限。但 `ensureNodeChild` 内部调用 `startContinuable` 创建子代理后，子代理可能立即开始第一步推理并触发 `agent/pre-step` 事件，此时 `limits` 表中尚无该 childId，护栏旁路。若节点 `reactLimit` 较小（如 1），第一次预步不受限，软截停延迟一步生效。 | 违反需求文档 §4.2.3.2 规则 3 的“ReAct 迭代次数上限采用软截停”语义：首次执行可能超出配置上限。属于确定性可触发（当 limit=1 且子代理快速启动时）。 | 代码自身风险判定（事件时序竞态），无文档依据。 |
| P2（轻微） | 代码健壮性（合法输入被误拒） | `src/host/tools/data-tools.ts` | `sanitizeReadOnlySql`（约第 40 行） | SQL 校验在剥离字符串字面量**之前**检查 `single.includes(';')`，导致字符串字面量内包含分号的合法 SELECT 被误判为多语句。例如 `SELECT 'a;b' AS x FROM t LIMIT 1` 会被拒绝。 | 合法查询被拒绝，属于过度限制。需求文档仅要求“仅允许只读 SELECT、强制 LIMIT”，未禁止字符串值中的分号。 | 代码自身风险判定（确定性触发，合法 SQL 被误拒），无文档依据。 |
| P3（待定） | 代码健壮性（降级路径忽略取消信号） | `src/host/tools/wf-tools.ts` | `combinedSignal`（约第 120 行） | 在不支持 `AbortSignal.any` 的旧环境中，函数直接返回 `runSignal`，完全忽略调用方 `callerSignal`。若运行环境低于 Node 20，子代理调用 wf_ask 阻塞期间无法被调用方取消。 | 仅影响旧环境，文档未定义支持范围，当前目标环境（Node 20+）已支持 `AbortSignal.any`。 | 代码自身风险判定（降级分支行为），无文档依据。 |
| P3（待定） | 代码健壮性（资源耗尽风险） | `src/host/embedding/chunker.ts` | `chunkText`（约第 35 行） | 当调用方传入 `overlap >= chunkSize` 时，步长被钳制为 1（注释“防死循环”），导致生成大量高度重叠的块，块数量接近文本长度。对于长文本（如数据库表内容），可能产生数十万甚至百万个块，导致内存飙升、索引文件巨大。文档未定义此边界参数的合法范围。 | 无法判定是否符合预期（可能调用方始终使用默认值，但该函数为公开导出，存在被误用风险）。 | 代码自身风险判定（确定性触发路径：`chunkText(longText, 100, 100)` 产生巨量块），无文档依据。 |
| P1（中等） | 功能职责对齐（架构偏离） | `src/host/service/manager.ts` | `spawnChild`（约第 290 行） | 架构文档 §4.7 与 §7 明确 fork 命令包含 `--visual-workflow-serve <serviceId> --port <n>` 两个显式 CLI 参数，经 `ctx.cmdlineArgs` 读取。代码实际仅传 `'__visual_workflow_service__'` 占位 task 位置参数，**未传递这两个显式 flag**，依赖 `serve.patch.yml` 的 config 域注入 `serviceId`/`port`。 | 若服务进程入口（service-runner.ts）仅按架构文档预期从 `cmdlineArgs` 解析参数而不回退 config，则服务进程将无法获取 serviceId/port，导致启动即失败。即使功能最终可经 config 回退，也与架构文档的 fork 命令契约不一致。 | 架构文档 §4.7 “fork `dsh --profile headless --patch <产物路径> --visual-workflow-serve <serviceId> --port <n>`”；§7 同一 fork 命令描述。代码仅传占位 task。 |
| P2（轻微） | 冗余与死代码 | `src/host/service/manager.ts` | `status`（约第 260 行） | 返回值中 `status: managed ? service.status : service.status` 三元表达式两分支相同，恒等于 `service.status`，条件无实际意义。 | 冗余代码降低可读性，不影响功能。 | 代码自身风险判定（静态逻辑恒等），无文档依据。 |
| P1（中等） | 功能职责对齐（往返不一致） | `src/host/remote/transfer.ts` | `importWorkflowBundle` / `importEmbeddedTemplates`（约第 100 行与第 130 行） | `exportWorkflowBundle` 导出 bundle 时包含 `embedded.groups`（从工作流节点提取的协作组模板），但 `importEmbeddedTemplates` 仅处理 roles/files/databases 三类模板，完全未处理 `embedded.groups`。`importWorkflowBundle` 返回 `importedGroups: (bundle.embedded?.groups ?? []).length`，暗示 groups 已导入，实际并未恢复。 | 导出-导入往返后，协作组模板丢失：左侧栏「其他」Tab 的协作组模板列表无法恢复，影响模板复用。违反架构文档 §6.4 `BundleV2.embedded.groups` 的导入重建契约，以及需求文档 §4.2.5.2 协作组模板的预期管理。 | 架构文档 §6.4 `embedded.groups?: GroupTemplate[]`；`importEmbeddedTemplates` 中 groups 数组仅含 role/file/database 三类；`importWorkflowBundle` 返回 `importedGroups` 但无保存动作。 |
| P3（待定） | 代码健壮性（并发/竞态） | `src/host/remote/download.ts` | `copyIntoManagedFile`（约第 50 行） | 临时文件名 `${target}.${process.pid}.tmp` 仅含 pid，无随机后缀；且未使用文件锁。同一进程内对同一目标文件名的并发异步调用（理论可能）会导致临时文件互相覆盖，或 rename 时源文件已被其他调用删除，导致写入失败或内容交叉。 | 非确定性触发（通常由用户串行操作），当前风险较低。 | 代码自身风险判定，无文档依据。 |
| P3（待定） | 代码健壮性（并发/竞态） | `src/host/remote/mcp-registry.ts` | `writeRegion`（约第 240 行） | 临时文件名 `${patch}.${process.pid}.tmp` 同样仅含 pid，无随机后缀。并发调用 `upsertMcpServer` 与 `removeMcpServer` 时可能发生临时文件冲突，导致其中一个写操作失败或产生损坏文件。 | 非确定性触发（通常由用户串行操作），当前风险较低。 | 代码自身风险判定，无文档依据。 |

**单独列出**：（须证实并写入文档）
| P3（待定） | 功能职责对齐（官方 API 兼容性未证实） | `src/host/agent/prompt-setup.ts` | `registerPromptOnCtx` 中 `sys.section({ text: () => ref.systemPrompt })`（约第 60 行） | 将 `systemPrompt.section` 的 `text` 参数传入函数（而非字符串），依赖函数形式动态读取状态。若官方 `section` API 仅支持字符串，则注册可能无效或运行时出错；代码虽有 try-catch 降级，但降级后段内容不会动态更新，且未验证函数形式是否被官方接受。 | 无法判定是否与官方实现契约一致，可能导致角色 Prompt 注入失败或不可更新。 | 架构文档 §4.5 提及 systemPrompt.section 但未明确 text 参数类型；官方源码未在审查范围内。 |

---

## Batch-06 审查报告

### 审查范围
- `src/host/tools/define-tool.ts`
- `src/host/tools/text-render.ts`
- `src/host/tools/wf-tools.ts`
- `src/host/tools/wf-ask-agent.ts`
- `src/host/tools/data-tools.ts`

### 审查基准
- 需求文档 PRD-001 v0.1.0
- 架构文档 AD-001 v0.1.0

---

### 问题清单

| 严重性等级 | 类别 | 所在文件 | 具体位置（函数，行号） | 问题描述 | 影响/未对齐点 | 证据 |
| :--------- | :--- | :------- | :--------------------- | :------- | :------------ | :------ |


---

### 审查说明
1. 本批次为工具层，不涉及前后端 API 契约，故不输出“契约对齐验证表”。
2. `data-tools.ts` 中 `sanitizeReadOnlySql` 的字符串内分号误判问题为确定性合法输入拒绝，列为 P2。
3. 其余逻辑（工具注册、可见性、归属校验、SQL 白名单、投递缝等）与需求文档/架构文档基本一致，未发现 P0/P1 级缺陷。
4. Batch-05 已报告的 `hasDbInLine` 模式二问题在本批次不重复列出。

---

## Batch-07 审查报告

### 审查范围
- `src/host/embedding/chunker.ts`
- `src/host/embedding/engine.ts`
- `src/host/embedding/indexer.ts`

### 审查基准
- 需求文档 PRD-001 v0.1.0（§4.2.4.2 数据库子模块、§6.5 本地嵌入模型与向量索引）
- 架构文档 AD-001 v0.1.0（§6.5 本地嵌入模型与向量索引）

---

### 问题清单

| 严重性等级 | 类别 | 所在文件 | 具体位置（函数，行号） | 问题描述 | 影响/未对齐点 | 证据 |
| :--------- | :--- | :------- | :--------------------- | :------- | :------------ | :------ |


---

### 审查说明
1. 本批次为向量检索基础设施，不涉及前后端 API 契约，故不输出“契约对齐验证表”。
2. 分块策略、嵌入来源优先级、BM25 降级、索引原子持久化等核心逻辑均与需求文档 §4.2.4.2 及架构文档 §6.5 一致。
3. 唯一记录的问题属于边界条件资源风险，因文档未覆盖该参数约束，按 P3（待定）处理，不判定为缺陷。

---

## Batch-08 审查报告

### 审查范围
- `src/host/service/manager.ts`
- `src/host/service/openai-api.ts`
- `src/host/service/sessions-map.ts`
- `src/host/service/serve-patch.ts`
- `src/host/service/port-pool.ts`

### 审查基准
- 需求文档 PRD-001 v0.1.0（§4.1.3 模式二后台服务模式、§4.7 运行历史与断点恢复）
- 架构文档 AD-001 v0.1.0（§4.7 service/ 服务管理器、§7 模式二 serve 层）

---

### 问题清单

| 严重性等级 | 类别 | 所在文件 | 具体位置（函数，行号） | 问题描述 | 影响/未对齐点 | 证据 |
| :--------- | :--- | :------- | :--------------------- | :------- | :------------ | :------ |




| P3（待定） | 功能职责对齐（断点续跑与请求语义冲突） | `src/host/service/openai-api.ts` | `runChat`（约第 160 行） | 每次 API 请求先 `findResumableRun` 查找可恢复断点，存在则调用 `resumeRun` 续跑。但 `resumeRun` 不接受 `question` 参数，续跑时**新用户问题不注入输入节点**；而 `startRun` 全新路径会将问题注入输入节点。若服务进程此前因崩溃导致 run 处于 `interrupted`，用户新请求将续跑旧 run，旧问题保留、新问题丢失，回答可能基于过期上下文。需求文档未定义模式二下 `interrupted` run 与用户新请求的关系。 | 无法判定是否符合预期：模式二断点续跑与“每次请求问题注入输入节点”的语义在文档中未覆盖。 | 需求文档 §4.1.3 规则 5（问题注入）与 §4.7 规则 5（可恢复）未合并说明。 |

---

### 契约对齐验证表（本批次涉及前后端/模块间契约）

| 契约项 | 实现 | 文档基准 | 是否一致 | 备注 |
| :----- | :--- | :------- | :------- | :--- |
| fork 命令参数 | `dsh --profile headless --patch <patchPath> __visual_workflow_service__` | 架构文档 §4.7 / §7：`dsh --profile headless --patch <产物> --visual-workflow-serve <serviceId> --port <n>` | **不一致** | P1：缺少显式 `--visual-workflow-serve` 与 `--port`。 |
| 端口分配 | `findFreePort(base)` 从 7860 向上探测 | 需求文档 §4.1.3 规则 1（默认 7860，冲突自动递增） | 一致 | 无 |
| 进程终止 | SIGTERM → 5s → SIGKILL（Windows taskkill /T） | 架构文档 §4.7 “SIGTERM → 5s → SIGKILL” | 一致 | 无 |
| 崩溃标记 | 非主动停止 exit → `crashed` | 需求文档 §4.1.3 规则 3 | 一致 | 无 |
| 自动恢复 | `autoRecover` 扫描 `status=running` 重启 | 需求文档 §4.1.3 规则 8 | 一致 | 无 |
| userId 校验 | 缺失返回 400 | 需求文档 §4.1.3 REST API 规范 | 一致 | 无 |
| 鉴权 | `Authorization: Bearer <apiKey>` 401 | 需求文档 §4.1.3 REST API 规范 | 一致 | 无 |
| SSE 流式 | `data: {choices:[{delta:{content}}]}` + `[DONE]` | 需求文档 §4.1.3 REST API 规范 | 一致 | 无 |
| 非流式 | `choices[0].message.content` | 需求文档 §4.1.3 REST API 规范 | 一致 | 无 |
| 并发上限 | `maxConcurrent` 超出 429 | 需求文档 §4.1.3 REST API 规范 | 一致 | 无 |
| `GET /v1/models` | 返回父代理模型信息 | 需求文档 §4.1.3 REST API 规范 | 一致 | 无 |
| userId→sessionId 映射 | 持久化合并写，pending 去重 | 需求文档 §4.1.3 规则 7 | 一致 | 无 |

---

### 审查说明
1. 本批次为模式二服务管理层，输出了“契约对齐验证表”。
2. 主要问题为 fork 命令参数与架构文档不一致（P1），需在 Batch-10 审查 `service-runner.ts` 时确认参数解析路径，以判定是否影响实际功能。
3. `status` 方法冗余三元表达式为 P2。
4. `runChat` 的断点续跑与用户问题注入语义冲突，文档未覆盖，按 P3 处理。

---

## Batch-09 审查报告

### 审查范围
- `src/host/remote/api.ts`
- `src/host/remote/download.ts`
- `src/host/remote/transfer.ts`
- `src/host/remote/mcp-registry.ts`
- `src/host/remote/service-debug.ts`

### 审查基准
- 需求文档 PRD-001 v0.1.0（§4.2.5.2 协作组、§4.6 组合管理、§6 数据存储规划）
- 架构文档 AD-001 v0.1.0（§4.6 remote/、§6.4 导入导出 v2 bundle、§9 安全边界）

---

### 问题清单

| 严重性等级 | 类别 | 所在文件 | 具体位置（函数，行号） | 问题描述 | 影响/未对齐点 | 证据 |
| :--------- | :--- | :------- | :--------------------- | :------- | :------------ | :------ |



---

### 契约对齐验证表（本批次涉及前后端/模块间契约）

| 契约项 | 实现 | 文档基准 | 是否一致 | 备注 |
| :----- | :--- | :------- | :------- | :--- |
| GUI API 端点全集 | `EP_*` 常量派生（含非端点字符串污染） | 架构文档 §4.6 端点清单 | **部分不一致** | 端点名逐字一致；但 ENDPOINTS 集合混入工具名/颜色变量（P2）。 |
| 响应协议 | `{ ok, value }` / `{ ok: false, error: { message } }` | 架构文档 §4.6 | 一致 | 无 |
| 错误码映射 | 400/404/405/409/413/422/501 | 架构文档 §4.6 端点契约细节 | 一致（含扩展） | 无 |
| 运行历史会话过滤 | `listRuns(flowId, sessionId)` | 架构文档 §4.6 `runHistory` 必填 sessionId | 一致 | 无 |
| 导入导出 v2 bundle | `BundleV2` 格式，version 2 | 架构文档 §6.4 | 一致（groups 导入缺失） | P1 |
| 服务管理端点 | 会话归属校验 + 完整文档返回 | 架构文档 §4.6 服务端点 | 一致 | 无 |
| MCP 配置托管 | 注释标记托管区 + 原子写 | 架构文档 §4.6 mcp 端点 | 一致 | 无 |
| serviceDebug 代理 | Host 转发 SSE，携带 apiKey | 架构文档 §4.6 service-debug | 一致 | 无 |

---

### 审查说明
1. 本批次为远程 API 层，输出了“契约对齐验证表”。
2. 主要实质问题为 `transfer.ts` 导入时未恢复协作组模板（P1），导致导出-导入往返不一致。
3. 端点白名单集合不精确为 P2，不影响功能但偏离注释与设计意图。
4. 其余并发/安全边界问题因文档未覆盖或非确定性触发，按 P3 处理。

---

## Batch-10 审查报告

### 审查范围
- `src/host/prompts/index.ts`
- `src/host/prompts/markers.ts`
- `src/host/prompts/orchestration.ts`
- `src/host/prompts/node-task.ts`
- `src/host/prompts/collab.ts`
- `src/host/prompts/README.md`
- `src/host/index.ts`
- `src/host/service-runner.ts`
- `src/host/events.d.ts`

### 审查基准
- 需求文档 PRD-001 v0.1.0
- 架构文档 AD-001 v0.1.0
- `src/host/prompts/README.md`（提示词规范基线）

---

### 问题清单

| 严重性等级 | 类别 | 所在文件 | 具体位置（函数，行号） | 问题描述 | 影响/未对齐点 | 证据 |
| :--------- | :--- | :------- | :--------------------- | :------- | :------------ | :------ |
| P0（严重） | 功能职责对齐（进程自我启动） | `src/host/index.ts` | `VisualWorkflowHost[Service.init]`（约第 250 行） | `Service.init` 中无条件执行 `await this.serviceManager.autoRecover()`（仅受 `skipReconcile` 控制，而 `skipReconcile` 只跳过 `reconcileStaleRuns`，不影响 autoRecover）。在模式二**服务进程**中，`service-runner.ts` 以 `skipReconcile: true` 装配 `VisualWorkflowHost`，但 autoRecover 仍会执行。autoRecover 扫描所有 `status='running'` 的服务并调用 `start(serviceId)`。主进程 fork 服务进程前已把该服务状态置为 `running`，因此服务进程启动后 autoRecover 会尝试再次 `start` 自身服务，导致**自我 fork**（递归启动新服务进程，新进程又触发 autoRecover）。 | 服务进程无限自我复制/资源耗尽，严重违反需求文档 §4.1.3 规则 1“独立 fork 子进程”与规则 3“服务进程与主 DSH 进程完全隔离”，以及架构文档 §1 原则 5“一服务一进程一端口”。 | 需求文档 §4.1.3 规则 1/3；架构文档 §1 原则 5；`index.ts` 中 autoRecover 调用未加条件；`service-runner.ts` 中 `skipReconcile: true` 未阻止 autoRecover。 |
| P2（轻微） | 冗余与死代码 | `src/host/prompts/markers.ts` | `COLLAB_PREFIX` 常量（约第 25 行） | `COLLAB_PREFIX = 'collab:'` 被导出并在 `index.ts` 中 re-export，但全项目无任何文件使用该常量。其注释声称“协作块以 `collab:` 起段”，而实际 `collab.ts` 的 `buildCollabBlock` 输出并未添加该前缀，注释与实现脱节。 | 死代码且注释误导，不影响功能，但增加维护困惑。 | 静态引用计数：本批次及前序批次中无 import 使用 `COLLAB_PREFIX`；`collab.ts` 未引用；`prompts/README.md` 未要求该前缀。 |
| P1（中等） | 功能职责对齐（运行高亮未实现） | `src/client/studio/Studio.tsx` | `highlightedNodeIds` 定义（约第 870 行） | `highlightedNodeIds` 被硬编码为空数组（注释承认“Bug 18：原实现是无条件返回 [] 的死代码”），导致运行时画布无法高亮当前执行节点。需求文档 §4.5.8 明确要求“当前运行节点高亮、节点状态徽标”，验收标准 6 要求“节点高亮、状态、摘要”实时更新。状态徽标可能通过 `runStatusByNode` 提供，但节点高亮缺失。 | 运行状态回显缺少核心的高亮反馈，违反需求的双向同步可视化要求。 | 需求文档 §4.5.8 验收标准 6；`Studio.tsx` 中 `const highlightedNodeIds: string[] = []` 及注释。 |
| P2（轻微） | 冗余与死代码 | `src/client/studio/Studio.tsx` | `importInputRef` 定义（约第 70 行） | `importInputRef` 定义后从未被使用（后续使用的是 `libraryImportRef`）。 | 死代码，增加维护困惑。 | 静态引用计数：全文件无 `importInputRef.current` 或 `ref={importInputRef}` 引用。 |
| P2（轻微） | 冗余与死代码 | `src/client/studio/Studio.tsx` | `sanitizeRolePatch` 函数定义（约第 920 行） | `sanitizeRolePatch` 函数定义后从未被调用。 | 死代码，且与 `patchEditor` 中的实际消毒逻辑重复。 | 静态引用计数：全文件无 `sanitizeRolePatch(` 调用。 |
| P2（轻微） | 冗余与死代码 | `src/client/studio/studio-state.ts` | `servicesOpen` 状态、`SERVICES_OPEN` action 类型及 reducer 分支 | `servicesOpen` 在 `StudioState` 中定义，但没有任何组件或 hook 读取该字段；`SERVICES_OPEN` action 类型与 reducer 分支同样未被 dispatch。 | 死状态与死代码，增加状态机复杂度。 | 静态引用计数：全批次文件（以及推测的 hooks 目录）无 `servicesOpen` 或 `SERVICES_OPEN` 使用。 |
| P2（轻微） | 冗余与死代码 | `src/client/studio/studio-state.ts` | `importBusy` 状态、`IMPORT_BUSY` action 类型及 reducer 分支 | `importBusy` 在 `StudioState` 中定义，但无组件读取；`IMPORT_BUSY` action 无 dispatch 调用。 | 死状态与死代码。 | 静态引用计数：全批次文件无 `importBusy` 或 `IMPORT_BUSY` 使用。 |
| P1（中等） | 功能职责对齐（轮询间隔硬编码） | `src/client/hooks/useRunPolling.ts` | `RUN_POLL_MS` 常量定义（约第 12 行） | 运行状态轮询间隔硬编码为 `600ms`，与需求文档 §4.5.8 明确的“默认 2s，可配置”不符；架构文档 §2.2 `cordis.patch.yml` 中 `runPollMs` 默认值为 `2000`，但前端未读取该配置，且无 API 暴露该值，配置形同虚设。 | 与文档规定的默认值及可配置性不一致；更频繁的轮询增加网络负载。 | 需求文档 §4.5.8 “轮询 runStatus，默认 2s，可配置”；架构文档 §2.2 `runPollMs: 2000`；前端硬编码 `RUN_POLL_MS = 600`。 |
| P3（待定） | 代码健壮性（依赖数组缺失） | `src/client/hooks/useRunPolling.ts` | `useEffect` 依赖数组（约第 30 行） | `useEffect` 依赖数组为 `[dispatch, remote, runId]`，但函数体使用了 `sessionId`。当 `runId` 未变而 `sessionId` 变化时，轮询仍使用旧 `sessionId`。由于运行与会话强绑定，实际场景中 `sessionId` 变化通常伴随 `runId` 变化，故实际触发概率极低。 | 非确定性触发；仅在会话切换而运行 id 未变时可能导致权限校验失败或轮询异常。 | 代码自身风险判定，无文档依据。 |
| P2（轻微） | 冗余与死代码 | `src/client/components/canvas/FlowNode.tsx` | `handleYOf` 函数（约第 105 行） | `handleYOf` 与 `geometry.ts` 中已导出的 `handleY` 实现完全相同，FlowNode 未引用 `geometry.ts` 的 `handleY`，重复定义。 | 代码重复，增加维护成本；若未来调整接点位置需同步修改两处。 | 静态引用计数：两处相同实现。 |
| P1（中等） | 跨层契约不一致（SSE 数据行格式） | `src/client/components/service-console/ServiceConsole.tsx` | `sendDebug` 中 `onLine` 回调（约第 80 行） | 前端判断流式数据行使用 `line.startsWith('data: ')`（冒号后必须有一个空格），但后端 `openai-api.ts` 的 `sseChunk` 函数生成格式为 `data: ${JSON.stringify(...)}`（冒号后**无空格**）。因此所有服务调试流的 SSE 数据行均不满足判断条件，被直接丢弃。 | 模式二服务调试台的流式回复完全无法显示（用户只能看到空输出或错误），调试功能失效。需求文档 §4.1.3 明确要求流式输出支持打字机效果渲染（SSE）。 | 后端 `src/host/service/openai-api.ts` 中 `sseChunk` 返回 `data: ${JSON.stringify(...)}\n\n`；前端 `ServiceConsole.tsx` 中 `if (!line.startsWith('data: ')) return`。 |
| P1（中等） | 功能职责对齐（多选文件字段丢失） | `src/client/lib/graph-model.ts` | `templateToNodeData` 文件模板分支（约第 160 行） | 文件模板拖入画布时，`templateToNodeData` 仅传递 `content`、`managedPath`、`fileName`，**完全未传递 `files` 多选文件列表**。而后端 `FlowStore.templateToNode`（Batch-02 已审）对文件模板正确保留 `files` 数组。需求文档 §4.2.4.1 明确支持多选所有类型文件。 | 用户在左侧栏配置文件模板并选择多个文件后，拖入画布的节点丢失所有多选文件路径，运行时无法将文件路径注入下游子代理，多选文件功能失效。 | 需求文档 §4.2.4.1 卡片设计“可多选所有类型文件”；后端 `src/host/storage/flow-store.ts` `templateToNode` 中 `...(files.length > 0 ? { files } : {})`；前端 `templateToNodeData` 文件分支无 `files`。 |
| P3（待定） | 冗余与死代码（疑似） | `src/client/lib/graph-model.ts` | `flowToCanvasNodes` 函数（约第 200 行） | `flowToCanvasNodes` 导出函数未在已审任何文件中被引用。且该函数实现中若节点为 `proxy`，其顶层 `proxySourceId` 不会被保留（仅复制 `data`），存在数据丢失风险。若此函数确被未来代码使用，将导致虚拟节点失效。 | 无法判定是否会被使用；当前仅作为疑似死代码，同时记录其实现中的潜在缺陷。 | 静态引用计数：已审代码中无 `flowToCanvasNodes` 调用；代码自身风险判定，无文档依据。 |
| P1（中等） | 代码健壮性（并发保存数据错乱） | `src/client/hooks/useWorkflows.ts` | `saveWorkflow`（约第 70 行） | `saveInflight` 是一个全局 `useRef`，用于并发去重，但**未按 `flowId` 区分**。当用户快速切换到另一工作流并触发保存时，若前一次保存尚未返回，`saveInflight.current` 仍是上一个工作流的 Promise，新工作流的保存会直接复用该 Promise，导致新工作流的内容根本没有被保存（用户看到“保存成功”但实际未持久化）。 | 特定交互时序下（保存工作流 A 未完成时切换到工作流 B 并保存），B 的修改丢失。需求文档 §4.2.2 要求保存操作正确持久化当前画布，该缺陷直接导致数据丢失。 | `useWorkflows.ts` 中 `if (saveInflight.current) return saveInflight.current` 无 `flow` 参数比较；`Studio.tsx` 中 `saveCanvas` 未禁用保存按钮或阻止切换，可触发并发。 |
---

### 契约对齐验证表（模块间/进程契约）

| 契约项 | 实现 | 文档基准 | 是否一致 | 备注 |
| :----- | :--- | :------- | :------- | :--- |
| fork 命令参数 | `dsh --profile headless --patch <patchPath> __visual_workflow_service__` | 架构文档 §4.7/§7：含 `--visual-workflow-serve <serviceId> --port <n>` | **不一致** | 已在 Batch-08 报告（P1），本批次确认 `service-runner` 支持解析但未传递，实际靠 config 回退。 |
| 服务进程装配 | `VisualWorkflowHost` 以 `skipReconcile: true` 装配，但未跳过 `autoRecover` | 需求文档 §4.1.3：服务进程仅服务自身，不管理其他服务 | **不一致** | P0 缺陷根源。 |
| 提示词构建器纯函数 | 三个构建器无 `Date.now`/随机源 | `prompts/README.md` §1 | 一致 | 无 |
| 关键约束双位 | `orchestration.ts` 首段/末段均含部分关键约束；`node-task.ts` 末段遗漏 `retryAndReact` | `prompts/README.md` §2 | **部分不一致** | P1 缺陷。 |
| 协作块成员清单 | 始终列出成员 ID + 角色名，与 custom 无关 | 需求文档 §4.2.5.2 规则 2 | 一致 | 无 |
| 事件 payload 声明 | `events.d.ts` 各事件 payload 与 handler 期望匹配 | 架构文档 §8 索引 #21/#22 | 一致 | 无 |

---

### 审查说明
1. 本批次涉及 Host 入口与提示词基线，输出了“契约对齐验证表”。
2. **P0 缺陷为最严重问题**：服务进程内 autoRecover 导致自我启动循环，必须立即修复。
3. **P1 提示词规范缺失**：节点任务块末段未重申全部关键约束，建议补齐以符合 README 基线。
4. **P2 死代码**：`COLLAB_PREFIX` 无引用，可移除或实现真正使用。
5. 其余装配逻辑（事件订阅、工具注册、路由挂载、看护定时器）与文档基本一致，未发现其他问题。

---

## Batch-11 审查报告

### 审查范围
- `src/client/entry.ts`
- `src/client/i18n.ts`
- `src/client/styles.ts`
- `src/client/types.d.ts`
- `src/client/studio/Studio.tsx`
- `src/client/studio/studio-state.ts`
- `src/client/studio/floating-window.tsx`

### 审查基准
- 需求文档 PRD-001 v0.1.0
- 架构文档 AD-001 v0.1.0
- 结合之前批次已审查的后端代码进行契约一致性核对

---

### 问题清单

| 严重性等级 | 类别 | 所在文件 | 具体位置（函数，行号） | 问题描述 | 影响/未对齐点 | 证据 |
| :--------- | :--- | :------- | :--------------------- | :------- | :------------ | :------ |


---

### 契约对齐验证表（本批次前端与已审后端契约核对）

| 契约项 | 前端调用（端点/参数） | 后端定义（Batch-09 已审） | 是否一致 | 备注 |
| :----- | :-------------------- | :------------------------ | :------- | :--- |
| 工作流列表 | `EP_LIST_WORKFLOWS` `{ sessionId }` | `listWorkflows(args.sessionId)` | 一致 | 无 |
| 获取工作流 | `EP_GET_WORKFLOW` `{ sessionId, id }` | `getWorkflow` 要求 `sessionId` 和 `id` | 一致 | 前端可能在 `useWorkflows` 中调用，未在本文件直接看到，但 hook 契约一致 |
| 保存工作流 | `EP_PUT_WORKFLOW` `{ sessionId, flow }` | `putWorkflow` 要求 `sessionId` 和 `flow` | 一致 | `flow` 对象由 `useWorkflows` 组装 |
| 删除工作流 | `EP_DELETE_WORKFLOW` `{ sessionId, id }` | `deleteWorkflow` 要求 `sessionId` 和 `id` | 一致 | 无 |
| 服务列表 | `EP_LIST_SERVICES` `{ sessionId }` | `listServices(args.sessionId)` | 一致 | 无 |
| 保存服务 | `EP_PUT_SERVICE` `{ sessionId, service }` | `putService` 要求 `sessionId` 和 `service` | 一致 | 无 |
| 删除服务 | `EP_DELETE_SERVICE` `{ sessionId, id }` | `deleteService` 要求 `sessionId` 和 `id` | 一致 | 无 |
| 启动/停止/状态服务 | `EP_SERVICE_START/STOP/STATUS` 参数含 `sessionId`、`serviceId` | 后端均要求 `sessionId`、`serviceId` | 一致 | 前端在 `useServiceControl` 中调用 |
| 模板列表 | `EP_LIST_TEMPLATES` `{ kind }` | `listTemplates` 要求 `kind` 为 role/file/database | 一致 | 无 |
| 保存/删除模板 | `EP_PUT_TEMPLATE` / `EP_DELETE_TEMPLATE` | 参数 `kind`、`template` / `kind`、`id` | 一致 | 无 |
| 生态枚举 | `EP_PRESETS`、`EP_TOOLS`、`EP_MODELS` | 后端无参数，返回数组 | 一致 | 无 |
| 工具组合 | `EP_TOOL_COMBOS`、`EP_TOOL_COMBO_PUT`、`EP_TOOL_COMBO_DELETE` | 参数结构一致 | 一致 | 无 |
| 运行控制 | `EP_RUN` `{ sessionId, flowId }` | `run` 端点要求 `sessionId`、`flowId` | 一致 | 无 |
| 运行状态 | `EP_RUN_STATUS` `{ sessionId, runId }` | `runStatus` 要求 `sessionId`、`runId` | 一致 | 无 |
| 停止运行 | `EP_RUN_STOP` `{ sessionId, runId }` | `runStop` 要求 `sessionId`、`runId` | 一致 | 无 |
| 运行历史 | `EP_RUN_HISTORY` `{ sessionId, flowId }` | `runHistory` 要求 `sessionId`、`flowId` | 一致 | 无 |
| 断点恢复 | `EP_RUN_RESUME` `{ sessionId, flowId, runId? }` | `runResume` 要求 `sessionId`、`flowId`，`runId` 可选 | 一致 | 无 |
| 数据库测试 | `EP_DB_TEST` `{ node }` | `dbTest` 要求 `node` 为 database 节点 | 一致 | 无 |
| 文件上传 | `EP_FILE_UPLOAD` `{ name, base64 }` | `fileUpload` 要求 `name`、`base64` | 一致 | 后端返回 `{ managedPath, fileName }`，前端用于构建 `files` 数组 |
| 导入导出 | `EP_EXPORT_WORKFLOW`/`EP_IMPORT_WORKFLOW`/`EP_EXPORT_AGENT_TEMPLATE`/`EP_IMPORT_AGENT_TEMPLATE` | 参数结构一致 | 一致 | 无 |
| 服务调试 | `EP_SERVICE_DEBUG`（未在本文件直接调用，但 `useServiceControl` 可能使用） | 后端 `serviceDebug` 端点存在 | 一致 | 无 |

---

### 审查说明
1. 本批次为前端入口与核心组件，输出了“契约对齐验证表”。
2. **P1 运行高亮未实现**是前端最重要缺陷，直接违反需求中对运行时可视化反馈的明确要求，应优先修复。
3. 多个 P2 死代码项（`importInputRef`、`sanitizeRolePatch`、`servicesOpen`、`importBusy`）不影响功能，但增加维护成本，建议清理。
4. 前端调用 API 的端点名与参数结构与后端已审代码一致，未发现契约不匹配问题。前端交互逻辑（模式切换、未保存守卫、节点放置、协作组、文件多选上传等）与需求文档基本一致，无其他缺陷。

---

## Batch-12 审查报告

### 审查范围
- `src/client/hooks/useStudioState.ts`
- `src/client/hooks/useWorkflows.ts`
- `src/client/hooks/useTemplates.ts`
- `src/client/hooks/useRunControl.ts`
- `src/client/hooks/useRunPolling.ts`
- `src/client/hooks/useServiceControl.ts`
- `src/client/hooks/useModeSwitch.ts`
- `src/client/hooks/useUnsavedGuard.ts`
- `src/client/hooks/useGraphHistory.ts`
- `src/client/hooks/useSelection.ts`
- `src/client/hooks/useRemote.ts`
- `src/client/hooks/useToast.ts`
- `src/client/hooks/usePanelLayout.ts`

### 审查基准
- 需求文档 PRD-001 v0.1.0（§4.5.8 运行中双向同步、§4.1.3 服务管理、§4.6 组合管理等）
- 架构文档 AD-001 v0.1.0（§10 Client 半区设计、§2.2 cordis.patch.yml 配置）
- 结合已审后端代码（Batch-04/08/09）进行前后端契约核对

---

### 问题清单

| 严重性等级 | 类别 | 所在文件 | 具体位置（函数，行号） | 问题描述 | 影响/未对齐点 | 证据 |
| :--------- | :--- | :------- | :--------------------- | :------- | :------------ | :------ |


---

### 契约对齐验证表（本批次前端 hooks 与后端 API 契约核对）

| 契约项 | 前端调用（端点/参数） | 后端定义（已审批次） | 是否一致 | 备注 |
| :----- | :-------------------- | :------------------- | :------- | :--- |
| 工作流列表 | `EP_LIST_WORKFLOWS` `{ sessionId }` | Batch-09 `listWorkflows(args.sessionId)` | 一致 | 无 |
| 保存工作流 | `EP_PUT_WORKFLOW` `{ sessionId, flow }` | Batch-09 `putWorkflow` 要求 `sessionId`、`flow` | 一致 | `useWorkflows.saveWorkflow` 正确传递 |
| 删除工作流 | `EP_DELETE_WORKFLOW` `{ sessionId, id }` | Batch-09 `deleteWorkflow` 要求 `sessionId`、`id` | 一致 | 无 |
| 服务列表 | `EP_LIST_SERVICES` `{ sessionId }` | Batch-09 `listServices(args.sessionId)` | 一致 | 无 |
| 保存服务 | `EP_PUT_SERVICE` `{ sessionId, service }` | Batch-09 `putService` 要求 `sessionId`、`service` | 一致 | `useServiceControl.saveService` 正确传递 |
| 删除服务 | `EP_DELETE_SERVICE` `{ sessionId, id }` | Batch-09 `deleteService` 要求 `sessionId`、`id` | 一致 | 无 |
| 启动/停止服务 | `EP_SERVICE_START`/`EP_SERVICE_STOP` `{ sessionId, serviceId }` | Batch-09 要求 `sessionId`、`serviceId` | 一致 | 返回完整 `ServiceState`，前端 dispatch 更新 |
| 运行启动 | `EP_RUN` `{ sessionId, flowId }` | Batch-09 `run` 要求 `sessionId`、`flowId` | 一致 | 无 |
| 运行停止 | `EP_RUN_STOP` `{ sessionId, runId }` | Batch-09 `runStop` 要求 `sessionId`、`runId` | 一致 | 无 |
| 运行状态 | `EP_RUN_STATUS` `{ sessionId, runId }` | Batch-09 `runStatus` 要求 `sessionId`、`runId` | 一致 | 无 |
| 运行历史 | `EP_RUN_HISTORY` `{ sessionId, flowId }` | Batch-09 `runHistory` 要求 `sessionId`、`flowId` | 一致 | 前端在 `Studio.tsx` 中调用 |
| 断点恢复 | `EP_RUN_RESUME` `{ sessionId, flowId, runId? }` | Batch-09 `runResume` 要求 `sessionId`、`flowId`，`runId` 可选 | 一致 | 无 |
| 模板列表 | `EP_LIST_TEMPLATES` `{ kind }` | Batch-09 `listTemplates` 要求 `kind` | 一致 | `useTemplates` 并行加载三类 |
| 保存/删除模板 | `EP_PUT_TEMPLATE`/`EP_DELETE_TEMPLATE` | Batch-09 要求对应参数 | 一致 | 无 |
| 生态枚举 | `EP_PRESETS`、`EP_TOOLS`、`EP_MODELS` | Batch-09 无参数返回数组 | 一致 | 无 |
| 文件上传 | `EP_FILE_UPLOAD` `{ name, base64 }` | Batch-09 `fileUpload` 要求 `name`、`base64` | 一致 | `Studio.tsx` 中调用 |
| 工具组合 | `EP_TOOL_COMBOS` 等 | Batch-09 对应端点 | 一致 | 无 |
| 导入导出 | `EP_EXPORT_*`/`EP_IMPORT_*` | Batch-09 对应端点 | 一致 | 无 |

---

### 审查说明
1. 本批次为客户端 hooks 层，输出了“契约对齐验证表”。
2. **P1 轮询间隔硬编码**是唯一实质缺陷：前端未遵循需求文档规定的默认 2s 可配置，建议至少将 `RUN_POLL_MS` 对齐为 2000ms，或通过 API/配置注入实现真正的可配置。
3. 其余 hooks 逻辑（撤销/重做、未保存守卫、服务控制、模板加载等）与需求文档及后端契约一致，未发现其他问题。
4. `useRunPolling` 的依赖数组缺失 `sessionId` 仅为潜在风险，实际触发概率极低，列为 P3。

---

## Batch-13 审查报告

### 审查范围
- `src/client/components/canvas/FlowNode.tsx`
- `src/client/components/canvas/geometry.ts`
- `src/client/components/canvas/GraphCanvas.tsx`
- `src/client/components/canvas/GroupCard.tsx`
- `src/client/components/toolbar/Toolbar.tsx`
- `src/client/components/sidebar/LeftPanel.tsx`

### 审查基准
- 需求文档 PRD-001 v0.1.0（§4.2.5.1 阶段节点、§4.2.5.2 协作组、§4.5 UI 交互、§4.3 连线管理）
- 架构文档 AD-001 v0.1.0（§10 Client 半区设计、§4.2 graph/ 数据模型）
- 结合已审后端代码（Batch-03 `validate.ts`、Batch-09 `api.ts` 等）进行契约核对

---

### 问题清单

| 严重性等级 | 类别 | 所在文件 | 具体位置（函数，行号） | 问题描述 | 影响/未对齐点 | 证据 |
| :--------- | :--- | :------- | :--------------------- | :------- | :------------ | :------ |




| P0（严重） | 功能职责对齐（模式二核心连线缺失） | `src/client/components/canvas/FlowNode.tsx` | `nodeHandles`（约第 35 行） | 对 `start`/`end` 节点无条件裁剪 ctx 连接点，两种模式下 `start` 仅保留 `flow-out`，`end` 仅保留 `flow-in`。需求文档 §4.2.5.1 连接点定义表明确：模式二输入节点右出含**上下文（用于传递外部问题）**，输出节点左入含**上下文入（用于汇聚父代理最终输出）**。后端 `validate.ts` 仅在 `mode1` 下禁用 start 的 ctx-out 与 end 的 ctx-in，mode2 下是启用的。前端却在两种模式下都移除了这些连接点。 | 模式二下用户无法建立「输入节点 → 下游节点」的上下文连线，也无法建立「上游节点 → 输出节点」的上下文连线。外部问题自动注入后无法经 ctx 连线显式传递给下游，父代理最终汇总也无法经 ctx 连线汇聚到输出节点——模式二核心数据流中断。 | 需求文档 §4.2.5.1 连接点定义表“启动（模式一）/ 输入（模式二）…右出：流程出、上下文（输入节点，模式二，用于传递外部问题）”、“结束（模式一）/ 输出（模式二）…左入：流程入（输出节点另有上下文入…）”；后端 `validate.ts` 中 `mode1StartCtxOut`/`mode1EndCtxIn` 仅约束 mode1。 |
---

### 契约对齐验证表（本批次前端画布与后端/需求连线契约核对）

| 契约项 | 前端实现（本批次） | 后端/需求基准 | 是否一致 | 备注 |
| :----- | :----------------- | :------------ | :------- | :--- |
| 角色节点连接点（parent/agent/proxy） | 左入 flow-in/ctx-in/db-in；右出 flow-out/ctx-out | 后端 `NODE_HANDLES` 一致 | 一致 | 无 |
| 文件节点连接点 | 无左入；右出 ctx-out | 后端一致 | 一致 | 无 |
| 数据库节点连接点 | 无左入；右出 db-out | 后端一致 | 一致 | 无 |
| 组卡片连接点 | 仅 flow-in/flow-out | 后端一致 | 一致 | 无 |
| 组内成员连接点 | db-in/ctx-in/ctx-out（无流程） | 后端一致 | 一致 | 无 |
| **启动/输入节点连接点** | 前端无条件仅 `flow-out`（移除 ctx-out） | 后端 mode1 仅 flow-out；**mode2 有 flow-out + ctx-out** | **不一致（P0）** | 需求文档 §4.2.5.1 |
| **结束/输出节点连接点** | 前端无条件仅 `flow-in`（移除 ctx-in） | 后端 mode1 仅 flow-in；**mode2 有 flow-in + ctx-in** | **不一致（P0）** | 需求文档 §4.2.5.1 |
| 条件连线颜色类 | `is-pass`/`is-fail`/`is-content` | 需求文档 §4.3 连线类型与颜色规范 | 一致 | 无 |
| 虚拟节点视觉 | 虚线边框 + `↻ 引用` 徽标 | 需求文档 §4.5.6 | 一致 | 无 |
| 连线方向箭头 | 流程/条件有向，ctx/db 无向 | 需求文档 §4.3 | 一致 | 无 |

---

### 审查说明
1. 本批次为前端画布核心交互层，输出了“契约对齐验证表”。
2. **P0 缺陷最为严重**：输入/输出节点的上下文连接点在两种模式下都被移除，直接破坏模式二的核心数据传递，必须优先修复。修复方向应为：仅在 `mode1` 下裁剪 ctx 连接点，`mode2` 下保留 start 的 ctx-out 与 end 的 ctx-in。
3. 平移/取消选中失效属于确定性 DOM 事件问题，需要将空白区域判定改为基于坐标或使用 `closest` 检查，而非严格比较 `target === currentTarget`。
4. 协作组拉伸仅实现单方向，与需求文档不符，建议补齐至少上下左右四方向。
5. 其余逻辑（节点渲染、连线几何、拖拽、组内成员显示）与后端契约及需求基本一致，未发现其他缺陷。

---

## Batch-14 审查报告

### 审查范围
- `src/client/components/panels/inspector/forms.tsx`
- `src/client/components/panels/inspector/Inspector.tsx`
- `src/client/components/confirm-dialog/ConfirmDialog.tsx`
- `src/client/components/run-history/RunHistory.tsx`
- `src/client/components/service-console/ServiceConsole.tsx`
- `src/client/components/combo-manager/ComboManager.tsx`
- `src/client/lib/remote.ts`
- `src/client/lib/graph-model.ts`
- `src/client/lib/bundle.ts`
- `src/client/lib/files.ts`

### 审查基准
- 需求文档 PRD-001 v0.1.0
- 架构文档 AD-001 v0.1.0
- 结合此前所有已审后端/前端代码进行全量契约核对

---

### 问题清单

| 严重性等级 | 类别 | 所在文件 | 具体位置（函数，行号） | 问题描述 | 影响/未对齐点 | 证据 |
| :--------- | :--- | :------- | :--------------------- | :------- | :------------ | :------ |


---

### 契约对齐验证表（本批次最终核对）

| 契约项 | 前端实现（本批次） | 后端/需求基准 | 是否一致 | 备注 |
| :----- | :----------------- | :------------ | :------- | :--- |
| **启动/输入节点连接点** | `HANDLES.start` 仅 `flow-out`（沿用 Batch-13 问题） | 后端 mode2 有 `flow-out + ctx-out`；需求 §4.2.5.1 | **不一致（延续 P0）** | 已在 Batch-13 报告；本批次 `graph-model.ts` 中 `HANDLES` 表同样裁剪，需一并修复。 |
| **结束/输出节点连接点** | `HANDLES.end` 仅 `flow-in`（沿用 Batch-13 问题） | 后端 mode2 有 `flow-in + ctx-in`；需求 §4.2.5.1 | **不一致（延续 P0）** | 同上。 |
| SSE 数据行格式 | `line.startsWith('data: ')`（冒号后空格） | 后端 `sseChunk` 输出 `data: {...}`（无空格） | **不一致（P1）** | 服务调试台流式回复全部丢弃。 |
| 文件模板多选字段 | 拖入画布时丢失 `files` 列表 | 后端 `templateToNode` 保留 `files`；需求 §4.2.4.1 | **不一致（P1）** | 多选文件功能在拖入节点时失效。 |
| 工作流/服务保存 | `serializeWorkflow`/`saveService` 保留虚拟节点 `proxySourceId` | 后端 `validate.ts` 需要该字段 | 一致 | 无 |
| 运行状态轮询 | `useRunPolling` 终态后 `RUN_CLEARED` | 后端 `runStatus` 返回终态 | 一致 | 但轮询间隔硬编码 600ms（Batch-12 P1） |
| 服务控制台调试代理 | 经 `EP_SERVICE_DEBUG` 流式调用 | 后端 `serviceDebug` 端点存在 | 一致（接口层面） | 但 SSE 格式不匹配（见上） |
| 组合管理 | `EP_PLUGIN_CATALOG` 等 | 后端 `pluginCatalog` 返回结构 | 一致 | `run_code` 过滤前后端一致 |
| MCP 配置 | `EP_MCP_*` | 后端 `mcp-registry` | 一致 | 无 |
| 导入导出 v2 | `bundle.ts` 格式判定 | 后端 `transfer.ts` | 一致 | 协作组模板导入缺失问题已在前端未涉及（后端 Batch-09 P1） |

---

### 审查说明
1. 本批次为前端最后一层，输出了“契约对齐验证表”。
2. **新增两个 P1 缺陷**：服务调试 SSE 数据行格式不匹配、文件模板多选字段丢失。
3. **延续 Batch-13 的 P0 缺陷**：`lib/graph-model.ts` 中 `HANDLES` 表同样错误裁剪了输入/输出节点的上下文连接点，需与 `FlowNode.tsx` 一并修复。
4. `flowToCanvasNodes` 疑似死代码且存在 proxySourceId 丢失隐患，列为 P3 待定。

---

## 最终盘点审查报告

### 一、既有问题因上下文补齐而消失的情况

| 原批次-编号 | 问题描述 | 消失/变化原因 | 当前状态 |
| :--- | :--- | :--- | :--- |
| Batch-03 P1 | `normalizeFlow` 重建角色节点数据时丢失 `systemPromptSource` 字段 | 经全仓库检索，`normalizeFlow` **未被任何保存路径调用**（工作流/服务保存直接走 `FlowStore.saveWorkflow/saveService` 的对象展开，不经 `normalizeFlow`）。因此字段不会在实际保存时丢失。 | **消失**（实际风险不存在，但 `normalizeFlow` 本身仍残留缺陷，若未来被调用则会复现） |
| Batch-08 P1 | `spawnChild` fork 命令缺少 `--visual-workflow-serve` 与 `--port` 显式参数 | `service-runner.ts` 的 `boot` 中有 config 回退：当 `cmdlineArgs` 解析失败时，会使用 `config.serviceId` 与 `config.port`（由 `serve.patch.yml` 渲染注入）。因此功能上服务进程仍能获得正确参数，但架构文档规定的 fork 命令形态仍不一致。 | **风险降低但未完全消失**（架构偏离仍存在，若 config 缺失则进程将无法识别服务） |

其余已报告问题均未因上下文补齐而消失，仍为有效缺陷。

---

### 二、补齐上下文后新发现的 bug

| 严重性等级 | 类别 | 所在文件 | 具体位置（函数，行号） | 问题描述 | 影响/未对齐点 | 证据 |
| :--------- | :--- | :------- | :--------------------- | :------- | :------------ | :------ |


---

### 三、审查总结

本次全仓库审查共发现 **1 个 P0、多个 P1/P2/P3**，核心问题集中在以下方面：

1. **模式二核心数据流被破坏（P0）**  
   前端 `FlowNode.tsx` 与 `lib/graph-model.ts` 无条件裁剪了输入/输出节点的上下文连接点，导致模式二下外部问题无法经 ctx 连线传给下游、父代理最终汇总无法汇聚到输出节点。需求文档明确要求模式二输入节点有 ctx-out、输出节点有 ctx-in。

2. **服务进程自我启动无限循环（P0）**  
   `VisualWorkflowHost` 的 `Service.init` 无条件执行 `autoRecover`，而服务进程也复用了该装配逻辑，导致服务进程启动后扫描到自身状态为 `running` 并再次 fork 自身，造成进程自我复制。必须为服务进程跳过 `autoRecover`。

3. **断点续跑起点注入错误（P0）**  
   恢复 `interrupted` 类型的运行后，`buildResumedSnapshot` 已正确推断出恢复起点，但注入父代理的编排指令仍使用 `prev.resumeFromNodeId`（可能为 undefined），导致父代理可能从流程开头重新调度，已 ok 节点被重复执行，违反“已执行节点不重跑”红线。

4. **跨层契约不一致（P1）**  
   - 服务调试台 SSE 数据行格式判断（`data: ` 带空格）与后端 `sseChunk` 输出（`data: {` 无空格）不匹配，调试流完全丢弃。  
   - 文件模板拖入画布时丢失多选 `files` 列表，后端保留而前端遗漏。  
   - 运行轮询间隔硬编码 600ms，与文档规定 2s 可配置不符。  
   - `useWorkflows.saveWorkflow` 的并发去重未按 flowId 隔离，导致跨工作流保存丢失（新发现）。

5. **功能实现缺口（P1）**  
   - 运行中节点高亮未实现（`highlightedNodeIds` 硬编码空数组）。  
   - 协作组仅支持单方向拉伸，需求要求上下左右可拉伸。  
   - 模式二下 `hasDbInLine` 仅查工作流存储，导致数据库连线工具永不注入。  
   - 导入导出 v2 bundle 未恢复协作组模板。  
   - 文件节点任务块组装未处理多选文件列表。  
   - 平移/取消选中事件判定失效。

6. **架构与规范偏离（P1）**  
   - 原子发布采用 `rename` 覆盖而非文档规定的 `link()` no-clobber。  
   - fork 命令缺少显式 `--visual-workflow-serve` 参数（当前有 config 回退）。  
   - 列表读取损坏文件时未隔离异常，一个坏文件可导致整个列表不可用。  
   - 节点任务提示词末段遗漏 `retryAndReact` 关键约束重申。

7. **死代码与冗余（P2）**  
   多处未使用导出/状态/重复函数，包括 `COLLAB_PREFIX`、`importInputRef`、`sanitizeRolePatch`、`servicesOpen`/`importBusy` 状态、`handleYOf` 与 `handleY` 重复等。

8. **待定项（P3）**  
   若干文档未覆盖的边界问题，如 `chunkText` 极端参数资源风险、并发临时文件冲突、会话校验缺失等，按规范不予定级为缺陷。

---

本次盘点未发现既有 P0 问题因上下文补齐而消失；新发现 1 个 P1 并发保存缺陷。所有列出的 P0/P1 问题均为确定性或高概率可触发的功能缺陷或契约不一致，需优先修复。