// src/host/storage/document-policy.ts
//
// 持久化文档的写入策略（纯函数 + 稳定错误类型：零 IO、无副作用）。
//
// 职责边界：
//   - 客户端快照标记剥除：客户端只应回写业务字段，服务端字段（代理补丁标注）与
//     前端临时标记绝不落盘；
//   - revision 记账：保存后的 revision 递增与显式乐观锁冲突判定。
//
// 为什么独立成文件：这两项是「写入文档的字段与版本策略」，其变化原因（字段归属、
// 乐观锁语义、前端/服务端字段边界）与资源 CRUD、锁原语、目录布局完全不同。
//
// 与锁的关系：本文件只做**决策**，不做 IO；读改写必须在调用方的同一临界区内完成
// （见 ./AGENTS.md「原子性与锁」）。
// 稳定错误码本体在共享协议常量（Host 产出 / Client 消费，两端零漂移）
import { ERR_REVISION_CONFLICT } from '../shared/protocol.js';
/** revision 冲突错误：另一会话已保存更新的版本（架构文档 §4.1 原子性与锁一致）。 */
export class FlowRevisionConflictError extends Error {
    id;
    expectedRevision;
    actualRevision;
    code = ERR_REVISION_CONFLICT;
    constructor(id, expectedRevision, actualRevision) {
        super(`资源 "${id}" 在加载后被修改（期望 revision ${expectedRevision ?? '无'}，当前 ${actualRevision}），请刷新后合并再保存`);
        this.id = id;
        this.expectedRevision = expectedRevision;
        this.actualRevision = actualRevision;
        this.name = 'FlowRevisionConflictError';
    }
}
/** 前端快照标记字段（保存时剥除，绝不落盘——旧实现把 _draft 写盘导致已入库对象被误判草稿）。 */
const CLIENT_META_KEYS = ['_draft', '_clientMeta'];
/**
 * 保存时**必须清除**的服务端字段（P4）：`lastPatch` 只描述「父代理最近一次补丁」。
 * 任何经用户保存路径（putWorkflow/putService/putFlowTemplate）写回的文档都携带的是
 * 客户端快照，因此用户一保存即视为「用户已看过/改过画布」——清除标注是正确语义，
 * 也顺带避免客户端伪造该字段。
 */
const SERVER_ONLY_KEYS = ['lastPatch'];
/** 剥除前端快照标记（浅拷贝，不修改入参）；keepServerFields=true 时保留 lastPatch。 */
export function stripClientMeta(value, keepServerFields = false) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return value;
    const next = { ...value };
    for (const key of CLIENT_META_KEYS)
        delete next[key];
    if (!keepServerFields)
        for (const key of SERVER_ONLY_KEYS)
            delete next[key];
    return next;
}
/** 保存选项 → 是否保留服务端字段（缺省 false：用户保存即清除代理标注）。 */
export function keepServerFieldsOf(options) {
    return options?.keepServerFields === true;
}
/** 提取当前 revision（非法/缺失按 0 处理，旧项目 flowRevision 语义）。 */
export function flowRevision(value) {
    const r = Number(value?.revision);
    return Number.isInteger(r) && r >= 0 ? r : 0;
}
/**
 * 计算保存后的 revision：无显式冲突期望时自动 +1；有期望时必须匹配（除非 force）。
 * 为什么只认显式 expectedRevision（不沿用旧项目 incoming.revision 回退）：文档内
 * revision 是存储层记账字段，保存方携带的任意快照值不应隐式变成冲突期望——
 * 否则"复制快照再保存"会误触发乐观锁（旧项目客户端每次显式传 expectedRevision，
 * 本项目把该语义收敛为显式参数）。
 */
export function nextFlowRevision(incoming, current, options = {}) {
    if (!current)
        return 1;
    const actual = flowRevision(current);
    const rawExpected = options.expectedRevision;
    if (rawExpected === undefined || rawExpected === null) {
        return actual + 1;
    }
    const expected = Number(rawExpected);
    if (options.force !== true && expected !== actual) {
        throw new FlowRevisionConflictError(incoming?.id ?? current?.id ?? '?', expected, actual);
    }
    return actual + 1;
}
//# sourceMappingURL=document-policy.js.map