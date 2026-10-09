# i18n / English Translation Audit

> Where Chinese text remains in the repo and the concrete actions needed to improve English
> coverage of the **interface** and the **documentation**.
> Updated: 2026-10-09 (issue #1 merged upstream; issue #2 implemented).
> Plan entries map to the open i18n issues in `lordraiden/dsh-Visual-Workflow`.

## 1. Current state (quantified)

| Area | State | Notes |
|---|---|---|
| `src/client/i18n.ts` | **Complete** | Bilingual dictionary with zh/en key symmetry enforced by `tests/contract/client-copy.test.ts` (key-path symmetry, no duplicate keys, no dead keys, no `t.x ?? '…'` literal fallback). |
| `src/client` (rest) | **Complete** | The only frozen inline copy left is `lib/layout.ts` (2 internal layout diagnostics with no UI consumer); `COPY_BASELINE` is bidirectionally locked to exactly that. |
| `src/host/api/**` (tool cards) | **Complete (issue #2)** | `TOOL_ZH` + `TOOL_EN` with a key-parity gate in `tests/host/api/tool-descriptions.test.ts`; the `[EN]` marker only applies in the Chinese UI. |
| `src/host/api/**` (errors/defaults) | **Complete (issue #2)** | Boundary-owned GUI-visible text goes through `presentationOf(host, zh, en)`; stable error codes and HTTP status are unchanged. |
| `src/host/<domain>/**` messages | **Deferred** | Validation messages from `scheduler`, `storage/flow-store`, `transfer` and `assets` still reach GUI toasts in Chinese; tracked by a separate follow-up issue because several of them are also agent-facing (issue #4). |
| `src/host/prompts/**` | **Intentionally Chinese** | Prompt bodies stay Chinese; `src/host/system-language.ts` only injects the reply-language rule. |
| `docs/architecture.md` | Pending (issue #3) | Single active living doc, still Chinese. |
| `package.json`, CI, hooks | Pending (issue #3) | `description` and human-facing CI/hook wording still Chinese. |
| `assets/` | Pending (issue #5) | Chinese screenshot filenames plus `测试数据库.sqlite`. `assets/models/bge-small-zh-v1.5` is Chinese by design — do not touch. |
| `lib/` | **Versioned artifacts** | Mirrors `src/`; must be rebuilt and committed with every `src/` change (CI diffs `lib/`). |

### Already governed

- Client copy rule: user-facing strings must go through the dictionary; mechanically locked by
  `tests/contract/client-copy.test.ts`.
- Tool **descriptions** (model-facing) are English by design in `src/host/tools/*/tool.ts`.
- `src/host/system-language.ts` reads the official `locale.preference` and is now also exposed to the
  API boundary through the optional `ApiHost.systemLanguage` capability, so GUI presentation and
  prompt language share one settings read.

## 2. Actions

### Done

| # | Action | Status |
|---|---|---|
| 1 | Migrate the 8 `COPY_BASELINE` client files into `i18n.ts` (zh + en). | Done (issue #1, PR #11) |
| 2 | `TOOL_EN` beside `TOOL_ZH` + language-aware card description. | Done (issue #2) |
| 3 | GUI-visible API errors/defaults owned by `src/host/api/**` localized via `presentationOf`. | Done (issue #2) |

### Pending

| # | Action | Issue |
|---|---|---|
| 4 | Translate `docs/architecture.md` (single canonical English representation; no divergent twin). | #3 |
| 5 | `package.json` `description` → English; CI step names and `.githooks/pre-commit` messages → English. | #3 |
| 6 | Rename non-semantic Chinese asset filenames and update every reference atomically. | #5 |
| 7 | Localize **domain-module** messages that reach the GUI (policy decision first: per-consumer language vs code-based catalog). | follow-up |

### Out of scope (decided)

| # | Decision |
|---|---|
| 8 | Agent-facing errors in `src/host/tools/**`, `graph/**`, `orchestrator/**`, `assets/**` stay Chinese for now (issue #4). |
| 9 | `src/host/prompts/**` stays Chinese; only the injected reply-language rule follows the locale. |
| 10 | `docs/archive/**` is a historical record and is not translated. |
| 11 | No Host-side i18n contract gate is required for the current initiative (revisit only if real regressions appear). |

## 3. Risks / constraints

- `COPY_BASELINE` is bidirectionally locked: migrating a string **requires** deleting its baseline entry
  in the same change, and vice versa.
- `lib/` is versioned: every `src/` edit needs `pnpm build` and a committed `lib/` delta.
- Do not translate the `bge-small-zh` embedding model assets (the model is Chinese by design).
- `prompt/` is dev scratch — excluded per root `AGENTS.md`.
- GUI presentation language is resolved Host-side from `locale.preference`; the client's browser-language
  fallback has no Host equivalent, so a user with no stored preference and a non-Chinese browser can see an
  English UI with Chinese boundary text until the preference is set.
