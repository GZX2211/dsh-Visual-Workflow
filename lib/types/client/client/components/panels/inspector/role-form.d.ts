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
export declare function RoleForm({ data, copy, presets, models, combos, onPatch, onLoadMd, isParent, showCombos }: {
    data: Record<string, unknown>;
    copy: Dict;
    presets: PresetLike[];
    models: ModelLike[];
    combos: ComboLike[];
    onPatch(patch: Record<string, unknown>): void;
    onLoadMd(): void;
    isParent?: boolean;
    /**
     * 是否在模式下拉中提供 combo 分组。谁可编辑 presetId（父/子都可）与谁可见 combo
     * （仅子代理）是两件独立的事，故单独成参而不复用 isParent 的其余语义；
     * 缺省随 isParent（父代理只见官方 preset），避免调用方漏传时把 combo 泄给父代理。
     */
    showCombos?: boolean;
}): import("react").JSX.Element;
