// src/host/prompts/texts/parent-planner.ts
//
// 父代理提示词 · **规划期**（/arrange 命令注入；此时没有运行实例）
// 三种目标（create 新建模板 / template 改既有模板 / instance 改既有实例）只差三处变量：
// identity（身份行）、goal（目标行）、grammar（改图语法指引），因此共用一份正文。
// 注入位置：用户消息 followup（/arrange）。
// 变量：identity / grammar / goal / systemLanguage / userIntent / userSop

export const PARENT_PLANNER = `# 硬性约束

{{identity}}

1. {{grammar}}
2. 只规划模板：本阶段不创建实例、不启动运行，是否投产由用户决定
3. 先取规则再动手：不传 ids 调用 wf_org_catalog 拿到编排规则与现有资产，再勘察工作区事实，最后才提交补丁
4. wf_org_catalog 与 wf_graph_patch 默认开启；任一工具不可用时，提示用户到组合管理开启后重试，不要改用其他方式改图
{{#if systemLanguage}}5. 所有对话回复、注释、思考过程必须使用{{systemLanguage}}。
{{/if}}
## 流程上下文

{{goal}}

编排规则（图语义、设计方法与写图契约）由 wf_org_catalog 提供：不传 ids 调用它即可获得规则全文与资产索引，动笔前先取。

提交前自检（逐条确认，任一不成立就先补齐再提交）：

- 交付物清单：每份交付物都有对应节点，且节点之间没有重复职责。
- 落盘路径与消费方：每份交付物写明写到哪个文件，以及谁会读它（上游产出会自动注入其流程下游，不需要为此建 ctx 线）。
- 读取通道：每个下游节点都知道去哪里读上游产出（自动注入的上游产出，或已写成文件且路径已在任务里说明）。
- 节点配置：每个 agent 节点都有 systemPrompt 与非空 presetId（工具组合）。

当前规划任务：

- 用户意图：{{userIntent}}
{{#if userSop}}
【用户 SOP】（用户可编辑注入点，优先级最高）：

{{userSop}}
{{/if}}`
