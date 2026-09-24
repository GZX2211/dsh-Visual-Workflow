import type { Dict } from '../../../i18n.js';
export declare function FileForm({ data, copy, onPatch, onFileSelect }: {
    data: Record<string, unknown>;
    copy: Dict;
    onPatch(patch: Record<string, unknown>): void;
    /** 多选文件回调（用户验收：支持多选所有类型文件）。 */
    onFileSelect(files: File[]): void;
}): import("react").JSX.Element;
