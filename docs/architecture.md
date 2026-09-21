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
├── remote/
├── service/
├── embedding/
├── scheduler/
└── prompts/
```

---

## 7.1 shared

定义 Host / Client 之间共享的纯类型与协议。

包括：

* Graph Model
* Workflow Types
* Protocol
* OrgMeta
* Run State

`shared` 不包含运行时逻辑。

---

## 7.2 storage

负责持久化：

* Workflow
* Template
* Run
* Orchestration State
* Tool Combo
* Scheduler State
* User/Session Mapping

存储采用原子写入与并发保护。

Storage 是持久化事实层，不负责 Workflow 语义决策。

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

Orchestrator 不替 Agent 做语义判断。

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

## 7.8 remote

负责 Client 与 Host 的 HTTP / Remote API。

Remote 层负责协议转换，不拥有核心 Workflow 状态。

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

---

## 7.10 prompts

集中维护：

* Parent orchestration prompt
* Node task prompt
* Planning prompt
* Collaboration prompt
* Dynamic runtime sections

Prompt 的结构设计必须考虑稳定前缀、动态尾部以及上下文成本。

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