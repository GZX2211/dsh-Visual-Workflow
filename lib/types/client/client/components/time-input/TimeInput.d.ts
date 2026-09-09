export interface TimeInputProps {
    /** 当前值（"HH:mm"；空串表示未选择）。 */
    value: string;
    onChange(value: string): void;
    placeholder?: string;
    ariaLabel?: string;
}
/** 解析 "HH:mm" / "H:mm" / "HHmm" / "Hmm"/ "HH" / "H" → {hour, minute}（非法 null）。 */
export declare function parseTimeText(text: string): {
    hour: number;
    minute: number;
} | null;
/** 按位输入时的渐进格式化（键入 1125 → 11:25；键入 112 → 11:2；键入 925 → 9:25；键入 9 → 9）。 */
export declare function formatTimeBuffer(digits: string): string;
export declare function TimeInput({ value, onChange, placeholder, ariaLabel }: TimeInputProps): import("react").JSX.Element;
