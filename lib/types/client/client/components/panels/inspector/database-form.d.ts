import type { Dict } from '../../../i18n.js';
export declare function DatabaseForm({ data, copy, onPatch, onTest }: {
    data: Record<string, unknown>;
    copy: Dict;
    onPatch(patch: Record<string, unknown>): void;
    onTest(): void;
}): import("react").JSX.Element;
