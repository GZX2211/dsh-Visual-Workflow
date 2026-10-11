import { VisualWorkflowApiBase } from './boundary.js';
export declare class CatalogEndpoints extends VisualWorkflowApiBase {
    toolCombos(): Promise<unknown>;
    toolComboPut(args: {
        combo?: unknown;
    }): Promise<unknown>;
    toolComboDelete(args: {
        id?: unknown;
    }): Promise<unknown>;
    /**
     * 插件目录：工具（全局层 ∪ 存活 agent scope ∪ preset standing scope，含中/英
     * 描述映射）+ MCP 服务器 + 已装载插件摘要。scope key 必须是 agent 对象本身
     * （官方 ScopeKey 语义），传错只能看到全局层。
     */
    pluginCatalog(args: {
        sessionId?: unknown;
    }): Promise<unknown>;
    /** 全部可见工具 schema（全局层 ∪ 存活 root agent ∪ preset standing scope）。 */
    private allToolSchemas;
    /**
     * MCP 服务器卡片描述（两种传输的中/英文案）。
     * 命令行为用户配置数据，两种语言都原样嵌入，不翻译。
     */
    private mcpCardDescription;
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
    /** 设置单个工具开/关状态（全局即时生效；返回更新后的完整关闭清单）。 */
    toolSwitchPut(args: {
        name?: unknown;
        disabled?: unknown;
    }): Promise<unknown>;
    /**
     * 批量设置一组工具开/关状态（组合管理「标签一键开关」：把某标签下全部工具统一关/开）。
     *   - names 必须非空数组；空白名忽略；官方保留传输名 run_code 不可关闭；
     *   - 被忽略的保留名**显式回报**在 `skipped`（与单值端点抛 400 的语义对齐：调用方
     *     始终能知道名单是否被改写，界面不再把「开关失灵」当作生效）；
     *   - 单次原子落盘 + 刷新内存快照，全局即时生效。
     * @returns 更新后的完整关闭清单 + 被忽略（保留名）的名单。
     */
    toolSwitchPutMany(args: {
        names?: unknown;
        disabled?: unknown;
    }): Promise<unknown>;
}
