import type { Dict } from '../../../i18n.js';
export interface PromptAssetFormProps {
    data: Record<string, unknown>;
    copy: Dict;
    onPatch(patch: Record<string, unknown>): void;
}
export declare function PromptAssetForm({ data, copy, onPatch }: PromptAssetFormProps): import("react").JSX.Element;
