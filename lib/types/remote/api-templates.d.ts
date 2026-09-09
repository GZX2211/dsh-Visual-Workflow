import { VisualWorkflowApiWorkflows } from './api-workflows.js';
export declare class VisualWorkflowApiTemplates extends VisualWorkflowApiWorkflows {
    listTemplates(args: {
        kind?: unknown;
    }): Promise<unknown>;
    putTemplate(args: {
        kind?: unknown;
        template?: unknown;
    }): Promise<unknown>;
    /** 删除预览：模板与画布节点深拷贝解耦，删除模板不影响任何已有节点。 */
    deleteTemplatePreview(args: {
        kind?: unknown;
        id?: unknown;
    }): Promise<unknown>;
    deleteTemplate(args: {
        kind?: unknown;
        id?: unknown;
    }): Promise<unknown>;
    /** 工作流模板列表（全部返回，客户端按 mode 过滤；模板跨会话共享不隔离）。 */
    listFlowTemplates(): Promise<unknown>;
    /** 保存工作流模板（新建/更新统一；revision 递增 + 冲突保护）。 */
    putFlowTemplate(args: {
        template?: unknown;
    }): Promise<unknown>;
    /** 删除工作流模板（仅删模板文件，不影响已生成的实例）。 */
    deleteFlowTemplate(args: {
        id?: unknown;
    }): Promise<unknown>;
    /** 受管文件上传：base64 内容 → data/files/<safeName>（原子发布；返回 managedPath）。 */
    fileUpload(args: {
        name?: unknown;
        base64?: unknown;
    }): Promise<unknown>;
}
