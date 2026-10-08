/** 必填字符串校验（缺失或空白即非法；返回 trim 后的值）。 */
export declare function requireText(value: unknown, field: string): string;
/** 资产/版本标识校验（非空字符串）。 */
export declare function requireAssetId(value: unknown, field?: string): string;
/**
 * 经验域必填文本校验（缺失或空白即非法；返回 trim 后的值）。
 * 与 requireText 分开是因为错误语义不同：经验写入失败要报经验入参问题，
 * 调用方据此判断是「资产」还是「经验」的载荷需要修。
 */
export declare function requireExperienceText(value: unknown, field: string): string;
/**
 * 入参 id 列表归一：丢弃非字符串与纯空白项、按首次出现去重并保持顺序。
 * 为什么读路径也要归一：id 列表来自工具层与界面，重复项会让「同一行被返回两次」，
 * 而调用方按位置消费结果时无从分辨。
 */
export declare function uniqueFilledIds(values: readonly unknown[]): string[];
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
