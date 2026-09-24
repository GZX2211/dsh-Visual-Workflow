// src/client/components/panels/inspector/flow-forms.tsx
//
// 连线与工作流（服务）表单。

import type { Dict } from '../../../i18n.js'
import { Field } from '../form-field.js'
import { InputField, TextAreaField } from './form-primitives.js'

export function LinePanel({ data, copy, onPatch }: {
  data: Record<string, unknown>
  copy: Dict
  onPatch(patch: Record<string, unknown>): void
}) {
  const condition = (data.condition ?? null) as { type?: string; label?: string } | null
  const type = condition?.type ?? 'flow'
  const isContent = type === 'content'
  const setType = (value: string): void => {
    if (value === 'flow') onPatch({ condition: null })
    else onPatch({ condition: { type: value, label: condition?.label ?? '' } })
  }
  return (
    <div>
      <h3>{copy.line}</h3>
      <Field label={copy.lineType}>
        <select value={type} onChange={(event) => setType(event.target.value)}>
          <option value="flow">{copy.lineTypeFlow}</option>
          <option value="pass">{copy.lineTypePass}</option>
          <option value="fail">{copy.lineTypeFail}</option>
          <option value="content">{copy.lineTypeContent}</option>
        </select>
      </Field>
      {isContent ? (
        <InputField label={copy.lineContentValue} value={condition?.label ?? ''} placeholder={copy.lineContentHint} onChange={(value) => onPatch({ condition: { type: 'content', label: value } })} />
      ) : null}
      <span className="wf-hint">{copy.lineConditionHint}</span>
    </div>
  )
}

export function WorkflowForm({ data, copy, isService, flowMeta, onPatch }: {
  data: Record<string, unknown>
  copy: Dict
  isService: boolean
  flowMeta: { nodeCount: number; revision: number }
  onPatch(patch: Record<string, unknown>): void
}) {
  return (
    <div>
      <h3>{isService ? copy.service : copy.workflow}</h3>
      <InputField label={copy.flowName} value={data.name} onChange={(value) => onPatch({ name: value })} />
      <TextAreaField label={copy.flowDescription} value={data.description} placeholder={copy.flowDescription} onChange={(value) => onPatch({ description: value })} />
      <div className="wf-pathbox">
        <span className="wf-pathbox__label">{copy.meta}</span>
        <span className="wf-pathbox__value">
          {`${flowMeta.nodeCount} ${copy.nodes} · rev ${flowMeta.revision} · ${isService ? copy.mode2 : copy.mode1}`}
        </span>
      </div>
    </div>
  )
}
