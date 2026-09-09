// src/host/remote/api-base.ts
//
// GUI API 基础层：宿主能力缝（ApiHost）、webServer 最小结构、前端快照标记
// 剥离工具（CLIENT_META_KEYS/stripClientMeta）与端点白名单分发基类
// VisualWorkflowApiBase（constructor + ENDPOINTS + handle）。
//
// 继承链：VisualWorkflowApiBase ← VisualWorkflowApiWorkflows ←
// VisualWorkflowApiTemplates ← VisualWorkflowApiEcosystem ←
// VisualWorkflowApiCatalog ← VisualWorkflowApiRuns ← VisualWorkflowApi（api.ts 收口）。
import * as EP from '../shared/protocol.js';
import { httpError } from './http.js';
/**
 * 前端快照标记字段黑名单（保存时剥除，绝不落盘）：
 *  - _draft：客户端本地草稿标记。旧实现把它随模板/服务/工作流一起写盘，
 *    刷新后已入库对象被误判为草稿（本地删除不走后端、保存行为错乱）。
 *  - _clientMeta：预留的其它客户端元数据。
 * 说明：保存逻辑以深拷贝剔除，避免污染对象本身（调用方列表仍可复用）。
 */
const CLIENT_META_KEYS = ['_draft', '_clientMeta'];
/** 剥离前端快照标记（浅拷贝，不修改入参）。 */
export function stripClientMeta(value) {
    const next = { ...value };
    for (const key of CLIENT_META_KEYS)
        delete next[key];
    return next;
}
/**
 * GUI API 分发基类：按端点名分发（白名单禁止命中原型链方法）。
 * 所有方法为 async (args) => value；参数缺失抛 HttpError(400)。
 */
export class VisualWorkflowApiBase {
    ctx;
    host;
    constructor(ctx, host) {
        this.ctx = ctx;
        this.host = host;
    }
    /** 端点白名单（共享协议常量表派生，与共享契约零漂移）。 */
    static ENDPOINTS = new Set(Object.values(EP).filter((value) => typeof value === 'string'));
    /** 按端点名分发；未知端点 404。 */
    async handle(endpoint, args) {
        const method = VisualWorkflowApiBase.ENDPOINTS.has(endpoint)
            ? this[endpoint]
            : undefined;
        if (typeof method !== 'function')
            throw httpError(404, `unknown endpoint: ${endpoint}`);
        return method.call(this, (args ?? {}));
    }
}
//# sourceMappingURL=api-base.js.map