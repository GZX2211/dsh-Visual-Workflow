import type { PanelLayout, StudioState } from './studio-types.js';
/** 撤销重做栈上限（旧项目 HISTORY_LIMIT）。 */
export declare const HISTORY_LIMIT = 60;
/** 初始面板几何：默认「左栏展开」（折叠切换循环位置 0），右侧属性栏默认隐藏（由选中推导）。
 *  底栏默认高度 170px，左右两侧栏默认宽度 230px（用户裁决）。 */
export declare function defaultPanels(): PanelLayout;
/** 初始状态（会话 id 由调用方注入）。 */
export declare function createInitialState(sessionId: string): StudioState;
