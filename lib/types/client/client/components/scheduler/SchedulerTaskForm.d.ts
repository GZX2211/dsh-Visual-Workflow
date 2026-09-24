import type { ScheduledTask, ScheduledTaskView, TimeRangeConfig } from '../../../host/shared/types.js';
import type { Dict } from '../../i18n.js';
import type { TemplateOption } from '../../hooks/useSchedulerTasks.js';
import { type DateRangeValue } from '../date-picker/DateRangePicker.js';
export interface SchedulerTaskFormProps {
    copy: Dict;
    draft: ScheduledTask | null;
    templates: TemplateOption[];
    /** 时区下拉选项（容器按建议清单 + 本机时区生成）。 */
    timezoneOptions: React.ReactNode;
    unbounded: boolean;
    calendarOpen: boolean;
    dateRange: DateRangeValue;
    activeView: ScheduledTaskView | null;
    busy: boolean;
    confirmDelete: boolean;
    onPatch(part: Partial<ScheduledTask>): void;
    onPatchWindow(part: Partial<ScheduledTask['window']>): void;
    onToggleUnbounded(): void;
    onToggleCalendar(): void;
    onCloseCalendar(): void;
    onSetDaysAll(): void;
    onToggleDay(day: number): void;
    onPatchRange(index: number, part: Partial<TimeRangeConfig>): void;
    onAddRange(): void;
    onRemoveRange(index: number): void;
    onPatchTimePoint(index: number, value: string): void;
    onAddTimePoint(): void;
    onRemoveTimePoint(index: number): void;
    onSave(): void;
    onDelete(): void;
}
export declare function SchedulerTaskForm(props: SchedulerTaskFormProps): import("react").JSX.Element;
