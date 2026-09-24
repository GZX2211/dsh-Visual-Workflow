// src/client/components/panels/inspector/file-form.tsx
//
// 文件表单（text 文本内容 / file 受管文件，支持多选所有类型文件）。

import type { Dict } from '../../../i18n.js'
import { Field } from '../form-field.js'
import { NameField, TextAreaField } from './form-primitives.js'

export function FileForm({ data, copy, onPatch, onFileSelect }: {
  data: Record<string, unknown>
  copy: Dict
  onPatch(patch: Record<string, unknown>): void
  /** 多选文件回调（用户验收：支持多选所有类型文件）。 */
  onFileSelect(files: File[]): void
}) {
  const fileKind = String(data.fileKind ?? 'text')
  // 已选文件列表：多选 files 优先，兼容单选旧字段（fileName/managedPath）
  const files = (data.files as Array<{ fileName?: unknown }> | undefined) ?? []
  const selectedNames = files.length > 0
    ? files.map((item) => String(item?.fileName ?? '')).filter(Boolean)
    : [String(data.fileName ?? '')].filter(Boolean)
  return (
    <div>
      <h3>{copy.nodeKinds.file}</h3>
      <NameField data={data} copy={copy} onPatch={onPatch} />
      <Field label={copy.fileKind}>
        <select
          value={fileKind}
          onChange={(event) => onPatch({ fileKind: event.target.value, content: '', managedPath: undefined, fileName: '', files: [] })}
        >
          <option value="text">{copy.fileKindLabel.text}</option>
          <option value="file">{copy.fileKindLabel.file}</option>
        </select>
      </Field>
      {fileKind === 'text' ? (
        <TextAreaField label={copy.fileContent} value={data.content} placeholder={copy.fileContent} onChange={(value) => onPatch({ content: value })} />
      ) : (
        <div className="wf-field wf-field--gap6">
          <input
            type="file"
            multiple
            onChange={(event) => {
              const picked = Array.from(event.target.files ?? [])
              if (picked.length > 0) onFileSelect(picked)
              event.target.value = ''
            }}
          />
          {/* 已选文件列表：显示在按钮下方（用户验收：不在按钮右侧/上方显示），
              完整文件名，支持多选所有类型文件 */}
          <div className="wf-file-list">
            {selectedNames.length > 0
              ? selectedNames.map((name) => <span key={name} className="wf-file-chip" title={name}>{name}</span>)
              : <span className="wf-hint">{copy.fileUnset}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
