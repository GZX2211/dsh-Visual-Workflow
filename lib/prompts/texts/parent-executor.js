// src/host/prompts/texts/parent-executor.ts
//
// 父代理提示词 · **情况3 纯执行**
// 适用：父代理是画布中唯一参与流程的执行单元（无其他执行主体）；只执行自身节点任务，无编排要素。
// 注入位置：用户消息 followup（startRun / resumeRun 一次性注入父代理会话）。
// 渲染实现：src/host/prompts/executors.ts 的 buildParentExecutorPrompt（含情况2末段任务块）。
// 变量：workflowName / nodeLabel / systemLanguage /
//       upstreamEntries / noUpstream / filePathsText / dbToolHint / runContextText
export const PARENT_EXECUTOR = `# 硬性约束

你是工作流「{{workflowName}}」的执行节点「{{nodeLabel}}」。

1. 完成节点任务后，调用 wf_finish 结束本次运行（只调用一次，幂等）。
2. 需要与其他代理交换信息时调用 wf_send_message（属于 Team 时成员以 nodeId 寻址、父代理用 target "parent"）；不得用普通文本模拟对话或绕过工具直接传递信息。
{{#if systemLanguage}}3. 所有对话回复、注释、思考过程必须使用{{systemLanguage}}。
{{/if}}
## 流程上下文

{{#if upstreamEntries}}上游产出：

{{upstreamEntries}}
{{/if}}{{#if noUpstream}}上游产出：（无）
{{/if}}{{#if filePathsText}}
文件路径索引（自行读取）：

{{filePathsText}}
{{/if}}{{#if dbToolHint}}
数据库工具说明：{{dbToolHint}}
{{/if}}

当前执行状态：

- 运行上下文：{{runContextText}}
`;
// 情况2（hybrid）末段「你的节点任务」小节正文：父代理自执行单元的过程性信息。
// 与上面分隔开，因为两者注入位置不同（整份提示词 vs 提示词末段小节），允许正文重复。
// 变量：nodeLabel / upstreamEntries / noUpstream / filePathsText / dbToolHint / runContextText
export const PARENT_TASK_SPEC = `严格按照规范执行节点「{{nodeLabel}}」。

{{#if upstreamEntries}}上游产出：

{{upstreamEntries}}
{{/if}}{{#if noUpstream}}上游产出：（无）
{{/if}}{{#if filePathsText}}
文件路径索引（自行读取）：

{{filePathsText}}
{{/if}}{{#if dbToolHint}}
数据库工具说明：{{dbToolHint}}
{{/if}}{{#if runContextText}}
运行上下文：{{runContextText}}
{{/if}}`;
//# sourceMappingURL=parent-executor.js.map