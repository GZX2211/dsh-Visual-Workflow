import { VisualWorkflowApiEcosystem } from './api-ecosystem.js';
export declare class VisualWorkflowApiCatalog extends VisualWorkflowApiEcosystem {
    toolCombos(): Promise<unknown>;
    toolComboPut(args: {
        combo?: unknown;
    }): Promise<unknown>;
    toolComboDelete(args: {
        id?: unknown;
    }): Promise<unknown>;
    /**
     * 插件目录：工具（全局层 ∪ 存活 agent scope ∪ preset standing scope，含中文
     * 描述映射）+ MCP 服务器 + 已装载插件摘要。scope key 必须是 agent 对象本身
     * （官方 ScopeKey 语义），传错只能看到全局层。
     */
    pluginCatalog(args: {
        sessionId?: unknown;
    }): Promise<unknown>;
    /** 全部可见工具 schema（全局层 ∪ 存活 root agent ∪ preset standing scope）。 */
    private allToolSchemas;
    /** MCP 服务器：列表 / 增删改 / 启停（写入 profile 托管区，重启生效）。 */
    mcpList(): Promise<unknown>;
    mcpPut(args: {
        server?: unknown;
    }): Promise<unknown>;
    mcpDelete(args: {
        id?: unknown;
    }): Promise<unknown>;
    mcpToggle(args: {
        id?: unknown;
        disabled?: unknown;
    }): Promise<unknown>;
    /** 全局工具开关列表（被关闭 = 父代理上下文不可见；独立于工作流运行状态）。 */
    toolSwitches(): Promise<unknown>;
    /** 设置单个工具开/关状态（全局即时生效；返回更新后的完整关闭清单）。 */
    toolSwitchPut(args: {
        name?: unknown;
        disabled?: unknown;
    }): Promise<unknown>;
    /**
     * 批量设置一组工具开/关状态（组合管理「标签一键开关」：把某标签下全部工具统一关/开）。
     *   - names 必须非空数组；空白名忽略；官方保留传输名 run_code 静默跳过（不可关闭）；
     *   - 单次原子落盘 + 刷新内存快照，全局即时生效。
     * @returns 更新后的完整关闭清单。
     */
    toolSwitchPutMany(args: {
        names?: unknown;
        disabled?: unknown;
    }): Promise<unknown>;
}
