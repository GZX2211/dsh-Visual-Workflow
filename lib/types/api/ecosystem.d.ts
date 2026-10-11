import { VisualWorkflowApiBase } from './boundary.js';
export declare class EcosystemEndpoints extends VisualWorkflowApiBase {
    /** agent preset 模式列表（agentPresets 服务缺失时返回空列表）。 */
    presets(): Promise<unknown>;
    /** 可选模型列表（llm 服务缺失返回空列表；单 provider 失败跳过）。 */
    models(): Promise<unknown>;
}
