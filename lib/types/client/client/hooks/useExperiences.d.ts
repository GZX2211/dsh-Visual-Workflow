import type { Dispatch } from 'react';
import type { ExperienceEntry, ExperiencePatch } from '../../host/shared/asset-types.js';
import type { StudioAction, StudioState } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
import type { ToastFace } from './useToast.js';
import type { Dict } from '../i18n.js';
export interface ExperiencesFace {
    experiences: StudioState['experiences'];
    experienceDoc: StudioState['experienceDoc'];
    /** 重新加载经验列表（活跃 + 已归档）。 */
    refresh(): Promise<void>;
    /** 打开经验：详情取自已装载列表（列表里没有该 id 时不做任何事，避免打开空壳）。 */
    open(experienceId: string): void;
    /** 保存经验（就地更新可编辑字段；返回更新后的条目，失败 null）。 */
    save(entry: ExperienceEntry): Promise<ExperienceEntry | null>;
    /** 归档 / 恢复经验（状态切换唯一入口；返回是否成功）。 */
    setActive(experienceId: string, active: boolean): Promise<boolean>;
}
/**
 * 保存载荷投影（纯函数）：只取九个语义字段——检索投影、向量与只读元信息
 * （id / 主体类型 / 状态 / 时间戳 / 来源运行 / 生成 Prompt）一律不回传，
 * 回传等于让界面有权改写领域记账的事实与系统生成规则。
 *
 * 列表字段用 `null` 表达「清空」（与 `undefined` 的「不改」区分，见共享契约 ExperiencePatch）；
 * 表单里的空文本域投影为 `[]`，与 `null` 在领域层同义（都落成空数组）。
 */
export declare function experiencePatchOf(entry: ExperienceEntry): ExperiencePatch;
/** 经验面（远端失败已就地翻译为提示；返回值 null/false 表示本次调用未产生结果）。 */
export declare function useExperiences(remote: RemoteFace, dispatch: Dispatch<StudioAction>, notify: ToastFace['toast'], toastError: ToastFace['toastError'], t: Dict, state: StudioState): ExperiencesFace;
