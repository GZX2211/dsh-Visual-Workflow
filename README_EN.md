<p align="center">
  <img src="https://raw.githubusercontent.com/GZX2211/dsh-Visual-Workflow/main/assets/images/流程编排.png" alt="UI Preview" width="100%" />
</p>

<h1 align="center">Visual Agent Orchestration Platform</h1>

<p align="center">
  A visual Agent orchestration platform built on <a href="https://github.com/deepseek-ai/deepseek-harness">DeepSeek Harness</a><br>
  Supports fixed Workflows, visual flow design, Agent autonomous meta-orchestration, real-time intervention during execution, and continuous self-evolution through organizational memory and feedback distillation
</p>

<p align="center">
  <a href="README.md">简体中文</a> · <b>English</b>
</p>

<p align="center">
  <a href="#"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6-blue"></a>
  <a href="#"><img alt="React" src="https://img.shields.io/badge/React-19-blueviolet"></a>
  <a href="#"><img alt="Node" src="https://img.shields.io/badge/Node-%E2%89%A524-green"></a>
  <a href="#"><img alt="pnpm" src="https://img.shields.io/badge/pnpm-11-orange"></a>
  <a href="#"><img alt="vitest" src="https://img.shields.io/badge/test-vitest-cyan"></a>
  <a href="#"><img alt="license" src="https://img.shields.io/badge/license-MIT-lightgrey"></a>
  <a href="https://github.com/GZX2211/dsh-Visual-Workflow/releases"><img alt="version" src="https://img.shields.io/github/v/release/GZX2211/dsh-Visual-Workflow?label=version&color=0891b2&include_prereleases"></a>
</p>

---

## Project Positioning

This is an Agent orchestration platform that "gets smarter the more you use it" — no longer just a workflow.

The project combines **Workflow, Agent Team, Meta-Orchestration, Human-in-the-loop, and Organizational Memory** into a single visual workbench:

```text
                    ┌─────────────────────┐
                    │    Human Design      │
                    │   Fixed Workflow     │
                    └──────────┬──────────┘
                               │
                               ▼
┌─────────────────┐     ┌───────────────┐     ┌──────────────────┐
│ Agent Autonomous │ ──► │ Organization  │ ◄── │ Runtime Human    │
│    Planning       │    │ Generation/   │     │  Intervention    │
│Meta-Orchestration│    │  Execution     │     └──────────────────┘
└─────────────────┘     └───────┬───────┘
                                │
                                ▼
                         ┌─────────────────┐
                         │  Self-directed   │
                         │  Experience      │
                         │    Learning      │
                         └────────┬────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │Organizational   │
                         │    Memory       │
                         │Assets + Experience│
                         └────────┬────────┘
                                  │
                                  └──────► Next Organization Generation
```

> Therefore, the project is hereby officially renamed from dsh Visual Workflow to: Visual Agent Orchestration Platform.

---

## Core Highlights

✦ **Agent Meta-Orchestration**
  - Agents are no longer limited to executing pre-drawn fixed DAGs. During orchestration, they can **retrieve organizational assets and experience, generate and adjust organizational structures based on the current task, and continuously improve through feedback reinforcement learning**

<p align="center">
  <img src="https://raw.githubusercontent.com/GZX2211/dsh-Visual-Workflow/main/assets/images/界面优化.png" width="100%" />
</p>

✦ **Human-in-the-loop Real-time Adjustment**
  - After humans modify the flow, the orchestrator perceives the latest topology in real time and dynamically adjusts subsequent orchestration; after Agents modify the graph, the canvas displays changes in real time, keeping orchestration and canvas always consistent — **observable and correctable** during execution.

<table>
  <tr>
    <td width="65%" valign="top">
      <img src="https://raw.githubusercontent.com/GZX2211/dsh-Visual-Workflow/main/assets/images/API服务模式.png" width="100%" />
    </td>
    <td width="35%" valign="top">
      <img src="https://raw.githubusercontent.com/GZX2211/dsh-Visual-Workflow/main/assets/images/终端输出.png" width="100%" />
    </td>
  </tr>
</table>

> Deploy DSH as a standalone backend service, persist headless Agents running in the background, and connect external apps (e.g., QQ bots, Feishu) or custom frontends.

✦ **Dual-Mode Architecture**
  - **Flow Orchestration Mode**: Intelligent scheduling for long-running multi-Agent workflows; parent agent autonomously advances; supports pause/resume from breakpoint and real-time status feedback.
  - **API Service Mode**: One-click publish as a standalone REST API service (OpenAI-compatible protocol), multi-tenant session isolation, automatic port allocation.

✦ **Deep Customization**
  - Each sub-agent node independently configures system prompt, LLM model, thinking intensity, tool combinations, ReAct iteration limit, and retry limit; the parent agent can also freely choose models and scheduling templates for fine-grained orchestration.

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/GZX2211/dsh-Visual-Workflow/main/assets/images/组合管理页.png" width="100%" />
    </td>
    <td width="50%" valign="top">
      <img src="https://raw.githubusercontent.com/GZX2211/dsh-Visual-Workflow/main/assets/images/MCP配置页.png" width="100%" />
    </td>
  </tr>
</table>

> Tools are freely combinable and assignable to individual agents, preventing useless tools from occupying context; MCP servers are auto-registered with a single line of configuration and support hot-reload for immediate effect.

✦ **Collaboration Groups & Agent Team**
  - Drag multiple role nodes into a collaboration group to connect with the official Agent Team mechanism, linking custom configurations to teammates. Precisely control collaboration behavior, models, tool groups, etc.; runtime and coordination tools are handled by the official mechanism.
  - When Agent Team is disabled, collaboration within the group degrades to the plugin's own communication mechanism, using the `wf_ask_agent` tool for intra-group communication.

✦ **Scheduled Triggers**
  - Built-in scheduled tasks in the workbench: select a workflow template, configure execution windows and trigger policies, automatically create instances and run them. Missed windows are automatically suspended/resumed, supporting off-peak API calls — saving money and effort.

<p align="center">
  <img src="https://raw.githubusercontent.com/GZX2211/dsh-Visual-Workflow/main/assets/images/定时任务管理.png" width="100%" />
</p>

> Fully automated operations management: scheduled automatic workflow execution, peak/off-peak time-shifted API calls, automatic suspension, flow data persistence, and automatic execution during off-peak hours.

✦ **Zero Official Package Dependencies**
  - All DSH ecosystem services (LLM, sub-agents, tools, user questions, etc.) are resolved at runtime via `ctx.get()`. Host tools are registered as plain object definitions. The plugin itself has no compile-time dependency on any official package, ensuring stronger upgrade compatibility.

---

## Core Concepts

| Concept | Description |
|------|------|
| **Meta-Orchestration** | An orchestration architecture that **retrieves organizational assets and experience during orchestration, generates and adjusts organizational structures based on the current task, and continuously improves through feedback reinforcement learning** |
| **Asset** | Roles, workflow configurations, rules, etc. that have been formally promoted and can be recalled by future orchestration; stored separately from templates with version control |
| **Template** | "Blueprint" for roles/files/databases/workflows, stored in `~/.dsh/visual-workflow/`; templates and instances are deeply decoupled via deep copy — modifying a template does not affect already-generated nodes |
| **Instance** | A specific running instance of a workflow or service (`workflows/` and `services/`); can only be created from a workflow template, editable on canvas and savable |
| **Node** | Cards on the canvas, categorized into parent agent, sub-agent, file, database, stage (start/end/pause), collaboration group, and virtual node |
| **Edge** | Transmits flow direction (flow edge), context content (context edge), database identifier (database edge); flow edges can carry condition labels, semantically evaluated by the parent agent |
| **Parent Agent** | The core scheduler of orchestration; in Mode 1 responsible for supervision and scheduling, in Mode 2 the final responder; can be directed by users to adjust the orchestration flow |
| **Sub-Agent** | Task executor; independently configures role prompt, model, tools, etc.; created and scheduled on demand by the parent agent |
| **Orchestration** | The main Agent autonomously advances the flow using tools like `wf_run_node` / `wf_finish`, controlling node states |
| **Mode** | The plugin provides two execution modes: Flow Orchestration Mode (Mode 1) and API Service Mode (Mode 2), switchable via the top bar |
| **Breakpoint Resume** | After flow pause or unexpected host interruption, executed node states are persisted; on recovery, they are not re-executed — execution continues from the breakpoint |
| **Collaboration Group** | Combines multiple role nodes into an Agent Team; members can freely communicate and collaborate within the group |
| **Virtual Node** | An alias reference to a primary node; stores no independent configuration, shares the primary node's execution instance, used for topology reuse |

<p align="center">
  <img src="https://raw.githubusercontent.com/GZX2211/dsh-Visual-Workflow/main/assets/images/资产管理与版本控制.png" width="100%" />
</p>

---

## Node Cards

### 1. Role Node (Task Execution Unit)

Card layout (**3 inputs on left, 2 outputs on right**):

```
        ┌─────────────────────────┐
  L1 ●│ [Role Card] Title        │● R1
(DB)   │  Type Badge / Model /    │(Context)
  L2 ●│  Tool Combo Badges       │● R2
(Ctx)  │                          │(Flow Out)
  L3 ●│                          │
(Flow) │                          │
       └─────────────────────────┘
```

| Port | Name | Semantics |
|---|---|---|
| L1 | Database Input | Connects to database nodes, injects retrieval/query tools |
| L2 | Context Input | Receives upstream context (not inherited if unconnected) |
| L3 | Flow Input | Controls execution order |
| R1 | Context Output | Passes this node's output to downstream |
| R2 | Flow Output | Sequential execution / conditional branching (pass/fail/content) |

**Property Configuration**:

| Config Item | Description |
|---|---|
| **Name** | Node name |
| **system prompt** | Text input or reference to .md; sets the role's system prompt |
| **LLM Model** | Independently select provider + model |
| **Thinking Intensity** | Consistent with official dropdown |
| **Tool Combination** | Built-in presets (Standard/Minimal/ptc/Creative) + custom combinations (created in Combination Management) |
| **ReAct Iteration Limit** | Soft cutoff: after reaching the limit, forced wrap-up (no new tool calls initiated, output existing conclusions), default 50 |
| **Retry Limit** | Node-level attempt count guard, default 3 |
| **Input/Output Data Structure** | Text/JSON description (assists model understanding) |
| **System Prompt Toggle** | Controls official system prompt injection (enabled by default); **disabling the tool prose section does not affect tool-calling capability** |

**Virtual Node**: Click "Copy" to generate a virtual node (dashed border + "↻ Reference" badge); shares configuration and execution instance with the primary node; cascade-deleted when the primary node is removed.

### 2. File Node

- File content stored directly in the template (text / PDF-extracted text / images and other non-text files stored at managed paths)
- Right-side property panel allows upload/replace; after saving, all referencing nodes are synchronized
- Purpose: Inject prompts, requirements, compressed summaries, and other context into role nodes

### 3. Database Node

- Local type: Supports SQLite files with built-in vector retrieval (bge-small-zh-v1.5, CPU inference; automatically degrades to BM25 if model assets are missing or fail to load)
- Server type: Supports MySQL / PostgreSQL, providing structured read-only queries and vector retrieval (locally built index)
- Right-side panel configures connection info, tests connections, and adjusts advanced retrieval options (recall count, chunk window, similarity threshold, index capacity)
- Purpose: Connect to enterprise/personal knowledge bases to retrieve relevant information and perform queries

### 4. Stage Node

- Start (Mode 1) / Input (Mode 2): Flow entry point; in Mode 2, automatically receives external user questions as initial context
- End (Mode 1) / Output (Mode 2): Flow endpoint; in Mode 2, aggregates parent agent's final output and returns it as a stream
- Pause (Mode 1): Flow gate; execution pauses here and saves a breakpoint (manual review point); next run continues from the right output

### 5. Collaboration Group Node (Agent Team)

- Drag multiple role nodes into a collaboration group; group members are registered as Teammates, launched in parallel, and participate in collaboration
- Collaboration Prompt is appended to the end of each member's first user message, automatically listing all members' IDs and role names (plugin collaboration mechanism, now superseded by the official mechanism, retained as fallback)
- Group Agents communicate asynchronously via `wf_ask_agent` and ask users questions via `wf_ask` (retained as fallback)
- Cards support stretch expansion; internal member list is scrollable

---

## Edges

**Edge Types and Colors**:

| Edge Type | Semantics | Color |
|----------|----------|------|
| Flow Edge | Controls execution order | ⚪ Cool Gray / Silver White |
| Context Edge | Transmits text content, file index | 🟡 Amber Gold |
| Database Edge | Transmits database service identifier | 🔵 Sky Blue |
| Condition: Pass | Condition evaluates true, execute this branch | 🟢 Emerald Green |
| Condition: Fail | Condition evaluates false, execute this branch or loop back | 🔴 Coral Red |
| Condition: Content | Custom semantic evaluation (routing label) | 🟣 Violet |

> After editing a condition, the condition color overrides the initial color; condition evaluation is performed semantically by the parent agent.

---

## Orchestration Tools

The following tools constitute the primary control plane of the current orchestration layer:

| Tool | Purpose |
|---|---|
| **`wf_run_node`** | Mode 1: asynchronously launch an Agent node or an entire collaboration group; returns immediately without blocking the parent agent |
| **`wf_run_node_wait`** | Mode 2: launch an Agent node and block-wait, returning `ok / fail` with final output |
| **`wf_finish`** | Mark this orchestration as complete/failed, persist run records, and release the run lock; idempotent |
| **`wf_ask`** | Sub-agent initiates an official question card to the user on the "main interface" and waits for a response; supports question queue |
| **`wf_ask_agent`** | Non-blocking `ask / reply` message communication between Agents within a collaboration group; cold recovery supported when target is offline |
| **`wf_db_query`** | Database read-only access in three modes: `search / query / schema` |
| **`wf_org_catalog`** | Recall organizational assets, tool combinations, presets, models, and orchestration rules; parent agent only |
| **`wf_graph_patch`** | Controlled graph modification on workflow templates or running instances; supports create, update, delete, edge adjustment, etc. |
| **`wf_experience_learn`** | Store the subject's own experiences: call with an empty array to get the generation prompt, or submit candidates for validation and storage (available to all agents) |
| **`wf_experience_recall`** | Semantic recall of existing experiences by subject type: first fetch candidate summaries, then fetch full content by id (available to all agents) |

> Difference: Unlike official Teammate scheduling which can only pass the parent's tools and model, Agent nodes created by `wf_run_node` can freely combine any tools, set different models, and define different system prompts.

---

## Installation (Windows)

> **Version Compatibility**: This plugin is compatible with **DeepSeek Harness `0.2.0-rc.1`**. Please install or upgrade the host first (fully stop the dsh process in an external terminal before upgrading):
>
> ```bash
> npm install -g @deepseek-ai/dsh@0.2.0-rc.1
> ```
> Tips: You can directly copy the following section to an AI assistant such as Claude Codex to install this plugin.

1. **Locate via File Manager**: `%USERPROFILE%\.dsh\profiles\web\pnpm-workspace.yaml`, add the following:

```yaml
allowBuilds:
  onnxruntime-node: true
  protobufjs: true
  sharp: true
```

2. **Run the plugin installation command**:

```bash
dsh plugin --profile web add "github:GZX2211/dsh-Visual-Workflow#main"
```

3. **Verify mounting**: (optional)

```bash
dsh --profile web --dump-config | findstr "visual-workflow"
```

4. **Restart** `dsh web`. Open the workbench: click the **"Workflow" entry at the bottom of the official left sidebar** (next to the official "Settings") → open the "Workflow" tab in the official **right Sidebar** to access the full workbench.

### Installation Troubleshooting

**Encountering `Host key verification failed` error**

Run in **PowerShell** or **CMD**:

```bash
git config --global url."https://github.com/".insteadOf "git@github.com:"
```

**pnpm interception notice: `prepare` declared, `allowBuilds` required** (common)

Locate via File Manager: `%USERPROFILE%\.dsh\profiles\web\pnpm-workspace.yaml`, add the package names from the error message to the `allowBuilds` list, save, and reinstall.

### Uninstall

```bash
dsh plugin --profile web remove dsh-visual-workflow
```

> If no longer in use, also clean up: `~/.dsh/visual-workflow/` folder.

---

## Quick Start

### Approach 1: Manually Design a Workflow

1. Open the "Workflow" workbench.
2. Create a workflow template.
3. Create role templates.
4. Drag roles, files, databases, stages, and collaboration groups onto the canvas.
5. Connect with `flow / ctx / db` edges.
6. Configure each Agent's model, Prompt, and tool combination.
7. Create an instance.
8. Click Run.

### Approach 2: Let the Agent Design the Organization

In the main session, enter:

```text
/arrange <your planning intent>
```

For example:

```text
/arrange Build a content production pipeline with five stages: topic selection, research, drafting, review, and publishing
```

The Agent will:

```text
Natural Language Intent
    ↓
wf_org_catalog
    ↓
Read relevant assets / experience / rules
    ↓
Generate organization plan
    ↓
wf_graph_patch
    ↓
Create / modify workflow template
    ↓
User confirmation
    ↓
Run
```

`/arrange` itself only injects planning instructions; it does not automatically run the workflow upon planning completion.

### Approach 3: Runtime Manual Adjustment

After running a Workflow:

1. Observe real-time node states on the canvas.
2. Directly modify nodes or edges on the canvas.
3. Save changes.
4. The orchestrator perceives the latest topology.
5. Subsequent scheduling continues based on the latest organization.

You can also use `pause` nodes in the flow to establish manual review points.

### Approach 4: Agent Automatically Adjusts Organization During Runtime

When the parent agent discovers from runtime facts that the current organization is no longer suitable, it will call `wf_graph_patch` to modify the current instance itself:

For example:

```text
Current Organization
A → B → C

Discovers B is unsuitable for the current task

Dynamic Adjustment
A → D → C
```

Modifications undergo graph validation, organizational budget, and revision checks before being persisted, and are synchronized to the runtime fact source.
You can also disable this tool in the **Combination Management** interface to prevent agents from self-adjusting. Similarly, all other features can be adjusted at runtime directly through tool management.

> **Combination Management**: The "Combination" button in the top bar allows creating custom tool combinations (official tools/custom tools + MCP servers), which can be selected in role modes.
> **Scheduled Tasks**: The "Scheduled Tasks" entry in the top bar; select a workflow template, configure execution windows and trigger policies, and automatic scheduling begins.
> **Cold Start**: Assets and experience cannot be generated on first use. If you want the Agent to have excellent organizational capabilities from the start, it is best to introduce high-quality external prompts.

---

## Data Storage

All files are located in `~/.dsh/visual-workflow/`, human-readable JSON:

```
workflows/                  # Mode 1 workflow instances
services/                   # Mode 2 service instances
flow-templates/             # Editable Workflow templates
roles/                      # Editable role templates
files/                      # File templates
databases/                  # Database templates
combos.json                 # Custom tool combinations

runs/                       # Run snapshots and history
orchestrations/             # Orchestration fact source during runtime

assets.db                   # Formal role/workflow assets + Experience
data/files/                 # Managed non-text files
data/vector/                # Database vector indexes
scheduler/                  # Scheduled task definitions and trigger records
```

---

## Configuration

Default values can be overridden in `cordis.patch.yml`:

```yaml
- insert:
    - id: visual-workflow
      name: dsh-visual-workflow
      config:
        dataDir: !!js dshHomePath('visual-workflow')
        servicePortBase: 7860
        apiKey: null
        maxConcurrentPerService: 50
        wfAskAgentTimeoutMs: 120000
        runIdleTimeoutMs: 1800000
        reactIterationLimitDefault: 50
        retryLimitDefault: 3
        outputFullLimit: 102400
        documentTextLimit: 20000
        embeddingModelDir: null
        embeddingEndpoint: null
        runPollMs: 2000
```

---

## Local Development

```bash
git clone https://github.com/GZX2211/dsh-Visual-Workflow.git
cd dsh-visual-workflow
pnpm install
dsh plugin --profile web add "link:$PWD"
```

Common commands:

```bash
pnpm typecheck      # Host / Client / Test type checking
pnpm build          # Build Host + Client
pnpm test           # Unit tests
pnpm gates          # Contract / gate tests
pnpm client-smoke   # Client smoke tests
pnpm check          # Type check + test + build + smoke
pnpm verify         # Full verification gate
```

> Modifying Client requires rebuilding and hard-refreshing the browser; modifying Host requires restarting `dsh web`.

---

## Directory Structure (Core)

```
dsh-visual-workflow/
├── src/
│   ├── host/
│   │   ├── shared/               # Frontend/backend shared pure type contracts
│   │   ├── agent/                # Agent creation, model selection, Prompt injection, execution guardrails
│   │   ├── assets/               # SQLite asset library and experience persistence
│   │   ├── experience/           # Experience domain (validation/projection/vectors/dedup/recall/subject resolution)
│   │   ├── orchestrator/         # Runtime, state machine, dynamic orchestration, runtime facts, team-experience injection
│   │   ├── tools/                # wf_* orchestration tools
│   │   ├── graph/                # Graph model, structural validation, organizational constraints and budget
│   │   ├── team/                 # Agent Team capability adaptation
│   │   ├── storage/              # Template/instance/run record file storage
│   │   ├── embedding/            # Vector embedding and indexing
│   │   ├── mcp/                  # MCP registration and configuration
│   │   ├── scheduler/            # Scheduled tasks
│   │   ├── service/              # Mode 2 service management
│   │   ├── api/                  # GUI API
│   │   ├── commands/             # /arrange and other commands
│   │   └── prompts/              # Orchestration, planning, team-experience Prompts
│   │
│   └── client/
│       ├── sidebar/              # Official Sidebar slot and workbench entry
│       ├── studio/               # Workbench main state and state machine
│       ├── components/           # Canvas, assets, history, scheduled tasks and other UI
│       ├── hooks/                # UI / data single-responsibility hooks
│       ├── styles/               # Style files
│       └── lib/                  # graph / remote / storage and other pure logic
│
├── tests/                        # Unit, integration, and contract tests
├── scripts/                      # Build, smoke, and development scripts
├── assets/models/                # BGE-small-zh-v1.5 and other model assets
├── docs/                         # Architecture docs and archives
├── cordis.patch.yml              # Web profile mounting layer
├── serve.patch.yml               # Mode 2 service process composition layer
└── package.json
```

---

## Core Research Directions (Roadmap)

The project's research direction has shifted from "how to design a better Workflow" to:

 **How to enable Agents to dynamically form, adjust, and continuously leverage an intelligent organization suited to the current objective based on the task at hand**

> The long-term goal of the project is to explore the ultimate implementation and boundaries of meta-orchestration architecture — to build a continuously evolving AI system.
> Attaching to a mature Harness plugin framework is an excellent starting point. We hope to continue improving and deliver a high-quality "product" for the dsh plugin ecosystem.

---

## License

[MIT](LICENSE) © GZX2211. Issues / PRs welcome. Community project; UI form factor references [dsh-deepseek-flow](https://github.com/kanghelyu/dsh-deepseek-flow).