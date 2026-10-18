// src/client/components/panels/inspector/task-form.tsx
//
// 任务表单：名称 + 任务描述；文本框下方「选择文件」只把文件路径追加进描述，不上传。

import type { Dict } from '../../../i18n.js'
import { NameField, TextAreaField } from './form-primitives.js'

export function TaskForm({ data, copy, onPatch, onFilesPicked }: {
  data: Record<string, unknown>
  copy: Dict
  onPatch(patch: Record<string, unknown>): void
  /** 多选文件回调：仅把路径追加进任务描述。 */
  onFilesPicked(files: File[]): void
}) {
  return (
    <div>
      <h3>{copy.nodeKinds.task}</h3>
      <NameField data={data} copy={copy} onPatch={onPatch} />
      <TextAreaField
        label={copy.taskContent}
        value={data.content}
        placeholder={copy.taskContent}
        onChange={(value) => onPatch({ content: value })}
      />
      <div className="wf-field wf-field--gap6">
        <input
          type="file"
          multiple
          aria-label={String(copy.pickFiles)}
          title={String(copy.pickFiles)}
          onChange={(event) => {
            const picked = Array.from(event.target.files ?? [])
            if (picked.length > 0) onFilesPicked(picked)
            event.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
