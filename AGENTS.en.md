# Root AGENTS.md

## Project Positioning

`dsh-Visual-Workflow` is a visual multi-Agent Workflow orchestration plugin within the DeepSeek Harness ecosystem.

Core directions:

- Visual Workflow / DAG orchestration
- Parent Agent autonomous orchestration and runtime governance
- Dynamic Workflow structure adjustment
- API service mode
- Future-oriented Meta-Orchestration

The project is built as a DeepSeek Harness extension and does not replace or modify the dsh core framework.

---

## Repository Governance System (Authoritative Source)

`AGENTS.md` is organized in three layers. Each layer only contains rules within its own scope; the same rule is not repeated across layers.

| Layer | File | Scope | Content Responsibility |
|---|---|---|---|
| Repository layer | `AGENTS.md` | Entire repository | General repository-wide conventions |
| Host/Client layer | `src/host/AGENTS.md`, `src/client/AGENTS.md` | Frontend/Backend | Shared frontend/backend rules |
| Module layer | `src/host/<module>/AGENTS.md` | Single module | Module-specific rules only |

`tests/AGENTS.md` is parallel to the module layer.

---

## Project Navigation

```
dsh-visual-workflow/
├── src/
│   ├── host/                     # Host plugin
│   │   ├── shared/               # Shared pure type contracts between frontend and backend
│   │   ├── storage/              # Persistent storage
│   │   ├── assets/               # SQLite asset library and experience persistence
│   │   ├── experience/           # Experience domain (validation/projection/vector/deduplication/recall/subject resolution)
│   │   ├── orchestrator/         # Run locks, breakpoint state machine, bidirectional sync
│   │   ├── agent/                # Sub-agent execution engine, guardrails, prompt injection
│   │   ├── tools/                # wf_* tool registration
│   │   ├── team/                 # Official Agent Team capability adapter
│   │   ├── api/                  # GUI HTTP API boundary
│   │   ├── mcp/                  # Host-side MCP configuration registry
│   │   ├── transfer/             # Import/export
│   │   ├── service/              # Mode 2 service
│   │   ├── sessions/             # Session provider
│   │   ├── embedding/            # Local vector embedding and indexing
│   │   ├── scheduler/            # Scheduled tasks
│   │   ├── graph/                # Graph model validation
│   │   ├── commands/             # / command registration
│   │   └── prompts/              # Orchestration prompt templates
│   └── client/                   # WebUI source code
│       ├── sidebar/              # Right sidebar tabs / sidebar entry / persistent container
│       ├── studio/               # Main state machine
│       ├── styles/               # Style files
│       ├── components/           # Canvas, assets, history, scheduled tasks, and other UI components
│       ├── hooks/                # Single-responsibility hooks
│       └── lib/                  # Pure logic (remote/graph-model/bundle/storage)
├── tests/                        # Test files (client / host / contract / integration)
├── scripts/                      # Build and watch scripts
├── cordis.patch.yml              # Web profile mount layer
├── docs/                         # Unified documentation storage
└── package.json
```

---

## Core Architecture Constraints

The following rules are hard constraints and must not be violated unless an explicit architecture change is being made.

* Do not modify the dsh underlying core framework.
* Prefer non-invasive extension mechanisms such as patches, event observation, and `ctx` services.
* `@deepseek-ai/*` must not be used as direct runtime dependencies (do not add to `dependencies`); use them through the runtime capability acquisition mechanism.
* `@huggingface/transformers` is an allowed third-party runtime dependency.

---

## Prompt Governance

- Adding prompts: create a new file under `texts/` or add to a related file, rendered once by a builder under `src/host/prompts/` and injected.
- Do not write prompt body text into business modules, and do not split it into small fragments assembled across files using constants.
- Modifying prompts: directly edit the body text of the corresponding file under `texts/`; changing the text changes the behavior.
- One file per scenario: different modes of the same role each have their own complete text.

---

## Dependencies and Isolation

* Host and Client use independent TypeScript Programs.
* `src/host/shared/` may only contain pure types or runtime-dependency-free contracts shared between Host and Client.
* Client must not import Host runtime modules.
* Host must not depend on Client implementations.

---

## Development Conventions

- Use TypeScript strict mode; use `import type` uniformly for type imports. Public functions must explicitly declare parameter and return types; internal functions prefer type inference.
- Use React function components and hooks; Client state is managed through the established unidirectional state flow mechanism.
- Prefer pure functions for core logic; runtime capabilities are injected through minimal interfaces. Maintain unidirectional dependencies and avoid circular dependencies; place shared logic in modules with clear responsibilities, and do not create aggregate files such as `utils.ts` or `helpers.ts` without a clear responsibility.
- Files use `kebab-case`; variables, functions, and parameters use `camelCase`; types, interfaces, classes, and components use `PascalCase`. Names should describe responsibilities, not implementation approaches.
- Each file has one clear responsibility and ideally only one primary reason to change; split different responsibilities into independent modules.
- When modifying public interfaces, Tool Schemas, data structures, or runtime contracts, you must synchronously check callers, tests, and related content.

---

## Comment Conventions

- Principle: comments only supplement information not expressed by the code, and only explain why (non-obvious constraints, workarounds, decision context, pitfalls); if deleting them does not affect understanding, do not write them.
- Prohibited: historical narratives; line number/internal document pointers; restating code; asserting external library behavior.
- Retained: file first-line path header comment, formatted as `// <repository-root-relative-path>`. Only **directive first lines** may precede it — runtime/compile directive comments such as Node shebang (`#!/usr/bin/env node`) and `// @vitest-environment …`; in such cases the path header immediately follows.
- Required: compatibility and degradation (branch conditions, failure behavior); invariants/preconditions; business/security rules; design rationale that cannot be inferred from the code.
- Writing style: close to the code being described; use the corresponding documentation comment format (JSDoc/TSDoc) for public APIs, writing only natural language and leaving structural tags to tools; concise, precise, and accurate, with length limited to what is necessary.
- Synchronously update or delete comments when behavior changes; when synchronization is not possible, deletion is preferable to retaining incorrect comments.

---

## Changes and Verification

Choose the minimal verification based on the change; when uncertain, run `pnpm check`.

| Change Content | At Minimum Execute |
|---|---|
| Pure documentation (`docs/`, `*.md`) | None required |
| Any `src/` code | `pnpm typecheck` + `pnpm test` |
| Client copy (`src/client/i18n.ts`), styles (`src/client/styles/**`), component copy or class names | `pnpm check` |
| Shared contracts (`src/host/shared/**`), endpoint names / tool names / error codes | `pnpm check` |
| `package.json`, build scripts, `lib/` artifacts | `pnpm check` |

---

## Before Modifying Code

Before making non-trivial changes, clarify:

1. Which module does the change belong to?
2. What is that module responsible for?
3. What is the current problem?
4. Why should this be modified here?
5. Are there other related modules?
6. Does it change public interfaces?
7. Does it change runtime behavior or state machines?

Do not assume a file is the correct place to modify just because a problem manifests in that file.

---

## Special Notes

* Do not read files in the root `prompt/` directory unless the user explicitly specifies them.
* You do not need to read each module's AGENTS.md; when you enter the corresponding module, it will be automatically injected into your context.