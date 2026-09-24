import type { Dict } from '../../../i18n.js';
export declare function InputField({ label, value, placeholder, onChange, type, step }: {
    label: string;
    value: unknown;
    placeholder?: string;
    onChange(value: string): void;
    type?: string;
    step?: string;
}): import("react").JSX.Element;
export declare function TextAreaField({ label, value, placeholder, onChange, minHeight }: {
    label: string;
    value: unknown;
    placeholder?: string;
    onChange(value: string): void;
    minHeight?: number;
}): import("react").JSX.Element;
/** 名称取值口径：模板用 name、画布节点用 label，二者同义（保存时双写）。 */
export declare function nameOf(data: Record<string, unknown>): string;
export declare function NameField({ data, copy, onPatch }: {
    data: Record<string, unknown>;
    copy: Dict;
    onPatch(patch: Record<string, unknown>): void;
}): import("react").JSX.Element;
