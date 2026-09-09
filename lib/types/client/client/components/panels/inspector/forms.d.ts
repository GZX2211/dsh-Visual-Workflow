import type { Dict } from '../../../i18n.js';
import type { ModelItem, PresetItem } from '../../../studio/studio-state.js';
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
export declare function FileForm({ data, copy, onPatch, onFileSelect }: {
    data: Record<string, unknown>;
    copy: Dict;
    onPatch(patch: Record<string, unknown>): void;
    /** 多选文件回调（用户验收：支持多选所有类型文件）。 */
    onFileSelect(files: File[]): void;
}): import("react").JSX.Element;
export declare function DatabaseForm({ data, copy, onPatch, onTest }: {
    data: Record<string, unknown>;
    copy: Dict;
    onPatch(patch: Record<string, unknown>): void;
    onTest(): void;
}): import("react").JSX.Element;
/** 阶段属性只读（无描述字段，无保存按钮，需求 §4.2.5.1）。 */
export declare function StageForm({ data, copy, nodeLabel }: {
    data: Record<string, unknown>;
    copy: Dict;
    nodeLabel: string;
}): import("react").JSX.Element;
/** 协作组（名称/协作 Prompt/成员列表删除）。模板态无成员（成员在画布内拖入登记），隐藏成员区。 */
export declare function GroupForm({ data, copy, members, onPatch, onLoadMd, onRemoveMember }: {
    data: Record<string, unknown>;
    copy: Dict;
    members?: Array<{
        id: string;
        label: string;
    }>;
    onPatch(patch: Record<string, unknown>): void;
    onLoadMd(): void;
    onRemoveMember(memberId: string): void;
}): import("react").JSX.Element;
/** 虚拟节点只读（仅显示主节点名称，不可修改，§4.2.3.2 规则 3）。 */
export declare function ProxyForm({ data, copy, mainLabel }: {
    data: Record<string, unknown>;
    copy: Dict;
    mainLabel: string;
}): import("react").JSX.Element;
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
