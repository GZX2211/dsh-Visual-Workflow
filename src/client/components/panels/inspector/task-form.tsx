// src/client/components/panels/inspector/task-form.tsx
//
// 任务表单：名称 + 任务描述；文本框下方「选择文件」只把文件路径追加进描述，不上传。
// 文件入口与角色「从 .md 文件加载」统一为同一个 wf-btn 按钮：原生 file input 隐藏，
// 不再出现「未选择任何文件」预览（用户批注：所有节点类型以角色样式为准）。

import { useRef } from 'react'
import type { Dict } from '../../../i18n.js'
import { NameField, TextAreaField } from './form-primitives.js'

export function TaskForm({ data, copy, onPatch, onFilesPicked }: {
  data: Record<string, unknown>
  copy: Dict
  onPatch(patch: Record<string, unknown>): void
  /** 多选文件回调：仅把路径追加进任务描述。 */
  onFilesPicked(files: File[]): void
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
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
      <div className="wf-form-row">
        <button
          type="button"
          className="wf-btn"
          title={String(copy.pickFiles)}
          onClick={() => fileInputRef.current?.click()}
        >
          {copy.pickFiles}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="wf-import-hidden"
          aria-label={String(copy.pickFiles)}
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
