import type { Dispatch } from 'react';
import type { RoleTemplate, FileTemplate, DatabaseTemplate, GroupTemplate } from '../../host/shared/types.js';
import type { StudioAction, TemplateKind } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
export type AnyTemplate = RoleTemplate | FileTemplate | DatabaseTemplate | GroupTemplate;
export interface TemplatesFace {
    /** 全部模板分类并行加载；返回按 kind 聚合的结果（某类失败不影响其他类，Bug 9）。 */
    loadTemplates(): Promise<{
        role: AnyTemplate[];
        file: AnyTemplate[];
        database: AnyTemplate[];
        group: AnyTemplate[];
    }>;
    /** 新建本地草稿（id 正式格式；保存落库后 id 不变，画布引用不失效）。 */
    createTemplateDraft(kind: TemplateKind): AnyTemplate;
    saveTemplate(kind: TemplateKind, template: AnyTemplate): Promise<void>;
    deleteTemplate(kind: TemplateKind, id: string): Promise<void>;
}
/** 模板列表面（远端失败抛错，由调用方 toast）。 */
export declare function useTemplates(dispatch: Dispatch<StudioAction>, remote: RemoteFace): TemplatesFace;
