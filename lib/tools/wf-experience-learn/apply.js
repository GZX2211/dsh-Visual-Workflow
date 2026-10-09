// src/host/tools/wf-experience-learn/apply.ts
//
// 模型侧候选 → domain 草稿的纯映射（无校验：合法性归 domain，工具层只做字段改名）。
//
// 为什么未知字段必须原样保留：候选协议由 domain 校验并给出 WF_EXPERIENCE_VALIDATION，
// 若工具层把不认识的键滤掉，「多传字段」这类协议违规就永远无法被发现。
/** 模型侧 snake_case 字段 → domain 草稿 camelCase 字段（其余键名同名保留）。 */
const CANDIDATE_FIELD_ALIASES = {
    task_type: 'taskType',
    decision_domain: 'decisionDomain',
    recommended_action: 'recommendedAction',
};
/**
 * 批量映射候选（顺序即语义，不做归并/去重——那是 domain 的重复闸门职责）。
 * 非对象元素原样返回，由 domain 报出可诊断的校验错误。
 */
export function mapExperienceCandidates(raw, type) {
    return raw.map((item) => mapCandidate(item, type));
}
function mapCandidate(item, type) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
        return item;
    const out = {};
    for (const [key, value] of Object.entries(item)) {
        out[CANDIDATE_FIELD_ALIASES[key] ?? key] = value;
    }
    // 主体类型只能来自本次调用的 type 参数：候选内的同名字段不得改写经验归属
    out.experienceType = type;
    return out;
}
//# sourceMappingURL=apply.js.map