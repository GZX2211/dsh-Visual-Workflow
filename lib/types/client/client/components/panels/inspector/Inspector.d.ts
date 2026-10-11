import type { Dict } from '../../../i18n.js';
import type { EditorData, StudioState } from '../../../studio/studio-state.js';
export interface InspectorProps {
    copy: Dict;
    open: boolean;
    width: number;
    editorData: EditorData | null;
    presets: Array<{
        id: string;
        name?: string;
    }>;
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
    /** 模版 → 资产入库（工作流模版 / 角色模版；先保存模版，失败即中止）。 */
    onPromote?(): void;
    /** 入库按钮锁定：已入库且模版内容未再修改（纯函数判定由调用方给出）。 */
    promoteLocked?: boolean;
    /** 打开资产版本上拉列表（资产态回滚选择）。 */
    onOpenVersions?(): void;
    /** 回滚 Active 指针到所选历史版本。 */
    onRollbackVersion?(versionId: number): void;
    /** 收起版本列表（清空版本数据面）。 */
    onCloseVersions?(): void;
    /** 已装载的版本列表（null = 未打开/装载中）。 */
    assetVersions?: StudioState['assetVersions'];
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
