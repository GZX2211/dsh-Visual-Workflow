import type { Dict } from '../../i18n.js';
export interface ToolbarProps {
    copy: Dict;
    mode: 'mode1' | 'mode2';
    /** 两侧侧栏是否都已折叠（顶部一键折叠/展开按钮用；批注：折叠时不显示拖动线）。 */
    panelsCollapsed: boolean;
    /** 顶部一键折叠/展开左右侧栏回调。 */
    onTogglePanels(): void;
    /** 当前画布对象态（模板态显示「创建实例/创建服务」；实例态显示「保存实例/保存服务」）。 */
    saveLabel: string;
    onUndo(): void;
    onRedo(): void;
    onClear(): void;
    canClear: boolean;
    onTidy(): void;
    canTidy: boolean;
    onSave(): void;
    canSave: boolean;
    running: boolean;
    onStop(): void;
    onRun(): void;
    onOpenHistory(): void;
    canHistory: boolean;
    serviceStatus: {
        port?: number;
        status?: string;
    } | null;
    /** 「开启新会话」是否显示（仅模板态；实例态不显示——实例只认绑定会话运行）。 */
    showNewSession: boolean;
    /** 「开启新会话」一次性临时选项（模板态编辑；不持久化到模板/实例文档）。 */
    instanceOptions: {
        newSession: boolean;
        workspacePath: string;
    };
    /** 临时选项变更回调（写回 StudioState.instanceOptions）。 */
    onInstanceOptionsChange(patch: {
        newSession?: boolean;
        workspacePath?: string;
    }): void;
}
export declare function Toolbar(props: ToolbarProps): import("react").JSX.Element;
