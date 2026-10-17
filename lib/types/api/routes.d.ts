import { VisualWorkflowApiBase, type ApiHost } from './boundary.js';
/** GUI API 最终类：全部端点方法由端点组汇聚（端点白名单由共享协议常量派生）。 */
export declare class VisualWorkflowApi extends VisualWorkflowApiBase {
}
/**
 * 稳定错误码 → HTTP 状态映射（自带 status 的传输错误优先，见 statusOf）。
 * 领域模块只抛稳定 code，翻译成对外状态是边界的职责。
 */
export declare const ERROR_STATUS: Record<string, number>;
/**
 * 显式豁免的稳定码（码 → 依据）：这些码只经 agent 工具面（MCP / 子代理）抛出，
 * 不经 GUI HTTP 边界，因此不在此映射；它们的状态语义由工具面自己消化。
 * 为什么仍要显式列出：穷举性门禁（tests/host/api/error-status.test.ts）要求每个稳定码
 * 都有明确归属——「豁免」必须是被判定过的结论，而不是遗漏。
 */
export declare const ERROR_STATUS_EXEMPT: Record<string, string>;
export declare function registerRoutes(ctx: {
    get(name: string): unknown;
    logger?: {
        warn?(message: string): void;
    };
}, host: ApiHost): () => void;
