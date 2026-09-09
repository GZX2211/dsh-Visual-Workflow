import { VisualWorkflowApiTemplates } from './api-templates.js';
export declare class VisualWorkflowApiEcosystem extends VisualWorkflowApiTemplates {
    /** agent preset 模式列表（agentPresets 服务缺失时返回空列表）。 */
    presets(): Promise<unknown>;
    /** 全局层可见工具清单（供组合勾选）。 */
    tools(): Promise<unknown>;
    /** 可选模型列表（llm 服务缺失返回空列表；单 provider 失败跳过）。 */
    models(): Promise<unknown>;
}
