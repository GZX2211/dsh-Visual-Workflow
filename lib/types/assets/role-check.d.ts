/** 必填字符串校验（缺失或空白即非法；返回 trim 后的值）。 */
export declare function requireText(value: unknown, field: string): string;
/** 资产/版本标识校验（非空字符串）。 */
export declare function requireAssetId(value: unknown, field?: string): string;
/** 版本号校验（正整数）。 */
export declare function requireVersionId(value: unknown): number;
/** JSON 列序列化（undefined 落为 null，避免写入字符串 "undefined"）。 */
export declare function toJsonText(value: unknown): string | null;
/** 可空文本列读取（空字符串与缺列都归为 null，保证往返一致）。 */
export declare function toNullableText(value: unknown): string | null;
/**
 * 可选自由文本列写入归一化（缺省与纯空白都归为 NULL）。
 * 为什么写侧也必须归一：inputSchema / outputSchema 这类「交接契约」字段在客户端、
 * 节点默认值与工具入参里缺省都是空串，而「未配置」的列值语义是 NULL；直接落空串会让
 * 写侧（空串）与读侧（toNullableText 归 null）对同一事实给出两种值，
 * 结果是每次保存都判定为「内容已变」而凭空新增版本。
 */
export declare function toOptionalText(value: unknown): string | null;
/** 非空文本列读取（缺列为空字符串）。 */
export declare function toText(value: unknown): string;
/** 整数列读取（非有限值回落默认；用于 retry_limit / react_limit 这类计数）。 */
export declare function toInteger(value: unknown, fallback: number): number;
/** 可空整数列读取。 */
export declare function toNullableInteger(value: unknown): number | null;
