# Architecture

<p>
  <b>English</b> · <a href="architecture.md">简体中文</a>
</p>

This document describes the core architecture, design intent, and key trade-offs of this project.

---

## 1. Problem and Positioning

Traditional workflows constrain the execution process with predefined structures, whereas autonomous agent collaboration allows agents to dynamically decide task division and execution paths. The former has a clear structure but limited adaptability; the latter is flexible, but its execution organization cannot necessarily be explicitly expressed and continuously governed.

This project explores a more general architectural direction between the two: enabling agent execution organization to be explicitly defined, persisted, and observed, while also being dynamically adjusted during execution, with support for human intervention and experience reuse.

`dsh-visual-workflow` is built on DeepSeek Harness. It expresses execution organization as a graph structure, drives dynamic orchestration through a parent agent, maintains execution continuity through independent runtime state, and supports continuous improvement through organizational assets and experience accumulation.

The core of the project is not to choose one mode between fixed workflows and autonomous agents, but to enable the authority to design organizational structure, make execution decisions, and adjust at runtime to be allocated as needed.

---

## 2. Core Architecture

The overall layering is as follows:

```text
┌─────────────────────────────────────┐
│                Client               │
│   Visualization, observation, and   │
│          human intervention         │
└──────────────────┬──────────────────┘
                   │ API
┌──────────────────▼──────────────────┐
│                 Host                │
│                                     │
│   Graph structure and orchestration │
│   Definition, planning, adjustment  │
│   Runtime state and scheduling      │
│   Advancement, waiting, recovery    │
│   Organizational assets and         │
│   experience                        │
│   Retrieval, accumulation, reuse    │
└──────────────────┬──────────────────┘
                   │ Capabilities provided by Harness
┌──────────────────▼──────────────────┐
│           DeepSeek Harness          │
│  Agent Runtime, Session, Tools, etc.│
└─────────────────────────────────────┘
```

### 2.1 Explicit Execution Organization

A workflow is not merely a list of nodes to be executed; it also expresses phase division, responsibility allocation, dependency relationships, and structural changes. It can be designed in advance by humans or generated and adjusted by a parent agent based on task goals and execution conditions.

The graph structure provides an inspectable expression of the organization, and the state shown on the graph is the actual execution process. The architecture must maintain sufficient correspondence among structure, runtime state, and actual behavior to support tracing, review, and intervention.

### 2.2 Separation of Structure and Execution State

Workflow structure describes how the organization is arranged, runtime state records where execution has progressed, and Agent Context carries the agent's current conversation context. The three serve distinct responsibilities.

Separating runtime state from Agent Context means execution continuity does not have to depend on the permanent survival of a particular agent context, and provides a foundation for agent rotation, context reconstruction, and run recovery.

### 2.3 Parent-Agent-Driven Dynamic Orchestration

The parent agent is the subject of orchestration decisions and is responsible for task decomposition, responsibility allocation, execution coordination, and structural adjustment; the runtime is responsible for execution mechanisms, state maintenance, and the recording and feedback of deterministic facts such as timeouts and failures.

This division separates semantic decision-making from deterministic execution mechanisms: the runtime does not presume to decide the next business-level action, while the parent agent makes orchestration judgments based on goals, context, and runtime facts. Structural changes are made through governed mechanisms rather than directly modified by arbitrary child agents.

### 2.4 Organizational Assets and Experience Reuse

Organizational configurations and execution experience can serve as reusable assets that are retrieved and used in subsequent tasks. With runtime feedback and human confirmation, the system can gradually improve organizational configurations and orchestration decisions, rather than treating every execution as a one-off process.

The goal here is to support controlled continuous evolution, not to assume that the system can fully and correctly transform itself autonomously.

---

## 3. Key Design Trade-offs

| Design Choice | Primary Benefit | Cost Accepted |
| --- | --- | --- |
| Explicit graph structure rather than fully implicit agent collaboration | Organizational relationships are observable, inspectable, and adjustable | Requires maintaining consistency between the graph structure and actual execution behavior |
| Parent-agent-driven rather than fully advanced by a deterministic engine | Enables dynamic orchestration based on task and runtime conditions | Increases model calls, token costs, and decision uncertainty |
| Separation of structure, runtime state, and Agent Context | Supports context reconstruction, agent replacement, and run recovery | Increases complexity of state management and consistency maintenance |
| Extending on Harness rather than rebuilding Agent Runtime | Reuses existing runtime capabilities and reduces duplicate implementation | Orchestration capabilities are constrained by the interfaces and runtime mechanisms provided by Harness |
| Reusable organizational assets and experience rather than relying only on single executions | Supports cross-task accumulation and continuous improvement | Requires handling experience filtering, applicability scope, and feedback quality |

These trade-offs do not imply that this project has a better orchestration approach. It pursues a configurable orchestration architecture: choosing an appropriate balance among structural constraints, agent autonomy, and human governance according to task uncertainty and control requirements.

---

## 4. Architectural Invariants

The following constraints define long-term architectural boundaries:

1. **Harness First.** Agent Runtime and other foundational execution capabilities are provided by DeepSeek Harness. This project extends through its public capabilities and does not reimplement or modify the Harness core runtime within the plugin.
2. **Separation of Structure and State.** Workflow structure, runtime state, and Agent Context each have clear responsibilities. A single agent context is not used as the sole carrier of long-term execution state.
3. **Governed Structural Changes.** Child agents cannot directly modify workflow structure; structural adjustments during execution are initiated by the parent agent through governed mechanisms.
4. **Separation of Runtime Facts and Semantic Decisions.** The runtime provides verifiable state and execution facts; the orchestration agent is responsible for semantic judgments based on these facts.
5. **Tri-State Separation of Templates, Instances, and Assets.** Subsequent modifications to a template should not implicitly change already-created run instances, and run instances and templates should not affect assets that need to serve as long-term reusable resources.
6. **Evolution Depends on Assets and Feedback.** Execution experience and organizational configurations can be accumulated, filtered, and reused, but runtime facts themselves do not automatically constitute valid experience.

These constraints define architectural boundaries and are used to evaluate design changes. The concrete implementation is governed by code and tests; when long-term architectural principles change, this document should be updated accordingly.