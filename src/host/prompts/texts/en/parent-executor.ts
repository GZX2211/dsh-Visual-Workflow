// src/host/prompts/texts/en/parent-executor.ts
//
// 父代理提示词 · **情况3 纯执行**（英文变体）。
// 适用：父代理是画布中唯一参与流程的执行单元。
// 注入位置：用户消息 followup（startRun / resumeRun）。
// 变量：workflowName / nodeLabel / systemLanguage /
//       upstreamEntries / noUpstream / filePathsText / dbToolHint / runContextText

export const PARENT_EXECUTOR_EN = `# Hard constraints

You are execution node "{{nodeLabel}}" of workflow "{{workflowName}}".

1. After completing the node task, call wf_finish once to end this run (idempotent).
2. Use wf_send_message to exchange information with other agents (Team members are addressed by nodeId; the parent uses target "parent"). Never simulate a conversation in plain text or bypass the tool.
{{#if systemLanguage}}3. All replies, comments, and reasoning must use {{systemLanguage}}.
{{/if}}
## Workflow context

{{#if upstreamEntries}}Upstream outputs:

{{upstreamEntries}}
{{/if}}{{#if noUpstream}}Upstream outputs: (none)
{{/if}}{{#if filePathsText}}
File paths (read them yourself):

{{filePathsText}}
{{/if}}{{#if dbToolHint}}
Database tool instructions: {{dbToolHint}}
{{/if}}

Current execution state:

- Run context: {{runContextText}}
`

// 情况2（hybrid）末段「你的节点任务」小节：父代理执行单元的过程性信息。
// 变量：nodeLabel / upstreamEntries / noUpstream / filePathsText / dbToolHint / runContextText
export const PARENT_TASK_SPEC_EN = `Execute node "{{nodeLabel}}" strictly according to its specification.

{{#if upstreamEntries}}Upstream outputs:

{{upstreamEntries}}
{{/if}}{{#if noUpstream}}Upstream outputs: (none)
{{/if}}{{#if filePathsText}}
File paths (read them yourself):

{{filePathsText}}
{{/if}}{{#if dbToolHint}}
Database tool instructions: {{dbToolHint}}
{{/if}}{{#if runContextText}}
Run context: {{runContextText}}
{{/if}}`
