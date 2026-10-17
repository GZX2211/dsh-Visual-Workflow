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
    /** 「清空」按钮悬停说明（运行中禁用时提示先停止运行）。 */
    clearTitle: string;
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
    /** 「开启新会话」是否显示（仅实例来源态；实例态不显示——实例只认绑定会话运行）。 */
    showNewSession: boolean;
    /** 「开启新会话」选项：模板态来自模板持久化字段；资产态为一次性临时选项（路径恒空）。 */
    instanceOptions: {
        newSession: boolean;
        workspacePath?: string;
    };
    /** 临时选项/模板配置变更回调（模板态由上层立即保存模板，资产态写临时状态）。 */
    onInstanceOptionsChange(patch: {
        newSession?: boolean;
        workspacePath?: string;
    }): void;
    /** 是否显示「选择工作区…」按钮（仅模板态；资产态无持久化归属）。 */
    showWorkspacePicker: boolean;
    /** 官方目录选择器是否可用（不可用时按钮禁用并提示）。 */
    workspacePickerAvailable: boolean;
    /** 目录选择器是否正在打开（防重复打开）。 */
    workspacePicking: boolean;
    /** 打开官方目录选择器并保存所选路径。 */
    onPickWorkspace(): void;
}
export declare function Toolbar(props: ToolbarProps): import("react").JSX.Element;
