import type { Dispatch } from 'react';
import type { StudioAction, StudioState } from '../studio/studio-state.js';
import type { RoleAssetDetail } from '../../host/shared/asset-types.js';
import type { GraphHistoryFace } from './useGraphHistory.js';
import type { ToastFace } from './useToast.js';
import type { SaveCanvasOptions } from './useDocumentActions.js';
import type { RunLockSet } from '../lib/run-locks.js';
import type { Dict } from '../i18n.js';
/** 几何拖动（节点拖动 / 协作组卡片缩放）自动保存的防抖窗口（毫秒）。 */
export declare const GEOMETRY_AUTOSAVE_DEBOUNCE_MS = 400;
/** 画布编辑面的外部依赖注入（锁定判定 + 自动保存 + 宿主下发的成员上限）。 */
export interface CanvasActionsOptions {
    /** 运行中实例画布锁定判定集（模式一 running；未启用时全部解锁）。 */
    locks: RunLockSet;
    /** 画布保存入口（纯几何改动的防抖自动保存用；auto:true = 静默落库）。 */
    saveCanvas(options?: SaveCanvasOptions): Promise<unknown>;
    /**
     * 宿主下发的 协作组成员上限（部署层 agent-team.maxMembers 的镜像）。
     * 缺省回退 TEAM_MEMBER_LIMIT_FALLBACK：入组交互据此拒绝超限，避免画布放得下而运行期排不进。
     */
    teamMemberLimit?: number;
}
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
    /** 角色资产拖入画布：生成内联角色节点并写入来源资产 id（sourceAssetId）。 */
    placeRoleAssetNode(detail: RoleAssetDetail, position: {
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
    /** 协作组模板拖入画布：按模板名称/协作 Prompt 生成 协作组节点。 */
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
/** 画布编辑面（remember 需在变更 dispatch 前调用；远端 IO 仅几何自动保存一处）。 */
export declare function useCanvasActions(state: StudioState, dispatch: Dispatch<StudioAction>, notify: ToastFace['toast'], history: GraphHistoryFace, t: Dict, options: CanvasActionsOptions): CanvasActionsFace;
