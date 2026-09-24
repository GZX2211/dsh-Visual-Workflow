import type { RemoteFace } from './useRemote.js';
import type { McpServerEntry } from '../lib/mcp-form.js';
/** 工具目录条目（后端 pluginCatalog 返回形状）。 */
export interface CatalogItem {
    key?: string;
    name: string;
    description: string;
    disabled?: boolean;
}
/** 工具组合条目。 */
export interface ComboEntry {
    id: string;
    name: string;
    tools?: string[];
    mcpServers?: string[];
}
/** 工具目录快照。 */
export interface ToolCatalog {
    items: CatalogItem[];
    mcp: McpServerEntry[];
    loadedPlugins: string[];
    disabledTools: string[];
}
export interface ToolCombosFace {
    catalog: ToolCatalog;
    combos: ComboEntry[];
    /** 全局已关闭工具（父代理上下文不可见；列表置灰且不可勾选）。 */
    disabledTools: ReadonlySet<string>;
    /** 是否有请求在飞（按钮禁用用）。 */
    busy: boolean;
    /** 加载目录与组合列表；返回本次结果供调用方初始化选择（不写组件状态）。 */
    load(): Promise<{
        catalog: ToolCatalog;
        combos: ComboEntry[];
    }>;
    saveCombo(combo: {
        id: string;
        name: string;
        tools: string[];
        mcpServers: string[];
    }): Promise<void>;
    deleteCombo(id: string): Promise<void>;
    /** 单个工具全局开关；返回开启后的完整已关闭清单。 */
    setToolDisabled(name: string, disabled: boolean): Promise<string[]>;
    /** 按标签批量开关；返回开启后的完整已关闭清单。 */
    setToolsDisabled(names: string[], disabled: boolean): Promise<string[]>;
    saveMcp(server: Record<string, unknown>): Promise<void>;
    deleteMcp(id: string): Promise<void>;
    setMcpDisabled(id: string, disabled: boolean): Promise<void>;
}
export declare function useToolCombos(remote: RemoteFace, sessionId: string): ToolCombosFace;
