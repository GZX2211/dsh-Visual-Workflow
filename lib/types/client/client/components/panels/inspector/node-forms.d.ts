import type { Dict } from '../../../i18n.js';
/** 阶段属性只读（无描述字段，无保存按钮）。 */
export declare function StageForm({ data, copy, nodeLabel }: {
    data: Record<string, unknown>;
    copy: Dict;
    nodeLabel: string;
}): import("react").JSX.Element;
/** Team（名称/协作 Prompt/成员列表删除）。模板态无成员（成员在画布内拖入登记），隐藏成员区。 */
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
/**
 * 虚拟节点表单：引用主节点只读，另可编辑显示名（画布上替代节点种类名）。
 */
export declare function ProxyForm({ data, copy, onPatch, mainLabel }: {
    data: Record<string, unknown>;
    copy: Dict;
    onPatch(patch: Record<string, unknown>): void;
    mainLabel: string;
}): import("react").JSX.Element;
