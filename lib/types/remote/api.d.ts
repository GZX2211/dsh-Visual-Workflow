import type { ApiHost } from './api-base.js';
import { VisualWorkflowApiScheduler } from './api-scheduler.js';
/**
 * GUI API 最终类：全部端点方法经继承链汇聚（端点白名单由共享协议常量派生）。
 */
export declare class VisualWorkflowApi extends VisualWorkflowApiScheduler {
}
export declare function registerRoutes(ctx: {
    get(name: string): unknown;
    logger?: {
        warn?(message: string): void;
    };
}, host: ApiHost): () => void;
export { HttpError } from './http.js';
export type { ApiHost } from './api-base.js';
