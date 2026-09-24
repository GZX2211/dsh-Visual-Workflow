// src/client/components/panels/form-field.tsx
//
// 表单字段原语（标签 + 控件 + 可选提示）：属性栏表单与任务弹层表单共用同一结构，
// 差异只在样式变体（wf-field / wf-sched-field）——避免各处自带一份 Field 实现。

/** 字段样式变体：属性栏（wf-field）与定时任务表单（wf-sched-field）。 */
export type FieldVariant = 'inspector' | 'scheduler'

export interface FieldProps {
  label: string
  /** 控件下方补充说明（可选）。 */
  hint?: string
  variant?: FieldVariant
  children: React.ReactNode
}

export function Field({ label, hint, variant = 'inspector', children }: FieldProps) {
  const scheduler = variant === 'scheduler'
  return (
    <label className={scheduler ? 'wf-sched-field' : 'wf-field'}>
      <span className={scheduler ? 'wf-sched-field__label' : 'wf-hint'}>{label}</span>
      {children}
      {hint ? <span className={scheduler ? 'wf-sched-field__hint' : 'wf-hint'}>{hint}</span> : null}
    </label>
  )
}
