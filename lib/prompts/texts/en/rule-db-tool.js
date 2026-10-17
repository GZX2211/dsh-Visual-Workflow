// src/host/prompts/texts/en/rule-db-tool.ts
//
// 规则文本 · **数据库访问工具说明**（英文变体）。
// 注入位置：子代理 / 父代理执行单元任务块中段（存在 db-in 连线时）。
// 变量：sources（所连数据库节点的 id 与名称清单）
export const RULE_DB_TOOL_EN = `Connected database nodes: {{sources}}. Access databases only through wf_db_query: mode "search" (vector retrieval), mode "query" (read-only SELECT with LIMIT), and mode "schema" (table structure); do not read database files directly.`;
//# sourceMappingURL=rule-db-tool.js.map