import type { Dispatch } from 'react';
import type { Dict } from '../i18n.js';
import type { StudioAction, StudioState } from '../studio/studio-state.js';
import { type NewSessionOptions } from '../studio/studio-state.js';
import { type WorkspacePicker } from '../sidebar/workspace-picker.js';
/** hook 入参（交互面与宿主能力经注入，不直接触达官方服务）。 */
export interface UseNewSessionOptionsArgs {
    /** 当前工作台状态（只读切片：模板态读模板字段、资产态读临时选项）。 */
    state: StudioState;
    /** 状态机 dispatch（资产态一次性选项写入）。 */
    dispatch: Dispatch<StudioAction>;
    /** 模板级新会话配置保存（变更即保存模板；失败由该实现回滚并提示）。 */
    setFlowTemplateOptions(patch: {
        startNewSession?: boolean;
        workspacePath?: string;
    }): Promise<void>;
    /** 轻提示（不可用等需要明确告知的用户可见结果）。 */
    notify(kind: 'info' | 'success' | 'error', text: string): void;
    /** 通用错误提示（选择器/保存失败）。 */
    toastError(error: unknown): void;
    /** 官方目录选择器（宿主接入层注入；null = 当前环境不可用）。 */
    picker: WorkspacePicker | null;
    /** 文案词典。 */
    t: Dict;
}
/** 新会话选项交互面（Toolbar 消费）。 */
export interface NewSessionOptionsFace {
    /** 当前生效的新会话选项（模板态来自模板字段；资产态来自临时选项，路径恒空）。 */
    options: NewSessionOptions;
    /** 是否显示「选择工作区…」按钮（仅模板态；资产态无持久化归属）。 */
    showWorkspacePicker: boolean;
    /** 官方目录选择器当前是否可用（不可用时按钮禁用并提示）。 */
    pickerAvailable: boolean;
    /** 目录选择器是否正在打开（防重复打开）。 */
    picking: boolean;
    /** 勾选/取消勾选变更（路径变更只经目录选择器，不走本回调）。 */
    onOptionsChange(patch: {
        newSession?: boolean;
        workspacePath?: string;
    }): void;
    /** 打开官方目录选择器并保存所选路径。 */
    onPickWorkspace(): void;
}
/**
 * 新会话选项交互编排 hook。
 * @param args - 状态切片、写入面与宿主选择器注入。
 * @returns 展示值与交互回调（引用在同一 state 下稳定）。
 */
export declare function useNewSessionOptions(args: UseNewSessionOptionsArgs): NewSessionOptionsFace;
