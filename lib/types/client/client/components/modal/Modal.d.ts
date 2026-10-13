import { type ReactNode } from 'react';
export interface ModalProps {
    /** 弹层容器外观类（各弹层保持既有类名与视觉，原语只追加 wf-modal）。 */
    className: string;
    /** 背景层外观类。 */
    backdropClassName: string;
    /** 弹层可访问名：取调用方已有的词典标题，读屏据此播报。 */
    label: string;
    /** 关闭请求（Escape；关闭按钮仍由调用方自行绑定同一请求）。 */
    onClose(): void;
    children: ReactNode;
}
export declare function Modal({ className, backdropClassName, label, onClose, children }: ModalProps): import("react").JSX.Element;
