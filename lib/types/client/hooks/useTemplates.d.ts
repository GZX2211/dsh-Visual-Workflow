import type { Dispatch } from 'react';
import type { RoleTemplate, FileTemplate, DatabaseTemplate } from '../../host/shared/types.js';
import type { StudioAction, TemplateKind } from '../studio/studio-state.js';
import type { RemoteFace } from './useRemote.js';
export type AnyTemplate = RoleTemplate | FileTemplate | DatabaseTemplate;
export interface TemplatesFace {
    loadTemplates(): Promise<void>;
    /** 新建本地草稿（id 正式格式；保存落库后 id 不变，画布引用不失效）。 */
    createTemplateDraft(kind: TemplateKind): AnyTemplate;
    saveTemplate(kind: TemplateKind, template: AnyTemplate): Promise<void>;
    deleteTemplate(kind: TemplateKind, id: string): Promise<void>;
}
/** 模板列表面（远端失败抛错，由调用方 toast）。 */
export declare function useTemplates(dispatch: Dispatch<StudioAction>, remote: RemoteFace): TemplatesFace;
