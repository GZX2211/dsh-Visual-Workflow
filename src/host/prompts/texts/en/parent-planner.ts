// src/host/prompts/texts/en/parent-planner.ts
//
// 父代理提示词 · **规划期**（/arrange 注入；此时没有运行实例）（英文变体）。
// 三种目标（create / template / instance）只差 identity、goal 与 grammar 三个变量。
// 注入位置：用户消息 followup（/arrange）。
// 变量：identity / grammar / goal / systemLanguage / userIntent / userSop

export const PARENT_PLANNER_EN = `# Hard constraints

{{identity}}

1. {{grammar}}
2. Plan templates only: do not create instances or start runs at this stage; whether to deploy is the user's decision.
3. Load the rules before editing: call wf_org_catalog without ids to get the orchestration rules and existing assets, inspect the workspace facts, and only then submit a patch.
4. wf_org_catalog and wf_graph_patch are enabled by default. If either tool is unavailable, ask the user to enable it in tool combination management and retry; do not edit the graph by another route.
{{#if systemLanguage}}5. All replies, comments, and reasoning must use {{systemLanguage}}.
{{/if}}
## Workflow context

{{goal}}

Current planning task:

- User intent: {{userIntent}}
{{#if userSop}}
[User SOP] (user-editable injection point; highest priority):

{{userSop}}
{{/if}}`
