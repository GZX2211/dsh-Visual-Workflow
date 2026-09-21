import type { WfDbQueryHost } from './types.js';
/** 查询结果单元格值最大长度（超长截断防止向量/BLOB 列打爆上下文；追加标记）。 */
export declare const QUERY_CELL_MAX_LENGTH = 240;
/**
 * 注册 wf_db_query（全局层；ctx.tools.register）。
 * 返回 disposer：注销失败尽力而为。
 */
export declare function registerWfDbQuery(ctx: {
    get(name: string): unknown;
}, host: WfDbQueryHost): () => void;
