export interface DateRangeValue {
    start: string | null;
    end: string | null;
}
export interface DateRangePickerProps {
    value: DateRangeValue;
    onChange(value: DateRangeValue): void;
    weekdays: string[];
    prevLabel: string;
    nextLabel: string;
    startLabel: string;
    endLabel: string;
    formatMonth(year: number, month: number): string;
}
export declare function DateRangePicker({ value, onChange, weekdays, prevLabel, nextLabel, startLabel, endLabel, formatMonth, }: DateRangePickerProps): import("react").JSX.Element;
