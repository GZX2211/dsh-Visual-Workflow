// src/host/prompts/texts/rule-design-method.ts
//
// 规则文本 · **设计方法（交付物 → 落盘路径与消费方 → 并行判定）**
// 注入位置：wf_org_catalog 索引返回的 rules.designMethod（工具调用时按需注入）。
// 消费方：src/host/tools/wf-org-catalog/build.ts。
export const RULE_DESIGN_METHOD = `设计方法（按顺序想清楚三件事，再动手写补丁）：

第一步：列交付物清单。每组交付物对应一个可执行节点；一个节点只承担一件可独立验收的交付任务。
  合并判据：两件事无法分别验收、或拆开后下游拿不到额外信息，就合并成一个节点。

第二步：为每份交付物写明落盘路径与消费方。
  大产物（成稿、报告、文件等）一律要求节点写入工作区文件；节点交接只传「结论 + 产出文件路径 + 关键决策 + 未决问题」。
  上游产出会沿流程线**自动注入**它的每一个流程下游，因此不需要为交接建 ctx 连线。
  终端产出（没有任何流程下游）不必额外连线，也不要给它加评审节点。

第三步：判定并行与规模。
  只有「不同时修改同一批文件、且互不依赖」的任务才并行；否则串行。
  并行要有独立价值：拆成两个子代理的总成本 = 两次子代理开销 + 一次上下文交接，收益不明显就合并。

节点配置：每个 agent 节点至少要有 label、systemPrompt（该子代理角色定义、任务说明、执行规范）、presetId（工具组合，来自 wf_org_catalog 的 combos）。
  presetId 为空 = 这个节点运行时没有任何工具，是无效节点；provider/model 从 wf_org_catalog 的 models 里选。
`;
//# sourceMappingURL=rule-design-method.js.map