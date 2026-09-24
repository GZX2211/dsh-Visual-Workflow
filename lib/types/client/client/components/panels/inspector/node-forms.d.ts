import type { Dict } from '../../../i18n.js';
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
/**
 * 虚拟节点表单（P4 闸门可视化）：引用主节点只读（§4.2.3.2 规则 3），另可编辑
 *   - 显示名（画布上替代角色名，如「里程碑①：方案评审」）；
 *   - 角色：普通执行入口（缺省，沿用自动完成）或里程碑闸门（不自动完成，
 *     只能由父代理 `wf_graph_patch(mark_node)` 显式标记，D-07/D-21）。
 */
export declare function ProxyForm({ data, copy, onPatch, mainLabel }: {
    data: Record<string, unknown>;
    copy: Dict;
    onPatch(patch: Record<string, unknown>): void;
    mainLabel: string;
}): import("react").JSX.Element;
