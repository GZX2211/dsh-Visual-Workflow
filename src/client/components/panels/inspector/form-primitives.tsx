// src/client/components/panels/inspector/form-primitives.tsx
//
// 属性栏专用字段原语：文本输入 / 多行文本 / 名称字段（模板 name 与节点 label 双写口径）。
// 通用结构（标签 + 控件 + 提示）在 ../form-field.tsx。

import type { Dict } from '../../../i18n.js'
import { Field } from '../form-field.js'

export function InputField({ label, value, placeholder, onChange, type = 'text', step }: { label: string; value: unknown; placeholder?: string; onChange(value: string): void; type?: string; step?: string }) {
  return (
    <Field label={label}>
      <input type={type} value={String(value ?? '')} placeholder={placeholder} step={step} onChange={(event) => onChange(event.target.value)} />
    </Field>
  )
}

export function TextAreaField({ label, value, placeholder, onChange, minHeight }: { label: string; value: unknown; placeholder?: string; onChange(value: string): void; minHeight?: number }) {
  return (
    <Field label={label}>
      <textarea
        value={String(value ?? '')}
        placeholder={placeholder}
        spellCheck={false}
        style={minHeight ? { minHeight } : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

/** 名称取值口径：模板用 name、画布节点用 label，二者同义（保存时双写）。 */
export function nameOf(data: Record<string, unknown>): string {
  return String(data?.name ?? data?.label ?? '')
}

export function NameField({ data, copy, onPatch }: { data: Record<string, unknown>; copy: Dict; onPatch(patch: Record<string, unknown>): void }) {
  return (
    <InputField
      label={copy.label}
      value={nameOf(data)}
      onChange={(value) => onPatch({ label: value, name: value })}
    />
  )
}
