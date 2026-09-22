// src/host/api/ecosystem.ts
//
// GUI API 生态枚举端点组（EcosystemEndpoints）：agent preset 模式 / 全局可见工具 /
// 可选模型（含思考强度档位）。
//
// preset 与模型的官方服务投影归 host 根横切契约（../ecosystem-directory.js）：
// 同一批官方能力也被自主编排勘察工具消费，两处不得各建一份结构守卫与字段映射。
import { RESERVED_TRANSPORT_TOOL } from '../shared/protocol.js';
import { listAgentPresets, listEcosystemModels } from '../ecosystem-directory.js';
import { VisualWorkflowApiBase } from './boundary.js';
export class EcosystemEndpoints extends VisualWorkflowApiBase {
    // ---------- 生态枚举（presets / tools / models） ----------
    /** agent preset 模式列表（agentPresets 服务缺失时返回空列表）。 */
    async presets() {
        const presets = await listAgentPresets(this.ctx).catch((error) => {
            throw new Error(`preset 列表读取失败：${error instanceof Error ? error.message : String(error)}`);
        });
        return presets ?? [];
    }
    /** 全局层可见工具清单（供组合勾选）。 */
    async tools() {
        const tools = this.ctx.get('tools');
        if (!tools || typeof tools.schemas !== 'function')
            return [];
        try {
            const schemas = (tools.schemas() ?? []);
            return (Array.isArray(schemas) ? schemas : [])
                .map((schema) => {
                const entry = schema;
                return { name: entry.name ?? entry.title ?? '', description: entry.description ?? '' };
            })
                .filter((item) => item.name && item.name !== RESERVED_TRANSPORT_TOOL);
        }
        catch (error) {
            throw new Error(`工具清单读取失败：${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /** 可选模型列表（llm 服务缺失返回空列表；单 provider 失败跳过）。 */
    async models() {
        return await listEcosystemModels(this.ctx);
    }
}
//# sourceMappingURL=ecosystem.js.map