// src/host/api/routes.ts
//
// GUI API 边界入口：注册 POST /visual-workflow/<endpoint> 前缀路由（白名单分发、
// JSON 入参出参、错误码到 HTTP 状态的映射），并按显式清单汇聚各端点组。
//
// 为什么用清单汇聚而不是继承链：端点组之间没有职责依赖（工作流端点不需要继承模板
// 端点），继承串联只会制造伪依赖。本文件的清单是「模块有哪些端点域」的唯一事实
// 来源——新增端点域时在此登记，并保持端点名全局唯一（共享协议常量派生白名单）。
import * as EP from '../shared/protocol.js';
import { HttpError, httpError, readBody, sendJson } from './http.js';
import { ServiceDebugError } from './service-debug.js';
import { streamServiceDebugEndpoint } from './service-debug-endpoint.js';
import { webServerOf } from '../web-server.js';
import { mixInEndpointGroups, VisualWorkflowApiBase } from './boundary.js';
import { WorkflowEndpoints } from './workflows.js';
import { TemplateEndpoints } from './templates.js';
import { EcosystemEndpoints } from './ecosystem.js';
import { CatalogEndpoints } from './catalog.js';
import { RunEndpoints } from './runs.js';
import { SchedulerEndpoints } from './scheduler.js';
/** GUI API 最终类：全部端点方法由端点组汇聚（端点白名单由共享协议常量派生）。 */
export class VisualWorkflowApi extends VisualWorkflowApiBase {
}
mixInEndpointGroups(VisualWorkflowApi, [
    WorkflowEndpoints,
    TemplateEndpoints,
    EcosystemEndpoints,
    CatalogEndpoints,
    RunEndpoints,
    SchedulerEndpoints,
]);
/**
 * 稳定错误码 → HTTP 状态映射（自带 status 的传输错误优先，见 statusOf）。
 * 领域模块只抛稳定 code，翻译成对外状态是边界的职责。
 */
const ERROR_STATUS = {
    FLOW_REVISION_CONFLICT: 409,
    WF_LOCKED: 409,
    WF_SERVICE_RUNNING: 409,
    WF_SERVICE_NOT_RUNNING: 409,
    WF_SERVICE_NOT_FOUND: 404,
    WF_SERVICE_BAD_ID: 400,
    WF_FLOW_INVALID: 422,
    TRANSFER_INVALID_JSON: 400,
    TRANSFER_INVALID_BUNDLE: 422,
    TRANSFER_NOT_FOUND: 404,
};
/** 响应状态：传输层错误自带 status 优先；否则按稳定 code 表；无法识别为 500。 */
function statusOf(error) {
    if (error instanceof HttpError || error instanceof ServiceDebugError)
        return error.status;
    const code = String(error?.code ?? '');
    return ERROR_STATUS[code] ?? 500;
}
export function registerRoutes(ctx, host) {
    const api = new VisualWorkflowApi(ctx, host);
    const webServer = webServerOf(ctx);
    if (!webServer) {
        ctx.logger?.warn?.('[visual-workflow] webServer 服务不可用，GUI API 未挂载');
        return () => { };
    }
    return webServer.register({
        kind: 'prefix',
        path: '/visual-workflow',
        async handler(req, res) {
            const httpReq = req;
            try {
                if (httpReq.method !== 'POST') {
                    sendJson(res, 405, { ok: false, error: { message: 'method not allowed; use POST' } });
                    return;
                }
                const url = new URL(String(httpReq.url ?? '/'), 'http://localhost');
                const segments = url.pathname.split('/').filter(Boolean);
                const endpoint = segments[segments.length - 1] ?? '';
                let args = {};
                const body = await readBody(httpReq);
                if (body.trim()) {
                    let parsed;
                    try {
                        parsed = JSON.parse(body);
                    }
                    catch {
                        throw httpError(400, 'invalid JSON body');
                    }
                    args = parsed?.args ?? {};
                }
                // 流式端点（serviceDebug）：SSE 透传，不走 JSON 分发
                if (endpoint === EP.EP_SERVICE_DEBUG) {
                    await streamServiceDebugEndpoint(host, args, res, httpReq);
                    return;
                }
                const value = await api.handle(endpoint, args);
                sendJson(res, 200, { ok: true, value });
            }
            catch (error) {
                // 错误响应携带稳定 code（HttpError.code / 引擎 WfError.code / transfer 领域码），
                // 供前端按错误码分支（如 FLOW_REVISION_CONFLICT 冲突时自动刷新，而非仅展示通用
                // message，Bug 20）。
                const code = String(error?.code ?? '');
                const message = error instanceof Error ? error.message : String(error);
                sendJson(res, statusOf(error), { ok: false, error: { message, ...(code ? { code } : {}) } });
            }
        },
    });
}
//# sourceMappingURL=routes.js.map