// src/host/api/templates.ts
//
// GUI API 模板端点组（TemplateEndpoints）：角色/任务/数据库模板 CRUD 与
// 工作流模板（全局共享）。
import { httpError } from './http.js';
import { ERR_REVISION_CONFLICT } from '../shared/protocol.js';
import { presentationOf, VisualWorkflowApiBase } from './boundary.js';
export class TemplateEndpoints extends VisualWorkflowApiBase {
    // ---------- 模板（角色/任务/数据库） ----------
    async listTemplates(args) {
        const kind = String(args?.kind ?? '');
        if (kind !== 'role' && kind !== 'task' && kind !== 'database' && kind !== 'group') {
            throw httpError(400, 'requires kind: role|task|database|group');
        }
        return this.host.store.listTemplates(kind);
    }
    async putTemplate(args) {
        const kind = String(args?.kind ?? '');
        if (kind !== 'role' && kind !== 'task' && kind !== 'database' && kind !== 'group') {
            throw httpError(400, 'requires kind: role|task|database|group');
        }
        const template = args?.template;
        if (!template || !String(template.id ?? '').trim())
            throw httpError(400, 'requires a template id');
        if (kind === 'role' && !String(template.kind ?? '').trim()) {
            template.kind = 'agent';
        }
        // 前端快照标记由 storage 保存路径统一剥除，此处只做浅拷贝（不修改入参）。
        return this.host.store.saveTemplate(kind, { ...template });
    }
    async deleteTemplate(args) {
        const kind = String(args?.kind ?? '');
        const id = String(args?.id ?? '');
        if (kind !== 'role' && kind !== 'task' && kind !== 'database' && kind !== 'group') {
            throw httpError(400, 'requires kind: role|task|database|group');
        }
        if (!id)
            throw httpError(400, 'requires a template id');
        const deleted = await this.host.store.deleteTemplate(kind, id);
        if (!deleted)
            throw httpError(404, presentationOf(this.host, `模板不存在：${id}`, `Template not found: ${id}`));
        return { deleted: true };
    }
    // ---------- 工作流模板（flow-templates/，全局共享；图2 交互改造） ----------
    /** 工作流模板列表（全部返回，客户端按 mode 过滤；模板跨会话共享不隔离）。 */
    async listFlowTemplates() {
        return this.host.store.listFlowTemplates();
    }
    /** 保存工作流模板（新建/更新统一；revision 递增 + 冲突保护）。 */
    async putFlowTemplate(args) {
        const raw = args?.template;
        if (!raw || !String(raw.id ?? '').trim())
            throw httpError(400, 'requires a flow template id');
        const expected = Number(raw.revision);
        if (!Number.isFinite(expected))
            throw httpError(400, 'requires a numeric revision');
        // 模板级新会话配置（startNewSession / workspacePath）：随模板持久化，删除模板即随之删除。
        // 只做形状归一化（勾选仅 true 有意义；路径 trim 后非空才保留），不校验目录存在性——
        // 路径来自官方目录选择器，存在性由创建实例的 createSession 端点校验（旧模板/导入数据
        // 可能已失效，保存阶段拒绝会连带画布编辑一起失败，语义过重）。
        // 浅拷贝后归一化（前端临时标记剥除由 storage 保存路径统一负责）。
        const normalized = { ...raw };
        if (raw.startNewSession === true)
            normalized.startNewSession = true;
        else
            delete normalized.startNewSession;
        const workspacePath = String(raw.workspacePath ?? '').trim();
        if (workspacePath)
            normalized.workspacePath = workspacePath;
        else
            delete normalized.workspacePath;
        try {
            return await this.host.store.saveFlowTemplate(normalized, { expectedRevision: expected });
        }
        catch (error) {
            const code = error?.code ?? '';
            if (code === ERR_REVISION_CONFLICT)
                throw httpError(409, String(error.message), code);
            throw error;
        }
    }
    /** 删除工作流模板（仅删模板文件，不影响已生成的实例）。 */
    async deleteFlowTemplate(args) {
        const id = String(args?.id ?? '');
        if (!id)
            throw httpError(400, 'requires a flow template id');
        const deleted = await this.host.store.deleteFlowTemplate(id);
        if (!deleted)
            throw httpError(404, presentationOf(this.host, `工作流模板不存在：${id}`, `Workflow template not found: ${id}`));
        return { deleted: true };
    }
}
//# sourceMappingURL=templates.js.map