// src/host/prompts/texts/child-node-task.ts
//
// 子代理任务块 · **每次运行注入给节点子代理的那一段**（首条用户消息 / 复用派发消息）。
// 注入位置：用户消息（随 wf_run_node 启动或复用派发投递；协作块追加在本段末尾）。
// 变量：nodeLabel / systemLanguage / collabRule / collabIndex /
//       upstreamEntries / noUpstream / filePathsText / inputContract / outputContract / dbToolHint
export const CHILD_NODE_TASK = `# 硬性约束

你正在执行节点「{{nodeLabel}}」。

{{#if systemLanguage}}1. 所有对话回复、注释、思考过程必须使用{{systemLanguage}}。
{{/if}}{{#if collabRule}}{{collabIndex}}. {{collabRule}}
{{/if}}
## 流程上下文

{{#if upstreamEntries}}上游产出：

{{upstreamEntries}}
{{/if}}{{#if noUpstream}}上游产出：（无）
{{/if}}{{#if filePathsText}}
文件路径索引（自行读取）：

{{filePathsText}}
{{/if}}{{#if inputContract}}
输入契约（你应当收到的输入）：

{{inputContract}}
{{/if}}{{#if outputContract}}
输出契约（你的最终回复必须按其组织）：

{{outputContract}}
{{/if}}{{#if dbToolHint}}
数据库工具说明：{{dbToolHint}}
{{/if}}`;
// 降级通道协作块（官方 Team 不可用时追加到成员任务消息末尾）。
// 变量：membersText / official / legacy / custom
export const CHILD_COLLAB_BLOCK = `你是 Team 的成员。本组成员为：
{{membersText}}
{{#if official}}与其他成员通信时，请使用 send_message 工具，target 填对方的成员名；需要 Lead 决策时 target 填 "lead"。{{/if}}{{#if legacy}}与其他成员通信时，请使用 wf_ask_agent 工具，并将 targetChildId 填为对方成员 id。{{/if}}
{{#if custom}}
组内说明：

{{custom}}
{{/if}}`;
//# sourceMappingURL=child-node-task.js.map