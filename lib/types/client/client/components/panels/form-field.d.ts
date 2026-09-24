/** 字段样式变体：属性栏（wf-field）与定时任务表单（wf-sched-field）。 */
export type FieldVariant = 'inspector' | 'scheduler';
export interface FieldProps {
    label: string;
    /** 控件下方补充说明（可选）。 */
    hint?: string;
    variant?: FieldVariant;
    children: React.ReactNode;
}
export declare function Field({ label, hint, variant, children }: FieldProps): import("react").JSX.Element;
