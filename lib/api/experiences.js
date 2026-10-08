// GUI API 经验端点组（ExperienceEndpoints）：列表、保存、归档、恢复。
//
// 本层只做「请求 → 经验域调用 → 稳定响应/错误码」的翻译：检索投影与向量的重算、
// 判重与落库事务都在经验域内完成，因此编辑保存只透传语义字段补丁。
// 经验**没有版本控制**，因此本组没有版本列表与回滚端点：状态切换只有归档 / 恢复两条
// （见 shared/protocol.ts 的端点语义说明）。
import { ERR_EXPERIENCE_BAD_ARGS } from '../shared/protocol.js';
import { EXPERIENCE_LIST_MAX_LIMIT } from '../assets/index.js';
import { httpError } from './http.js';
import { requireExperience, VisualWorkflowApiBase } from './boundary.js';
/** 经验可编辑的单值字段名（取值域闭集；未知字段一律 400，不静默忽略）。 */
const PATCH_TEXT_FIELDS = [
    'responsibility',
    'taskType',
    'decisionDomain',
    'situation',
    'trigger',
    'principle',
    'recommendedAction',
];
/** 经验可编辑的列表字段名（允许 null = 清空）。 */
const PATCH_LIST_FIELDS = ['exclusions', 'evidence'];
/**
 * 边界的参数错误：status 由传输层决定，code 用经验领域稳定码，
 * 让客户端按 ERR_EXPERIENCE_BAD_ARGS 分支。
 */
function experienceBadArgs(message) {
    return httpError(400, message, ERR_EXPERIENCE_BAD_ARGS);
}
/** 校验经验 id（必填）。 */
function requireExperienceId(args) {
    const experienceId = String(args?.experienceId ?? '').trim();
    if (!experienceId)
        throw experienceBadArgs('requires experienceId');
    return experienceId;
}
/** 校验列表字段取值（string[] 或 null 清空）。 */
function requireListValue(field, value) {
    if (value === null)
        return null;
    if (!Array.isArray(value))
        throw experienceBadArgs(`patch ${field} must be a string array or null`);
    return value.map((item) => {
        if (typeof item !== 'string')
            throw experienceBadArgs(`patch ${field} must contain only strings`);
        return item;
    });
}
/**
 * payload → 可编辑字段补丁。
 *
 * 为什么未知字段直接 400 而不是忽略：经验没有版本，一次带错字段名的保存会静默地
 * 「什么都没改」并刷新 updated_at，用户看到保存成功却内容未变——宁可报出字段名。
 * `null` 与缺省的差别由领域层解释（清空 vs 不改），本层只校验类型。
 */
function requirePatch(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw experienceBadArgs('requires a patch object');
    }
    const record = payload;
    const patch = {};
    for (const [field, value] of Object.entries(record)) {
        if (PATCH_TEXT_FIELDS.includes(field)) {
            if (typeof value !== 'string')
                throw experienceBadArgs(`patch ${field} must be a string`);
            patch[field] = value;
            continue;
        }
        if (PATCH_LIST_FIELDS.includes(field)) {
            patch[field] = requireListValue(field, value);
            continue;
        }
        throw experienceBadArgs(`unknown patch field: ${field}`);
    }
    if (Object.keys(patch).length === 0)
        throw experienceBadArgs('requires at least one editable field in patch');
    return patch;
}
export class ExperienceEndpoints extends VisualWorkflowApiBase {
    /**
     * 经验列表：活跃与已归档一并返回（条目自带 active 标记）。
     * 上限用经验域导出的同一常量：界面列表面向人工管理，不需要无限拉取。
     */
    async listExperiences() {
        return requireExperience(this.host).list({ limit: EXPERIENCE_LIST_MAX_LIMIT });
    }
    /**
     * 保存经验（就地改写语义字段；无版本语义，不产生历史行）。
     * 检索投影与向量由经验域在事务外重算后落库，边界只透传语义字段补丁。
     */
    async saveExperience(args) {
        const experienceId = requireExperienceId(args);
        const patch = requirePatch(args?.patch);
        return requireExperience(this.host).update({ experienceId, patch });
    }
    /** 归档经验：退出父代理召回面（内容全部保留，可恢复）。 */
    async retireExperience(args) {
        const experienceId = requireExperienceId(args);
        return requireExperience(this.host).retire({ experienceId });
    }
    /** 恢复经验：重新进入父代理召回面。 */
    async restoreExperience(args) {
        const experienceId = requireExperienceId(args);
        return requireExperience(this.host).restore({ experienceId });
    }
}
//# sourceMappingURL=experiences.js.map