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
/** 单个阶段节点在当前模式与界面语言下的显示名（存储值仍是中文规范值）。 */
export declare function stageNodeLabelOf(mode: string, kind: 'start' | 'end' | 'pause', copy: StageLabelCopy): string;
/** Stage nodes available in each mode (mode 2 has no pause node). */
export declare function stageTemplateKinds(mode: string, copy: StageLabelCopy): Array<{
    kind: NodeKind;
    label: string;
}>;
export declare function defaultOutputHandle(kind: string): string;
export declare function defaultInputHandle(kind: string): string;
