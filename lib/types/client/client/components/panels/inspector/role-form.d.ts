import type { Dict } from '../../../i18n.js';
import type { PresetItem, ModelItem } from '../../../studio/studio-state.js';
export interface ComboLike {
    id: string;
    name: string;
    tools?: string[];
    mcpServers?: string[];
}
/** 预设条目（与 studio-state PresetItem 同构，复用避免双份漂移）。 */
export type PresetLike = PresetItem;
/** 模型条目（studio-state ModelItem 同构：含适配器公布的思考强度档位，V-02）。 */
export type ModelLike = ModelItem;
export declare function RoleForm({ data, copy, presets, models, combos, onPatch, onLoadMd, isParent, allowCombos }: {
    data: Record<string, unknown>;
    copy: Dict;
    presets: PresetLike[];
    models: ModelLike[];
    combos: ComboLike[];
    onPatch(patch: Record<string, unknown>): void;
    onLoadMd(): void;
    isParent?: boolean;
    allowCombos?: boolean;
}): import("react").JSX.Element;
