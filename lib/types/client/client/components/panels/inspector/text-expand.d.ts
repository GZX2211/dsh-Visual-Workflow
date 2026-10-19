import type { Dict } from '../../../i18n.js';
/** 一次扩展编辑请求（打开时快照；切换编辑对象由布局层收起）。 */
export interface TextExpandRequest {
    /** 字段标识：切换到另一个字段时扩展层重置为该字段的值。 */
    key: string;
    /** 字段名（扩展层标题）。 */
    label: string;
    value: string;
    placeholder?: string;
    onChange(value: string): void;
}
/** 扩展宿主（由布局层提供；文案走词典注入）。 */
export interface TextExpandHost {
    open(request: TextExpandRequest): void;
    /** 展开按钮的可访问名称。 */
    expandLabel: string;
}
/** 为属性栏子树提供扩展宿主。 */
export declare function TextExpandProvider({ host, children }: {
    host: TextExpandHost;
    children: React.ReactNode;
}): import("react").JSX.Element;
/**
 * 可展开文本域：渲染属性栏 textarea，并在右下角提供展开入口。
 * value 与 onChange 的语义与受控 textarea 一致（扩展层写回同一个 onChange）。
 */
export declare function ExpandableTextArea({ label, value, placeholder, onChange, minHeight }: {
    label: string;
    value: unknown;
    placeholder?: string;
    onChange(value: string): void;
    minHeight?: number;
}): import("react").JSX.Element;
/**
 * 扩展编辑层：由布局层挂进画布容器（容器负责铺满中间画布），
 * 自带右上角收起按钮与 Esc 收起。
 */
export declare function TextExpandOverlay({ copy, request, onClose }: {
    copy: Dict;
    request: TextExpandRequest;
    onClose(): void;
}): import("react").JSX.Element;
