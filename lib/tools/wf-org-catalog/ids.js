// src/host/tools/wf-org-catalog/ids.ts
//
// 资产 ID 解析（纯函数）。
//
// 为什么单独成文件：主调用模型只有「传 ids / 不传 ids」两种形态，id 形状判定是
// 「取数分派」与「错误提示」共用的唯一判据，必须与索引里公布的约定逐字一致。
// 不抛错：形状非法由调用方翻译为该 id 的单条 error，不影响同批其余 id。
import { CATALOG_LIMITS, ID_CONVENTION, INLINE_ROLE_SEPARATOR, INSTANCE_ID, ROLE_ID_PREFIX, WORKFLOW_ID_PREFIX, } from './types.js';
/**
 * 支持的 id 形状说明（错误提示复用，避免措辞漂移）。
 * 实例两项只在此处与工具描述出现，不进资产索引：索引是规划期入口，
 * 而实例入口只在运行期有意义（由运行期指令告知父代理）。
 */
export function idShapesHint() {
    return `Supported: ${ID_CONVENTION.workflow}; ${ID_CONVENTION.role}; ${ID_CONVENTION.inlineRole}; `
        + `${INSTANCE_ID} = the instance running in this session -> skeleton only (topology, no asset content); `
        + `${INSTANCE_ID}${INLINE_ROLE_SEPARATOR}<node id> = inline role of that running instance -> full systemPrompt`;
}
/**
 * 解析单个 id（纯函数）。
 * 内联角色有两个来源：**工作流资产**（复合键左侧 `flow-*`）与**当前运行实例**
 * （左侧保留字 `instance`）。运行实例只有这一个入口——本工具不提供按 id 枚举任意实例的
 * 形状，历史 run、其他会话的实例在判据层就不存在，故规划期无法借本工具参考不稳定实例。
 */
export function parseAssetId(raw) {
    const id = String(raw ?? '').trim();
    if (!id)
        return { ok: false, reason: 'the id is empty' };
    const separatorAt = id.indexOf(INLINE_ROLE_SEPARATOR);
    if (separatorAt >= 0) {
        const containerId = id.slice(0, separatorAt).trim();
        const nodeId = id.slice(separatorAt + 1).trim();
        if (!containerId || !nodeId) {
            return { ok: false, reason: `a composite id must look like <workflow asset id or ${INSTANCE_ID}>${INLINE_ROLE_SEPARATOR}<node id> — ${idShapesHint()}` };
        }
        if (containerId === INSTANCE_ID)
            return { ok: true, kind: 'instanceRole', id, nodeId };
        if (!containerId.startsWith(WORKFLOW_ID_PREFIX)) {
            return { ok: false, reason: `the left side of a composite id must be a workflow asset id (${WORKFLOW_ID_PREFIX}*) or the ${INSTANCE_ID} reserved word: inline roles are recalled from a workflow asset or the running instance only — ${idShapesHint()}` };
        }
        return { ok: true, kind: 'inlineRole', id, containerId, nodeId };
    }
    if (id === INSTANCE_ID)
        return { ok: true, kind: 'instance', id };
    if (id.startsWith(ROLE_ID_PREFIX))
        return { ok: true, kind: 'role', id };
    if (id.startsWith(WORKFLOW_ID_PREFIX))
        return { ok: true, kind: 'workflow', id };
    return { ok: false, reason: `unrecognized id "${id}" — ${idShapesHint()}` };
}
/**
 * 归一化 ids 参数（纯函数）。
 * 语义（用户裁决）：缺省 / 空数组 / 空白字符串 = 只看索引；数组内空白项跳过并按首次
 * 出现去重（保持模型给出的顺序）。
 * @returns 归一化后的 id 列表；`null` 表示参数形状非法（调用方抛 WF_BAD_ARGS）。
 */
export function normalizeAssetIds(raw) {
    if (raw === undefined || raw === null)
        return [];
    if (typeof raw === 'string')
        return raw.trim() ? null : [];
    if (!Array.isArray(raw))
        return null;
    const out = [];
    for (const item of raw) {
        const id = String(item ?? '').trim();
        if (!id || out.includes(id))
            continue;
        out.push(id);
    }
    return out;
}
/** ids 数量校验：超限返回错误文案（调用方据此抛 WF_BAD_ARGS），未超限返回 null。 */
export function detailIdsLimitProblem(count) {
    if (count <= CATALOG_LIMITS.detailIds)
        return null;
    return `at most ${CATALOG_LIMITS.detailIds} ids may be recalled in detail per call (received ${count}); submit further batches`;
}
//# sourceMappingURL=ids.js.map