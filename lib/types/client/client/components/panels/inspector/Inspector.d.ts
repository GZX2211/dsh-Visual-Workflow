import type { Dict } from '../../../i18n.js';
import type { EditorData } from '../../../studio/studio-state.js';
export interface InspectorProps {
    copy: Dict;
    open: boolean;
    width: number;
    editorData: EditorData | null;
    presets: Array<{
        id: string;
        name?: string;
    }>;
    tools: unknown[];
    models: Array<{
        provider: string;
        model: string;
        efforts?: Array<{
            id: string;
            name: string;
        }>;
    }>;
    combos: Array<{
        id: string;
        name: string;
        tools?: string[];
        mcpServers?: string[];
    }>;
    flowMeta: {
        nodeCount: number;
        revision: number;
    };
    onPatch(patch: Record<string, unknown>): void;
    onDelete(): void;
    onSave(): void;
    /** 图2 交互改造：实例 → 模板（另存为模板；用户裁决提供入口）。 */
    onSaveAsTemplate?(): void;
    onCopyProxy(): void;
    onRemoveMember(memberId: string): void;
    onFileSelect(files: File[]): void;
    onLoadMd(): void;
    /** 协作 Prompt 从 .md 加载（与角色 System Prompt 一致）。 */
    onLoadGroupMd(): void;
    onTestDb(): void;
    saveDisabled: boolean;
    importBusy: boolean;
}
export declare function Inspector(props: InspectorProps): import("react").JSX.Element;
