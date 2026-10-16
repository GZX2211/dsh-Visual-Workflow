// src/host/prompts/texts/rule-db-tool.ts
//
// 规则文本 · **数据库访问工具说明**（存在 db-in 连线时随任务块注入）
// 注入位置：子代理 / 父代理执行单元任务块中段（调用方在启动节点前生成）。
// 变量：sources（所连数据库节点的 id 与名称清单）

export const RULE_DB_TOOL = `已连接数据库节点：{{sources}}。只可通过 wf_db_query 访问：mode "search"（向量检索）、mode "query"（只读 SELECT，带 LIMIT）、mode "schema"（表结构）；禁止直接读取数据库文件。`
