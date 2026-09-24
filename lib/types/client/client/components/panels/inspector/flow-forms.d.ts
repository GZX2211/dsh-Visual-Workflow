import type { Dict } from '../../../i18n.js';
export declare function LinePanel({ data, copy, onPatch }: {
    data: Record<string, unknown>;
    copy: Dict;
    onPatch(patch: Record<string, unknown>): void;
}): import("react").JSX.Element;
export declare function WorkflowForm({ data, copy, isService, flowMeta, onPatch }: {
    data: Record<string, unknown>;
    copy: Dict;
    isService: boolean;
    flowMeta: {
        nodeCount: number;
        revision: number;
    };
    onPatch(patch: Record<string, unknown>): void;
}): import("react").JSX.Element;
