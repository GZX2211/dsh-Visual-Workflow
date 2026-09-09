import type { ReactNode } from 'react';
import { officialCenterCol } from './useWorkbenchView.js';
export interface SplitWindowProps {
    /** 插件工作台（Studio）。 */
    children: ReactNode;
    /** 当前分栏宽度（px）。 */
    splitWidth: number;
    /** 拖拽分隔线过程中回传新宽度（宿主持久化 + 更新 centerCol 内边距）。 */
    onResize: (width: number) => void;
}
/** 分栏窗口：右侧工作台 + 左侧可拖分隔线。 */
export declare function SplitWindow({ children, onResize }: SplitWindowProps): import("react").JSX.Element;
export { officialCenterCol };
