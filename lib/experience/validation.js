// src/host/experience/validation.ts
//
// 经验候选与保存补丁的协议校验（Schema + 运行时护栏）。
//
// 两个设计决定：
//   1) 未知字段一律拒绝并且不静默丢弃：模型按 Prompt 产出的候选一旦夹带旧协议字段，静默丢弃会让
//      模型以为字段已生效并持续产出无效候选；回报字段名才能让模型自我纠正，也避免「字段清单」
//      在工具层与域层各维护一份（模型侧 snake_case 与域内 camelCase 的写法在本文件内归一）。
//   2) 校验是纯函数且不触碰端口：同一份判定同时服务写入前的候选校验与保存补丁合并后的复核，
//      保证「新增时接受的内容」与「编辑后仍接受的内容」完全同规则。
//
// 模型可见文案规范（docs/model-facing-surface-rules §3）：所有错误经 invalid / badArgs 出口统一
// 加 `{CODE}: ` 前缀并只用英文；error.code 模型看不到，稳定码必须写在 message 文本里。
import { WfError } from "../orchestrator/errors.js";
import { ERR_EXPERIENCE_BAD_ARGS, ERR_EXPERIENCE_VALIDATION } from "../shared/protocol.js";
import { EXPERIENCE_TYPES, FIELD_LIMITS, MAX_CANDIDATES_PER_CALL, isExperienceType, normalizeWhitespace } from "./constants.js";
/** 数组字段清单（协议事实：九个语义字段中只有这两个是字符串数组）。 */
const ARRAY_FIELD_NAMES = ["exclusions", "evidence"];
const ARRAY_FIELD_SET = new Set(ARRAY_FIELD_NAMES);
/** 是否为数组字段（缩窄用；字符串集合查表避免把类型判断写成两份）。 */
function isArrayField(field) {
    return ARRAY_FIELD_SET.has(field);
}
/**
 * 九字段规格表（字段清单的唯一本体）：域内名 → 模型侧名与单字段上限。
 * 键为语义字段联合类型，少一个或多一个键都会编译失败。
 */
const FIELD_SPECS = {
    responsibility: { alias: "responsibility", limit: FIELD_LIMITS.responsibility },
    taskType: { alias: "task_type", limit: FIELD_LIMITS.taskType },
    decisionDomain: { alias: "decision_domain", limit: FIELD_LIMITS.decisionDomain },
    situation: { alias: "situation", limit: FIELD_LIMITS.situation },
    trigger: { alias: "trigger", limit: FIELD_LIMITS.trigger },
    principle: { alias: "principle", limit: FIELD_LIMITS.principle },
    recommendedAction: { alias: "recommended_action", limit: FIELD_LIMITS.recommendedAction },
    exclusions: { alias: "exclusions", limit: FIELD_LIMITS.arrayElement },
    evidence: { alias: "evidence", limit: FIELD_LIMITS.arrayElement },
};
const EXPERIENCE_TYPE_FIELD_ALIAS = "experience_type";
const SEMANTIC_FIELDS = Object.keys(FIELD_SPECS);
const SCALAR_FIELDS = SEMANTIC_FIELDS.filter((field) => !isArrayField(field));
const ARRAY_FIELDS = SEMANTIC_FIELDS.filter((field) => isArrayField(field));
const SEMANTIC_FIELD_TEXT = SEMANTIC_FIELDS.map((field) => FIELD_SPECS[field].alias).join(" / ");
const ALLOWED_FIELD_TEXT = `${SEMANTIC_FIELD_TEXT} (optionally ${EXPERIENCE_TYPE_FIELD_ALIAS})`;
/** 允许的键 → 域内字段名（同一字段的两种写法都接受，冲突时在读取阶段判歧义）。 */
const KEY_TO_FIELD = buildKeyToField();
function buildKeyToField() {
    const map = new Map();
    for (const field of SEMANTIC_FIELDS) {
        map.set(field, field);
        map.set(FIELD_SPECS[field].alias, field);
    }
    map.set("experienceType", "experienceType");
    map.set(EXPERIENCE_TYPE_FIELD_ALIAS, "experienceType");
    return map;
}
/** 协议错误出口：稳定码写进 message 文本（模型看不到 error.code）。 */
function invalid(message) {
    return new WfError(`${ERR_EXPERIENCE_VALIDATION}: ${message}`, ERR_EXPERIENCE_VALIDATION);
}
/** 入参形状错误出口：同上，码为参数码。 */
function badArgs(message) {
    return new WfError(`${ERR_EXPERIENCE_BAD_ARGS}: ${message}`, ERR_EXPERIENCE_BAD_ARGS);
}
/** 取值形态的可读描述（错误消息里必须让模型看清自己给的是什么）。 */
function describeValue(value) {
    if (value === null)
        return "null";
    if (Array.isArray(value))
        return "array";
    return typeof value;
}
function requireScalarValue(value, field, where) {
    const spec = FIELD_SPECS[field];
    if (typeof value !== "string") {
        throw invalid(`${where} field "${spec.alias}" must be a string (received ${describeValue(value)}); rewrite it as text and resubmit.`);
    }
    const text = normalizeWhitespace(value);
    if (!text) {
        throw invalid(`${where} field "${spec.alias}" is blank; required text must not be empty, so add substantive content and resubmit.`);
    }
    if (text.length > spec.limit) {
        throw invalid(`${where} field "${spec.alias}" is ${text.length} characters, over the limit of ${spec.limit}; shorten that field and resubmit.`);
    }
    return text;
}
function requireArrayValue(value, field, where) {
    const spec = FIELD_SPECS[field];
    if (!Array.isArray(value)) {
        throw invalid(`${where} field "${spec.alias}" must be an array of strings (received ${describeValue(value)}); rewrite it as an array and resubmit.`);
    }
    if (value.length > FIELD_LIMITS.arrayLength) {
        throw invalid(`${where} field "${spec.alias}" has ${value.length} elements, over the per-array limit of ${FIELD_LIMITS.arrayLength}; merge or drop elements and resubmit.`);
    }
    return value.map((item, index) => {
        if (typeof item !== "string") {
            throw invalid(`${where} field "${spec.alias}" element ${index + 1} must be a string (received ${describeValue(item)}); rewrite it as text and resubmit.`);
        }
        const text = normalizeWhitespace(item);
        if (!text) {
            throw invalid(`${where} field "${spec.alias}" element ${index + 1} is blank; remove that element or give it content and resubmit.`);
        }
        if (text.length > spec.limit) {
            throw invalid(`${where} field "${spec.alias}" element ${index + 1} is ${text.length} characters, over the limit of ${spec.limit}; shorten it and resubmit.`);
        }
        return text;
    });
}
/** 读取对象里的字段值，拒绝未知字段与同一字段的两种写法。 */
function readCanonicalValues(source, where, allowType) {
    const values = new Map();
    const seen = new Map();
    for (const [key, value] of Object.entries(source)) {
        const field = KEY_TO_FIELD.get(key);
        if (field === undefined || (!allowType && field === "experienceType")) {
            const allowed = allowType ? ALLOWED_FIELD_TEXT : SEMANTIC_FIELD_TEXT;
            throw invalid(`${where} contains unknown field "${key}"; allowed fields are ${allowed}, so delete that field and resubmit.`);
        }
        const previous = seen.get(field);
        if (previous !== undefined) {
            throw invalid(`${where} carries both "${previous}" and "${key}" for the same field; keep only one spelling and resubmit.`);
        }
        seen.set(field, key);
        values.set(field, value);
    }
    return values;
}
/** 九字段护栏：必填存在、类型正确、空白归一化、单字段与单条总长上限。 */
function normalizeCore(values, where) {
    const readScalar = (field) => {
        const value = values.get(field);
        if (value === undefined)
            throw missingField(field, where);
        return requireScalarValue(value, field, where);
    };
    const readArray = (field) => {
        const value = values.get(field);
        if (value === undefined)
            throw missingField(field, where);
        return requireArrayValue(value, field, where);
    };
    const core = {
        responsibility: readScalar("responsibility"),
        taskType: readScalar("taskType"),
        decisionDomain: readScalar("decisionDomain"),
        situation: readScalar("situation"),
        trigger: readScalar("trigger"),
        principle: readScalar("principle"),
        recommendedAction: readScalar("recommendedAction"),
        exclusions: readArray("exclusions"),
        evidence: readArray("evidence"),
    };
    const total = SCALAR_FIELDS.reduce((sum, field) => sum + core[field].length, 0)
        + ARRAY_FIELDS.reduce((sum, field) => sum + core[field].reduce((count, item) => count + item.length, 0), 0);
    if (total > FIELD_LIMITS.total) {
        throw invalid(`${where} totals ${total} characters across the nine semantic fields, over the limit of ${FIELD_LIMITS.total}; shorten the fields and resubmit.`);
    }
    return core;
}
function missingField(field, where) {
    return invalid(`${where} is missing the required field "${FIELD_SPECS[field].alias}"; supply all nine fields (${SEMANTIC_FIELD_TEXT}) as the generation prompt asks and resubmit.`);
}
/** 候选自带的类型声明必须与本次提交类型一致（类型由调用参数决定，模型不得伪造）。 */
function assertDeclaredType(values, expectedType, where) {
    const declared = values.get("experienceType");
    if (declared === undefined)
        return;
    if (!isExperienceType(declared)) {
        throw invalid(`${where} carries an invalid experience_type (received ${describeValue(declared)}); allowed values are ${EXPERIENCE_TYPES.join(" / ")}.`);
    }
    if (declared !== expectedType) {
        throw invalid(`${where} declares experience_type ${declared} but this call submits type ${expectedType}; the type comes from the call argument, so delete that field or set it to ${expectedType}.`);
    }
}
/** 读取候选列表（接受数组本体或 { experiences: [...] } 包装）。 */
function readCandidateList(payload) {
    if (Array.isArray(payload))
        return assertCandidateCount(payload);
    if (typeof payload !== "object" || payload === null) {
        throw badArgs(`the payload must be a candidate array or a { experiences: [...] } object (received ${describeValue(payload)}); follow the wf_experience_learn input protocol and resubmit.`);
    }
    const record = payload;
    if (!Array.isArray(record.experiences)) {
        throw badArgs("the payload object is missing the experiences array; submit { experiences: [...] } or the candidate array itself.");
    }
    for (const key of Object.keys(record)) {
        if (key !== "experiences") {
            throw invalid(`the payload top level contains unknown field "${key}"; only experiences is allowed there, so delete that field and resubmit.`);
        }
    }
    return assertCandidateCount(record.experiences);
}
function assertCandidateCount(candidates) {
    if (candidates.length === 0) {
        throw badArgs("the candidate list is empty; call wf_experience_learn with an empty array when you only want the generation prompt for your subject type, or provide at least 1 candidate to store.");
    }
    if (candidates.length > MAX_CANDIDATES_PER_CALL) {
        throw invalid(`at most ${MAX_CANDIDATES_PER_CALL} candidates may be submitted per call (received ${candidates.length}); split them into batches of at most ${MAX_CANDIDATES_PER_CALL}.`);
    }
    return candidates;
}
/**
 * 校验并归一化模型提交的候选。
 *
 * 批内「九个语义字段完全相同」判为调用错误：这是模型在同一次提交里自我复制，属可修正的
 * 调用问题；相近但不相同的经验由 0.8 语义判重跳过（那是内容判断，不是调用判断）。
 */
export function validateExperienceCandidates(payload, expectedType) {
    const candidates = readCandidateList(payload);
    const drafts = [];
    const seen = new Map();
    candidates.forEach((candidate, index) => {
        const where = `candidate ${index + 1}`;
        if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
            throw invalid(`${where} must be an object (received ${describeValue(candidate)}); each candidate may only contain ${ALLOWED_FIELD_TEXT}.`);
        }
        const values = readCanonicalValues(candidate, where, true);
        assertDeclaredType(values, expectedType, where);
        const core = normalizeCore(values, where);
        // 判重键按固定字段顺序生成，因此同一语义核心必然得到同一字符串
        const fingerprint = JSON.stringify(core);
        const previous = seen.get(fingerprint);
        if (previous !== undefined) {
            throw invalid(`${where} has exactly the same nine semantic fields as candidate ${previous + 1}; delete one of them, or change principle / decision_domain and resubmit.`);
        }
        seen.set(fingerprint, index);
        drafts.push({ experienceType: expectedType, ...core });
    });
    return drafts;
}
/**
 * 校验保存补丁并给出合并后的完整语义核心。
 * `undefined` = 本次不改；`null` 只允许用于数组字段（清空）；必填文本被清空即拒绝
 * ——经验没有版本，改坏无从回滚。
 */
export function validateExperiencePatch(current, patch) {
    const where = "the patch";
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
        throw badArgs(`${where} must be an object (received ${describeValue(patch)}); submit a patch of editable fields.`);
    }
    const values = readCanonicalValues(patch, where, false);
    const normalizedPatch = {};
    const overrides = new Map();
    for (const field of SEMANTIC_FIELDS) {
        if (!values.has(field))
            continue;
        const value = values.get(field);
        if (value === undefined)
            continue;
        const alias = FIELD_SPECS[field].alias;
        if (isArrayField(field)) {
            if (value === null) {
                normalizedPatch[field] = null;
                overrides.set(field, []);
                continue;
            }
            const list = requireArrayValue(value, field, where);
            normalizedPatch[field] = list;
            overrides.set(field, list);
            continue;
        }
        if (value === null) {
            throw invalid(`${where} clears the required field "${alias}"; required text cannot be emptied by a patch (experiences have no versions, so a bad edit cannot be rolled back) — provide new text instead.`);
        }
        const text = requireScalarValue(value, field, where);
        normalizedPatch[field] = text;
        overrides.set(field, text);
    }
    // 合并后再跑一遍九字段护栏：单字段合法不等于合并结果合法（总长上限按合并后的整条经验计）
    const merged = new Map();
    for (const field of SEMANTIC_FIELDS)
        merged.set(field, overrides.has(field) ? overrides.get(field) : current[field]);
    return { patch: normalizedPatch, fields: normalizeCore(merged, where) };
}
//# sourceMappingURL=validation.js.map