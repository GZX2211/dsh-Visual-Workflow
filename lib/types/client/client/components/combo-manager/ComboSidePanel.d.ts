import type { Dict } from '../../i18n.js';
import type { ComboEntry } from '../../hooks/useToolCombos.js';
export interface ComboSidePanelProps {
    copy: Dict;
    combos: ComboEntry[];
    activeComboId: string | null;
    comboDraft: {
        name: string;
        tools: string[];
        mcpServers: string[];
    };
    busy: boolean;
    /** 删除已进入二次确认态（按钮文案切换）。 */
    confirmDelete: boolean;
    onSelect(id: string): void;
    onNew(): void;
    onDraftNameChange(name: string): void;
    onRemoveTool(name: string): void;
    onRemoveMcp(name: string): void;
    onSave(): void;
    onDelete(): void;
}
export declare function ComboSidePanel(props: ComboSidePanelProps): import("react").JSX.Element;
