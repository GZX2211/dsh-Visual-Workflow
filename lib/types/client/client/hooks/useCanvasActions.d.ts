import type { Dispatch } from 'react';
import type { StudioAction, StudioState } from '../studio/studio-state.js';
import type { GraphHistoryFace } from './useGraphHistory.js';
import type { ToastFace } from './useToast.js';
import type { Dict } from '../i18n.js';
export interface CanvasActionsFace {
    rememberGraph(): void;
    moveNode(id: string, position: {
        x: number;
        y: number;
    }): void;
    onNodeDragStart(): void;
    onConnect(connection: {
        source: string;
        target: string;
        sourceHandle: string;
        targetHandle: string;
    }): void;
    onConnectionRejected(): void;
    tidyGraph(): void;
    clearGraph(): void;
    removeSelected(): void;
    removeNodeNow(id: string): void;
    removeLine(id: string): void;
    placeTemplateNode(kind: 'role' | 'file' | 'database', templateId: string, position: {
        x: number;
        y: number;
    }): void;
    placeParentNode(templateId: string, position: {
        x: number;
        y: number;
    }): void;
    placeStageNode(kind: string, position: {
        x: number;
        y: number;
    }): void;
    placeGroupNode(position: {
        x: number;
        y: number;
    }): void;
    /** 协作组模板拖入画布：按模板名称/协作 Prompt 生成协作组节点。 */
    placeGroupFromTemplate(templateId: string, position: {
        x: number;
        y: number;
    }): void;
    placeTemplateIntoGroup(kind: 'role', templateId: string, groupId: string, position: {
        x: number;
        y: number;
    }): void;
    onGroupResize(id: string, size: {
        w: number;
        h: number;
    }): void;
    addNodeToGroup(nodeId: string, groupId: string): void;
    copyToProxy(): void;
    removeGroupMember(memberId: string): void;
    /** 交换节点左右连接点（节点属性 swapPorts 取反；可撤销）。 */
    swapNodePorts(id: string): void;
}
/** 画布编辑面（remember 需在变更 dispatch 前调用；远端无 IO）。 */
export declare function useCanvasActions(state: StudioState, dispatch: Dispatch<StudioAction>, notify: ToastFace['toast'], history: GraphHistoryFace, t: Dict): CanvasActionsFace;
