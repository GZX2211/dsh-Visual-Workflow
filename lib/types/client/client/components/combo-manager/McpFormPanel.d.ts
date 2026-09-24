import type { Dict } from '../../i18n.js';
import type { McpFormState } from '../../lib/mcp-form.js';
export interface McpFormPanelProps {
    copy: Dict;
    /** 当前 tab（仅 mcp tab 渲染本面板）。 */
    tab: 'plugins' | 'mcp';
    /** 编辑中的表单草稿（null = 未在编辑）。 */
    form: McpFormState | null;
    busy: boolean;
    importOpen: boolean;
    importText: string;
    onFormChange(form: McpFormState | null): void;
    onSave(): void;
    onImportOpenChange(open: boolean): void;
    onImportTextChange(text: string): void;
    onImportApply(): void;
}
export declare function McpFormPanel(props: McpFormPanelProps): import("react").JSX.Element | null;
