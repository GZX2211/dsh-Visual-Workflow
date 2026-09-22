# Architecture.md

> 当前架构基线。
> 本文描述系统当前有效的架构、核心抽象、运行模型、模块边界与架构不变量。

## 1. 系统定位

`dsh-visual-workflow` 是运行于 DeepSeek Harness 之上的可视化多 Agent Workflow 编排插件。

系统由两个主要部分组成：

* **Host**：负责 Workflow 数据、运行时、Agent 生命周期、编排工具、持久化以及服务端能力。
* **Client**：负责 Workflow 的可视化编辑、运行控制、状态展示以及管理界面。

系统本身不替代 DeepSeek Harness 的 Agent Runtime，而是在其能力之上提供：

* 可持久化的 Workflow 结构
* 可视化的 DAG 编排
* Parent Agent 驱动的 Workflow 执行
* Child Agent / Agent Team 执行单元
* Workflow 状态持久化与断点续跑
* 运行中的 Workflow 结构调整
* API Service 模式
* 自主编排与 Workflow 结构演化能力

系统的核心目标不是重新实现 Agent，而是提供一个**可持久化、可观察、可修改、可进化的 Agent 执行结构**。

---

# 2. 总体架构

## 2.1 分层

系统整体关系：

```text
┌─────────────────────────────────────────────┐
│                    Client                   │
│                                             │
│  Canvas / Inspector / History / Controls    │
└──────────────────────┬──────────────────────┘
                       │ Remote API
                       ▼
┌─────────────────────────────────────────────┐
│                    Host                     │
│                                             │
│  Workflow / Orchestrator / Agent / Tools   │
│  Storage / Service / Scheduler / Embedding │
└──────────────────────┬──────────────────────┘
                       │ ctx / official seams
                       ▼
┌─────────────────────────────────────────────┐
│              DeepSeek Harness               │
│                                             │
│ Agent Runtime / Session / Tools / Events    │
│ Subagent / Prompt / User Question / MCP     │
└─────────────────────────────────────────────┘
```

Host 是本插件的核心运行区域；Client 只负责交互与可视化。

插件不复制 DeepSeek Harness 的 Agent Runtime，而通过官方公开能力与运行时 seam 与其协作。

---

## 2.2 核心原则

### 1. Harness Runtime 优先

DSH 已经提供的 Agent、Session、Tool、Prompt、Subagent、Question 等能力由 Harness 负责。

本插件只实现 Workflow 所需的额外能力。

不得通过修改 Harness 核心代码解决本插件的问题。

### 2. Workflow State 与 Agent Context 分离

```text
Workflow State
    │
    ├── node status
    ├── dependency
    ├── outputs
    ├── checkpoint
    ├── retry
    └── execution history
```

与：

```text
Agent Context
    │
    ├── conversation
    ├── reasoning
    ├── tool calls
    └── temporary working context
```

相互独立。

Workflow 的长期连续性不依赖某一个 Agent Context 永久存在。

Agent 可以被 compact、rotation、cold resume 或重新创建，而 Workflow State 必须能够继续保存状态。

### 3. Workflow 是执行结构

Workflow 不只是 Agent 列表，而是：

```text
Task
  ↓
Execution Structure
  ↓
State Transition
  ↓
Checkpoint
  ↓
Resume / Mutation
```

Workflow 负责描述整体组织生命周期、阶段、依赖、执行单元以及结构变化。

### 4. Parent 负责组织决策

Parent Agent 是 Workflow 的主要编排者。

```text
Parent
  ↓
选择执行单元
  ↓
启动 / 等待
  ↓
观察事件
  ↓
重新规划
  ↓
必要时修改 Workflow
```

Runtime 不替 Parent 做语义决策。

### 5. Runtime 与 Agent 的治理边界

```text
Runtime
  → 确定性事实

Agent
  → 不确定判断

Parent
  → 组织决策
```

Runtime 负责 timeout、failure、permission error、结构错误等确定性条件。

Agent 负责发现风险、判断是否需要汇报、提出建议。

Parent 决定是否改变组织结构或执行策略。

### 6. 结构变化必须经过治理

Child Agent 可以发现：

* 新风险
* 新依赖
* 原计划失效
* 工具缺陷
* 任务方向变化

但 Child 不直接拥有 Workflow 结构修改权。

结构修改由 Parent 通过受控的 Workflow mutation 能力完成。

---

# 3. 核心抽象

## 3.1 Template

Template 是可复用的组织或资源定义。

主要包括：

* Role Template
* File Template
* Database Template
* Workflow Template
* Tool Combo

Template 描述“可以被创建什么”。

---

## 3.2 Instance

Instance 是 Template 的具体运行对象。

```text
Template
   │
   │ deep copy
   ▼
Instance
```

Template 与 Instance 解耦。

修改 Template 不直接修改已经创建的 Instance。

---

## 3.3 Workflow

Workflow 是由节点和连线构成的持久化执行结构。

```text
Workflow
├── nodes
├── lines
├── meta
├── revision
└── execution-related state
```

Workflow 是整个编排系统的结构事实源。

---

## 3.4 Node

Node 是 Workflow 中的结构单元。

当前主要节点类型：

```text
parent
agent
file
database
start
end
pause
group
proxy
```

其中：

* `parent`：Workflow 的主要编排者，也可以作为执行节点。
* `agent`：独立 Child Agent 执行单元。
* `file`：提供文件或文本上下文。
* `database`：提供数据库检索能力。
* `start/end/pause`：Workflow 生命周期控制节点。
* `group`：Workflow 内的协作单元，也就是 Agent team。
* `proxy`：引用已有执行节点的虚拟节点，可用于复用或里程碑闸门。

---

# 4. Agent、Team 与 Workflow

## 4.1 Agent

Agent 是最小执行单元。

Agent 拥有：

* Role / Prompt
* Model / Provider
* Reasoning
* Tool Set
* Local Context
* Execution State

Agent 负责完成局部任务，而不负责整个 Workflow 的结构治理。

---

## 4.2 Team（group）

Agent Team 是多个 Agent 构成的动态协作单元。

Team 内部拥有：

* 成员
* 消息通信
* 任务状态
* 协作关系
* 成员生命周期

Team 内部的动态任务结构属于 Team 的协作状态，而不是 Workflow 的长期结构。

因此：

```text
Workflow
   │
   └── Team Node
          │
          ├── Agent
          ├── Agent
          └── Agent
```

Workflow 可以把 Team 当作一个执行单元。

Team 内部如何协调由 dsh 的 Team Runtime 负责。

---

## 4.3 三层职责

```text
Agent
│
│ 局部执行
▼
Team
│
│ 局部协作
▼
Workflow
│
│ 持久化执行结构
▼
Meta-Orchestration
```

> **Team 管理协作状态；Workflow 管理持久化执行结构（组织状态）。**

---

# 5. Workflow 执行模型

## 5.1 Event-driven supervision

Parent 采用事件驱动的等待模型。

主要唤醒原因包括：

* Child 完成
* Child 失败
* Child timeout
* Child message
* Team 状态变化
* Workflow 状态变化
* 用户输入
* 组织结构变化

因此：

```text
Parent
  ↓
start
  ↓
sleep / wait
  ↓
event
  ↓
wake
  ↓
decision
```

---

## 5.3 Child Signal 与 Gate

系统同时采用两种治理入口。

### Child Signal

Child 主动向 Parent 暴露重要决策事件。

```text
Child
  ↓
发现重要变化
  ↓
Signal Parent
  ↓
Parent 判断
```

它用于发现未知的关键节点。

### Gate

Gate 是 Workflow 中显式的治理边界。

```text
Workflow
  ↓
Gate
  ↓
Parent Re-evaluation
  ↓
Continue / Mutate
```

它用于制度化已经知道的重要决策点。

两者关系：

```text
未知关键事件
    ↓
Child Signal
    ↓
Parent Governance
    ↓
形成经验
    ↓
未来 Workflow
    ↓
Gate
```

因此：

> Child Signal 是发现机制；Gate 是制度化机制。

---

# 6. Autonomous Orchestration

自主编排是本项目从静态 Workflow 向动态 Workflow 演化的核心能力。

基本闭环：

```text
Intent
  ↓
Parent Planning
  ↓
Workflow
  ↓
Execution
  ↓
Observation
  ↓
Parent Replanning
  ↓
Workflow Mutation
  ↓
New Workflow Structure
```

---

## 6.1 Workflow Mutation

Parent 可以在运行过程中修改 Workflow 结构。

修改能力包括：

* 创建节点
* 删除节点
* 更新节点
* 创建 / 删除连线
* 创建 Group
* 修改 Group 成员
* 修改元参数
* 修改受治理的运行状态

---

# 7. Host 架构

Host 是系统的运行核心。

```text
src/host/
├── shared/
├── storage/
├── graph/
├── orchestrator/
├── agent/
├── tools/
├── commands/
├── api/
├── mcp/
├── transfer/
├── service/
├── embedding/
├── scheduler/
├── sessions/
└── prompts/
```

---

## 7.1 shared

定义 Host / Client 之间共享的契约：Graph Model、Workflow Types、Protocol、OrgMeta、Run State 等。

边界：

* **共享契约的唯一来源**：同一语义只允许一处本体；Host 与 Client 引用同一份定义，禁止各自镜像或复制形状。
* **形状与逻辑分离**：`shared` 不包含业务逻辑（校验、归一化、判定、编排、持久化），只描述形状与跨层常量。
* **零运行时依赖**：禁止运行时 import（仅允许 `import type`，编译期完全擦除）；纯形状文件不得导出运行时值，跨层常量只落在协议常量文件。
* **枚举双向穷尽**：协议层取值域与类型层联合必须一致（类型 ⊆ 常量 ∧ 常量 ⊆ 类型），并由编译期断言锁定。
* **契约路径稳定**：内部按职责拆分不得改变对外 import 说明符；拆分通过 type-only barrel 保持路径。

文件职责（治理规则见 `src/host/shared/AGENTS.md`）：

```text
graph-model.ts     节点/连线/工作流文档形状
org-meta.ts        元参数类型本体（OrgMeta / OrgBudget）
run-types.ts       run 快照与节点执行记录
service-types.ts   模式二服务实例与 userId→sessionId 映射
template-types.ts  模板与导入导出 v2 bundle
scheduler-types.ts 定时任务实体与运行态
protocol.ts        跨层协议常量（端点名/工具名/可见性/状态枚举/口径/颜色）
types.ts           type-only barrel（保持既有契约路径 `from './types.js'`）
```

---

## 7.2 storage

负责持久化：

* Workflow
* Template
* Run
* Orchestration State
* Tool Combo
* User/Session Mapping

存储采用原子写入与并发保护。

Storage 是持久化事实层，不负责 Workflow 语义决策。

边界：

* **单一公共门面**：持久化文档的读写经一个门面统一进入；调用方不得绕过它直接写同一数据文件。
* **单一写者与临界区**：所有写入经「磁盘锁 + 进程内锁」组合原语；读改写必须在同一临界区内完成，禁止跨锁 check-then-act。
* **不持有运行态**：运行锁、运行快照、等待器、子代理表等运行事实归 orchestrator；storage 只做持久化。
* **不定义第二套结构事实源**：磁盘文档即结构事实源，storage 不额外缓存或镜像一份结构。
* **读语义统一**：单资源读遇损坏 JSON 抛可诊断错误；列表读跳过损坏项，但不得吞掉权限等其它错误。
* **纯逻辑与 IO 分离**：路径计算、字段剥除、版本记账、文档投影为纯函数；副作用只出现在门面方法与原子原语内。
* **跨文件边界**：跨文件事务（如服务文档与其会话映射文件）不在保证范围内，调用方必须校验主资源存在并保证写顺序。

文件职责（治理规则见 `src/host/storage/AGENTS.md`）：

```text
flow-store.ts       持久化门面（各资源 CRUD + 会话隔离 + 锁编排）
storage-paths.ts    数据目录布局与资源路径计算（含文件名消毒）
document-policy.ts  写入字段剥除与 revision 记账
template-model.ts   模板种类判别模型
service-view.ts     服务文档 → 模式二工作流视图投影
atomic.ts           原子写/读、进程内与跨进程锁、崩溃恢复
```

注：scheduler、tools 基础设施、embedding 等模块各自持有其存储文件，仅复用 `atomic.ts` 的原子原语；storage 不代替它们持有数据。

---

## 7.3 graph

负责：

* Graph Model
* Graph Validation
* DAG Analysis
* Graph Invariants
* Organizational Metadata

职责边界：

```text
validateFlow
    ↓
结构是否合法

checkGraphInvariants
    ↓
结构是否满足编排约束
```

二者不能混为一体。

边界（治理规则见 `src/host/graph/AGENTS.md`）：

* **公共入口**：图契约只经模块公共入口对外提供；模块外（orchestrator / tools / agent / service / storage 与全部测试）不得直接引用模块内部文件。
* **单一事实源**：流程线判定、可执行单元口径、问题级别与问题 code 注册表各只有一处本体，使用方引用本体而非各自重写。
* **子域分治**：图契约与结构校验、编排质量检查、组织元参数与规模护栏各自只承担自己的变化原因，不得互相重新定义结论。
* **确定性**：模块内判定与计算为纯函数；不读写持久化、不推进运行生命周期、不做 Agent 语义判断。

---

## 7.4 orchestrator

负责 Workflow Runtime：

* Run lifecycle
* Run lock
* Checkpoint
* Pause / Resume
* Node execution coordination
* Runtime observation
* Workflow synchronization
* Watchdog
* Runtime recovery

边界：

* **持有运行事实的唯一写者**：`RunSnapshot`、运行锁、子代理/等待器/协作通信的内存表只由 orchestrator 方法改写；工具层需要写运行状态时必须经语义化方法（如 `markMilestoneNode`），不得直接改写快照。
* **不做 Agent 语义判断**：是否需要重规划、换人、汇报由 Agent 决定；orchestrator 只提供确定性事实（状态、锁、终态、错误码、事件回写）。
* **不持有工作流文档写权**：文档读写归 storage 与写图工具；orchestrator 只读最新文档并刷新运行事实源文件。
* **不反向依赖具体实现**：数据工具（索引预建）与 Agent（角色 Prompt 读取）能力经依赖缝注入，模块外统一从 `index.ts` 导入。

文件职责（详见 `src/host/orchestrator/AGENTS.md`）：

```text
index.ts             唯一公共入口（barrel）
runtime.ts           OrchestratorRuntime 收口类（继承链最终类）
runtime-base.ts      字段/查询/上下文自动接续/清理/父代理配置注入
runtime-launch.ts    startRun / resumeRun
runtime-execute.ts   wf_run_node / wf_finish
runtime-comm.ts      wf_ask_agent 三态协议
runtime-observe.ts   subagent/end 回写与协作组聚合
runtime-lifecycle.ts 终止 / 停止 / 挂起
seams.ts             依赖缝、常量、配置与身份类型
errors.ts            WfError / messageOf
run-entry.ts         RunEntry 与运行接口契约
ask-protocol.ts      三态协议类型与消息文本纯函数
snapshot.ts          运行快照纯函数（截断口径唯一来源）
graph-facts.ts       图推导与节点上下文事实（纯函数）
task-blocks.ts       节点任务块与交接契约（纯函数）
directive.ts         父代理提示词变体与编排指令组装（纯函数）
node-params.ts       节点级执行参数解析（纯函数）
resume.ts            断点候选查找与继承快照构建
flow-diff.ts         编排语义变更判定（纯函数）
watchdog.ts          空闲看护、扫描与宿主重启对账
```

---

## 7.5 agent

负责：

* Child Agent 生命周期
* Agent 配置
* Provider / Model
* Tool Filter
* Prompt Injection
* Reasoning
* ReAct limits
* Child Context

Agent Runtime 建立在 Harness 官方 Agent / Subagent 能力之上。

---

## 7.6 tools

负责向 Agent 暴露 Workflow 能力。

主要能力包括：

```text
Workflow execution
    ├── wf_run_node
    ├── wf_run_node_wait
    ├── wf_finish
    └── wf_ask

Data
    └── wf_db_query

Orchestration
    ├── wf_org_catalog
    └── wf_graph_patch
```

工具是能力边界，不承担核心业务状态。

---

## 7.7 commands

负责用户直接触发的命令入口，例如：

```text
/arrange
```

Command 负责进入规划流程，不直接替代 Workflow Runtime。

---

## 7.8 api

负责 GUI（Client）与 Host 之间的 HTTP API 边界：`POST /visual-workflow/<endpoint>` 端点分发（共享协议常量派生白名单）、受管文件下载路由与服务调试流式代理。

边界（治理规则见 `src/host/api/AGENTS.md`）：

* **薄边界**：只做协议转换（请求 → 领域调用 → 响应/错误翻译），不拥有 Workflow / 运行 / 持久化状态；
* **契约单一来源**：端点名取自共享协议常量，白名单与其零漂移；
* **错误翻译归边界**：领域模块只抛稳定错误码，HTTP 状态映射只发生在边界（领域模块不得依赖传输层错误类型）；
* **无状态**：不缓存领域数据、不自建持久化；领域能力只经宿主能力缝注入，缺失时明确报错或降级；
* **依赖单向**：边界依赖领域，领域不依赖边界；端点组之间不得互相依赖。

---

## 7.8.1 mcp

Host 侧 MCP 服务器配置注册表：行托管在 profile 的 `cordis.patch.yml` 注释标记区内，行结构与官方 dsh-mcp-client 一致，修改后需重启 dsh web 生效。

---

## 7.8.2 transfer

导入导出领域：工作流/服务 v2 bundle 与角色模板导出文件的序列化、嵌入式资源重建与名称冲突策略；只抛稳定领域错误码，不接触 HTTP 传输层。

---

## 7.9 service

负责模式二 API Service：

```text
API Request
   ↓
Service Process
   ↓
Session
   ↓
Workflow
   ↓
Agent
```

每个服务实例拥有独立的运行生命周期与端口。

边界（治理规则见 `src/host/service/AGENTS.md`）：

* **两个进程侧**：主进程侧负责服务子进程的生命周期（启动/停止/崩溃判定/自动恢复）、端口分配与挂载产物渲染；服务进程侧负责对外 HTTP 协议、多用户会话隔离与编排调用。两侧只经磁盘事实（服务文档、挂载产物）与进程启动参数/标准流协作，禁止内存共享与反向拉起。
* **状态事实源**：服务状态以持久化服务文档为准，内存登记只是存活子进程的索引；不一致时以文档为准并自愈。
* **生命周期收敛**：启动幂等（互斥登记在第一个异步点之前）；停止先优雅退出、超宽限期后强杀整棵进程树；主进程重启只恢复文档状态为运行中的服务。
* **协议层薄**：对外 HTTP 层只做请求/响应转换与错误映射，不含业务判断。
* **等待有上界**：请求等待超时或客户端断开时必须停止后台编排运行并释放并发槽。

---

## 7.10 scheduler

负责定时任务：按用户配置的**执行窗口**与**触发策略**，驱动既有编排运行时运行所选工作流模板的实例。

```text
任务配置（执行窗口 × 触发策略）
   ↓
周期扫描 → 决策（触发 / 窗口挂起 / 窗口续跑 / 并发跳过 / 用户接管）
   ↓
编排运行时（复用运行锁与断点续跑）
```

边界（治理规则见 `src/host/scheduler/AGENTS.md`）：

* **两层语义**：执行窗口决定何时允许运行，触发策略决定何时应当触发；两层同时满足才执行。
* **时间确定**：时间解析、时区换算、窗口判定与触发推算为纯函数，不读系统时钟；时刻一律按任务自身声明的时区解释。
* **单一事实源**：任务字段的「形状收敛 → 业务校验 → 保存前规范化」各有唯一实现且顺序固定；会话工作目录决策只有一处实现（显式路径优先，否则继承创建者），显式路径的存在性校验属接受该配置的保存端点。
* **状态所有权**：磁盘上的任务定义与运行时游标跨重启保留；进程内引擎运行态归引擎实例，随其启动/停止/清理走完整生命周期。
* **扫描可重入安全**：重叠扫描合并为一次，禁止对同一任务并发决策；单任务失败不影响其余任务。
* **副作用经缝**：编排运行时、数据层、会话创建、时钟、日志均经显式依赖缝注入，决策本身不产生副作用。

---

## 7.11 prompts

集中维护：

* Parent orchestration prompt
* Node task prompt
* Planning prompt
* Collaboration prompt
* Dynamic runtime sections

Prompt 的结构设计必须考虑稳定前缀、动态尾部以及上下文成本。

边界：

* **单一公共入口**：模块外只从 `index.ts` 导入；入口只公开外部真实消费的契约（构建器、段落锚点、约束常量、入参类型），模块内部的措辞与渲染 helper 不对外公开。
* **输出即契约**：提示词文本就是模型的输入契约，改动模板正文或段落顺序属行为变化；结构治理必须能证明输出逐字节不变后才能提交。
* **依赖末端**：不依赖 orchestrator / agent / tools / storage / api / service / scheduler，只接收调用方传入的事实与动态值；动态值只注入末段。
* **文案规范**：文案、语言政策与写作规范以 `src/host/prompts/README.md` 为准。

治理规则见 `src/host/prompts/AGENTS.md`。

---

# 8. Client 架构

Client 是 Workflow 的可视化编辑层。

```text
src/client/
├── sidebar/
├── studio/
├── components/
├── hooks/
├── lib/
├── i18n.ts
└── styles.ts
```

### sidebar

负责与官方 DSH Sidebar / Slot 集成。

### studio

负责工作台状态机与布局。

### components

负责：

* Canvas
* Node
* Inspector
* History
* Tool Combo
* Scheduler
* Service UI

### hooks

负责交互控制逻辑。

### lib

负责纯逻辑：

* Graph Model
* Layout
* Remote
* File
* Bundle
* Serialization

Client 不直接拥有 Host Runtime 状态。

---

# 9. DSH 集成边界

本插件遵循：

```text
Visual Workflow
      │
      │ official runtime seams
      ▼
DeepSeek Harness
```

插件不修改 Harness 核心 Runtime。

主要依赖官方能力：

* Agent / Session
* Subagent
* Tool Registration
* Prompt Assembly
* User Questions
* Events
* MCP
* Session Persistence
* Headless Service Composition

当官方能力发生变化时，应优先通过 Adapter / Host Capability 层适配，而不是侵入 Harness 内部实现。

---

# 10. 架构不变量

以下内容属于当前架构的长期约束。

### 1. Host / Client 分离

Client 不直接依赖 Host Runtime 内部状态。

### 2. Workflow JSON 是结构事实源

画布、运行时与 Agent 不得各自维护另一套 Workflow 结构事实。

### 3. Workflow State 独立于 Agent Context

Agent 可以替换，但 Workflow 状态必须能够继续执行。

### 4. Parent 是 Workflow 组织决策者

Child 不直接修改组织结构。

### 5. Runtime 不做语义治理

Runtime 负责确定性事实；语义判断交给 Agent / Parent。

### 6. DSH 核心 Runtime 不修改

本插件通过官方能力扩展 Harness，而不是 fork 或修改 Harness 核心。

### 7. 模板与实例解耦

Template 修改不直接改变已经创建的 Instance。

---

# 11. 文档职责

```text
AGENTS.md
    → AI 如何修改项目

docs/architecture.md
    → 当前系统如何组织

docs/archive/
    → 系统过去如何演化

代码 / 测试
    → 当前实际实现
```

当文档与代码出现冲突时：

* **实现事实**以代码与测试为准；
* **架构原则**以本文件为当前基线；
* 若架构已经发生变化，应先更新 Architecture，再进行后续实现。