import { VisualWorkflowApiBase, type ApiHost } from './boundary.js';
/** GUI API 最终类：全部端点方法由端点组汇聚（端点白名单由共享协议常量派生）。 */
export declare class VisualWorkflowApi extends VisualWorkflowApiBase {
}
export declare function registerRoutes(ctx: {
    get(name: string): unknown;
    logger?: {
        warn?(message: string): void;
    };
}, host: ApiHost): () => void;
