// src/host/tools/wf-org-catalog/ids.ts
//
// 资产 ID 解析（纯函数）。
//
// 为什么单独成文件：主调用模型只有「传 ids / 不传 ids」两种形态，id 形状判定是
// 「取数分派」与「错误提示」共用的唯一判据，必须与索引里公布的约定逐字一致。
// 不抛错：形状非法由调用方翻译为该 id 的单条 error，不影响同批其余 id。
import { CATALOG_LIMITS, ID_CONVENTION, INLINE_ROLE_SEPARATOR, ROLE_ID_PREFIX, WORKFLOW_ID_PREFIX, } from './types.js';
/** 支持的 id 形状说明（错误提示复用，避免措辞漂移）。 */
export function idShapesHint() {
    return `支持：${ID_CONVENTION.workflow}；${ID_CONVENTION.role}；${ID_CONVENTION.inlineRole}`;
}
/**
 * 解析单个 id（纯函数）。
 * 内联角色只从**工作流资产**召回：复合键左侧必须是 `flow-*`——运行期实例的骨架与
 * 内联角色不由本工具暴露（父代理只允许改当前正在运行的实例，其编排事实由运行期
 * 编排指令提供）。
 */
export function parseAssetId(raw) {
    const id = String(raw ?? '').trim();
    if (!id)
        return { ok: false, reason: 'id 为空' };
    const separatorAt = id.indexOf(INLINE_ROLE_SEPARATOR);
    if (separatorAt >= 0) {
        const containerId = id.slice(0, separatorAt).trim();
        const nodeId = id.slice(separatorAt + 1).trim();
        if (!containerId || !nodeId) {
            return { ok: false, reason: `复合 id 形状应为 <工作流资产 id>${INLINE_ROLE_SEPARATOR}<节点 id>——${idShapesHint()}` };
        }
        if (!containerId.startsWith(WORKFLOW_ID_PREFIX)) {
            return { ok: false, reason: `复合 id 左侧必须是工作流资产 id（${WORKFLOW_ID_PREFIX}*）：内联角色只从工作流资产召回——${idShapesHint()}` };
        }
        return { ok: true, kind: 'inlineRole', id, containerId, nodeId };
    }
    if (id.startsWith(ROLE_ID_PREFIX))
        return { ok: true, kind: 'role', id };
    if (id.startsWith(WORKFLOW_ID_PREFIX))
        return { ok: true, kind: 'workflow', id };
    return { ok: false, reason: `无法识别的 id「${id}」——${idShapesHint()}` };
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
    return `单次详情召回最多 ${CATALOG_LIMITS.detailIds} 个 id（收到 ${count} 个）：请分批提交`;
}
//# sourceMappingURL=ids.js.map