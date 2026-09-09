export interface DateRangeValue {
    start: string | null;
    end: string | null;
}
export interface DateRangePickerProps {
    value: DateRangeValue;
    onChange(value: DateRangeValue): void;
    /** 星期表头（7 个字符；默认 日一二三四五六）。 */
    weekdays?: string[];
    /** 翻月按钮可访问标签。 */
    prevLabel?: string;
    nextLabel?: string;
}
export declare function DateRangePicker({ value, onChange, weekdays, prevLabel, nextLabel }: DateRangePickerProps): import("react").JSX.Element;
