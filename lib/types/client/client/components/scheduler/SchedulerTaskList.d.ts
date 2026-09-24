import type { ScheduledTaskView } from '../../../host/shared/types.js';
import type { Dict } from '../../i18n.js';
import type { TemplateOption } from '../../hooks/useSchedulerTasks.js';
export interface SchedulerTaskListProps {
    copy: Dict;
    views: ScheduledTaskView[];
    templates: TemplateOption[];
    activeTaskId: string | null;
    /** 当前草稿的启用状态（无草稿时开关禁用）。 */
    draftEnabled: boolean;
    hasDraft: boolean;
    busy: boolean;
    onSelect(id: string): void;
    onNew(): void;
    onToggleEnabled(enabled: boolean): void;
}
export declare function SchedulerTaskList(props: SchedulerTaskListProps): import("react").JSX.Element;
