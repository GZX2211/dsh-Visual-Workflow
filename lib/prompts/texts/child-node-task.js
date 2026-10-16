// src/host/prompts/texts/child-node-task.ts
//
// 子代理任务块 · **每次运行注入给节点子代理的那一段**（首条用户消息 / 复用派发消息）。
// 注入位置：用户消息（随 wf_run_node 启动或复用派发投递；可通信对象清单是本段的一节）。
// 变量：nodeLabel / systemLanguage / upstreamEntries / noUpstream / filePathsText /
//       inputContract / outputContract / dbToolHint / commTargets / collabNote
export const CHILD_NODE_TASK = `# 硬性约束

你正在执行节点「{{nodeLabel}}」。

{{#if systemLanguage}}1. 所有对话回复、注释、思考过程必须使用{{systemLanguage}}。
{{/if}}
## 流程上下文

{{#if upstreamEntries}}上游产出：

{{upstreamEntries}}
{{/if}}{{#if noUpstream}}上游产出：（无）
{{/if}}{{#if filePathsText}}
文件路径索引（自行读取）：

{{filePathsText}}
{{/if}}{{#if inputContract}}
输入契约（你应当收到的输入，未收到时应当报告父代理）：

{{inputContract}}
{{/if}}{{#if outputContract}}
输出契约（你的最终回复必须按其组织）：

{{outputContract}}
{{/if}}{{#if dbToolHint}}
数据库工具说明：{{dbToolHint}}
{{/if}}
## 可通信对象

需要与其他代理交换信息时调用 wf_send_message：target 填下列括号内的标识，message 写自包含的消息正文；不得用普通文本模拟对话或绕过工具直接传递信息。

{{commTargets}}
{{#if collabNote}}
组内说明：

{{collabNote}}
{{/if}}`;
//# sourceMappingURL=child-node-task.js.map