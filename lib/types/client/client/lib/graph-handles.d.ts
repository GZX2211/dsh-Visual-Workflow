import type { NodeKind } from '../../host/shared/graph-model.js';
export type HandleSpec = {
    inputs: string[];
    outputs: string[];
};
export declare const HANDLES: Record<string, HandleSpec>;
/** 阶段节点显示名（模式一：启动/结束；模式二：输入/输出，需求 §4.2.5.1）。 */
export declare function stageLabels(mode: string): {
    start: string;
    end: string;
    pause: string;
};
/** 阶段节点固定卡片（模式二没有暂停，需求 §4.2.5.1 规则 1/2）。 */
export declare function stageTemplateKinds(mode: string): Array<{
    kind: NodeKind;
    label: string;
}>;
export declare function defaultOutputHandle(kind: string): string;
export declare function defaultInputHandle(kind: string): string;
