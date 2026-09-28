// src/host/assets/role-check.ts
//
// 资产写路径的公共校验与 JSON/text 列转换（纯函数或纯数据助手，无副作用）。
//
// 为什么独立成文件：写路径收到的载荷来自 API/Tool 边界，节点与模版都可能缺字段；
// 「缺字段 = 默认值」的归一化与「JSON 列读写」是全模块共用的最小事实，
// 分别散落在角色/工作流两条写路径会造成两套默认值口径。
import { assetBadArgs } from './errors.js';
/** 必填字符串校验（缺失或空白即非法；返回 trim 后的值）。 */
export function requireText(value, field) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text)
        throw assetBadArgs(`资产入参缺少必填字段 ${field}：请补齐后重试`);
    return text;
}
/** 资产/版本标识校验（非空字符串）。 */
export function requireAssetId(value, field = 'assetId') {
    return requireText(value, field);
}
/** 版本号校验（正整数）。 */
export function requireVersionId(value) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        throw assetBadArgs(`版本号 ${String(value)} 非法：必须是大于 0 的整数`);
    }
    return value;
}
/** JSON 列序列化（undefined 落为 null，避免写入字符串 "undefined"）。 */
export function toJsonText(value) {
    if (value === undefined || value === null)
        return null;
    return JSON.stringify(value) ?? null;
}
/** 可空文本列读取（空字符串与缺列都归为 null，保证往返一致）。 */
export function toNullableText(value) {
    if (value === null || value === undefined)
        return null;
    const text = String(value);
    return text === '' ? null : text;
}
/**
 * 可选自由文本列写入归一化（缺省与纯空白都归为 NULL）。
 * 为什么写侧也必须归一：inputSchema / outputSchema 这类「交接契约」字段在客户端、
 * 节点默认值与工具入参里缺省都是空串，而「未配置」的列值语义是 NULL；直接落空串会让
 * 写侧（空串）与读侧（toNullableText 归 null）对同一事实给出两种值，
 * 结果是每次保存都判定为「内容已变」而凭空新增版本。
 */
export function toOptionalText(value) {
    if (value === null || value === undefined)
        return null;
    const text = String(value);
    return text.trim() === '' ? null : text;
}
/** 非空文本列读取（缺列为空字符串）。 */
export function toText(value) {
    return value === null || value === undefined ? '' : String(value);
}
/** 整数列读取（非有限值回落默认；用于 retry_limit / react_limit 这类计数）。 */
export function toInteger(value, fallback) {
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? Math.trunc(num) : fallback;
}
/** 可空整数列读取。 */
export function toNullableInteger(value) {
    if (value === null || value === undefined)
        return null;
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? Math.trunc(num) : null;
}
//# sourceMappingURL=role-check.js.map