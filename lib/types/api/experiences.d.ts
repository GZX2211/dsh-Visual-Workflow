import type { ExperienceEntry } from '../shared/asset-types.js';
import { VisualWorkflowApiBase } from './boundary.js';
export declare class ExperienceEndpoints extends VisualWorkflowApiBase {
    /**
     * 经验列表：活跃与已归档一并返回（条目自带 active 标记）。
     * 上限用召回索引的同一常量：界面列表面向人工管理，不需要无限拉取。
     */
    listExperiences(): Promise<ExperienceEntry[]>;
    /** 保存经验（就地改写可编辑字段；无版本语义，不产生历史行）。 */
    saveExperience(args: {
        experienceId?: unknown;
        patch?: unknown;
    }): Promise<ExperienceEntry>;
    /** 归档经验：退出父代理召回面（内容全部保留，可恢复）。 */
    retireExperience(args: {
        experienceId?: unknown;
    }): Promise<ExperienceEntry>;
    /** 恢复经验：重新进入父代理召回面。 */
    restoreExperience(args: {
        experienceId?: unknown;
    }): Promise<ExperienceEntry>;
}
