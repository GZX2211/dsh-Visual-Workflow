import type { NodeKind } from '../../host/shared/graph-model.js';
export type HandleSpec = {
    inputs: string[];
    outputs: string[];
};
export declare const HANDLES: Record<string, HandleSpec>;
export interface StageLabelCopy {
    start: string;
    end: string;
    pause: string;
    input: string;
    output: string;
}
/** Stage labels are injected by UI callers so this pure graph helper stays locale-agnostic. */
export declare function stageLabels(mode: string, copy: StageLabelCopy): {
    start: string;
    end: string;
    pause: string;
};
/** Stage nodes available in each mode (mode 2 has no pause node). */
export declare function stageTemplateKinds(mode: string, copy: StageLabelCopy): Array<{
    kind: NodeKind;
    label: string;
}>;
export declare function defaultOutputHandle(kind: string): string;
export declare function defaultInputHandle(kind: string): string;
