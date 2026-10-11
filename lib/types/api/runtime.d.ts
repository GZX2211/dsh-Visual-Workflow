import { VisualWorkflowApiBase } from './boundary.js';
export declare class RuntimeEndpoints extends VisualWorkflowApiBase {
    /** 运行期配置下发：{ runPollMs }；能力缝缺失时明确 501（不伪造取值）。 */
    runtimeConfig(): Promise<unknown>;
}
