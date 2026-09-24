import type { Dict } from '../../i18n.js';
import type { ToolCatalog } from '../../hooks/useToolCombos.js';
import type { McpServerEntry } from '../../lib/mcp-form.js';
export interface ComboCatalogProps {
    copy: Dict;
    catalog: ToolCatalog;
    tab: 'plugins' | 'mcp';
    onTabChange(tab: 'plugins' | 'mcp'): void;
    search: string;
    onSearchChange(value: string): void;
    activeTag: string;
    onTagChange(tag: string): void;
    disabledTools: ReadonlySet<string>;
    comboDraft: {
        tools: string[];
        mcpServers: string[];
    };
    busy: boolean;
    onToggleTool(name: string): void;
    onToggleMcp(name: string): void;
    onToggleToolDisabled(name: string, disabled: boolean): void;
    onToggleMcpDisabled(id: string, disabled: boolean): void;
    onEditMcp(server: McpServerEntry): void;
    onDeleteMcp(id: string): void;
    /** 一键开关当前标签下工具（names 由本组件按标签语义给出）。 */
    onBulkToolDisabled(disabled: boolean, toolNames: string[]): void;
}
export declare function ComboCatalog(props: ComboCatalogProps): import("react").JSX.Element;
