// src/client/components/panels/inspector/prompt-asset-form.tsx
//
// 经验生成提示词资产表单（资产态「其他」Tab 的提示词卡片打开后的属性栏）。
//
// 用户裁决：只有正文可编辑；名称 / 描述 / 主体类型 / 资产与版本身份全部只读。
// 保存由属性栏底部「保存」触发，登记新版本；归档 / 恢复入口不出现（资产必须保持活跃），
// 版本切换复用资产版本上拉列表（见 Inspector / asset-versions）。

import type { Dict } from '../../../i18n.js'
import { TextAreaField } from './form-primitives.js'

export interface PromptAssetFormProps {
  data: Record<string, unknown>
  copy: Dict
  onPatch(patch: Record<string, unknown>): void
}

/** 只读值展示：缺省或空白统一显示占位符。 */
function valueText(value: unknown): string {
  const text = String(value ?? '').trim()
  return text === '' ? '—' : text
}

export function PromptAssetForm({ data, copy, onPatch }: PromptAssetFormProps) {
  const experienceType = String(data.experienceType ?? '')
  const typeName = (copy.experienceTypeNames as Record<string, string>)[experienceType] ?? valueText(experienceType)
  return (
    <div>
      <h3>{copy.promptAssetTitle}</h3>
      <div className="wf-form-stack">
        <span className="wf-hint">{`${copy.promptAssetName}：${valueText(data.name)}`}</span>
        <span className="wf-hint">{`${copy.promptAssetExperienceType}：${typeName}`}</span>
        <span className="wf-hint">{`${copy.promptAssetDescription}：${valueText(data.description)}`}</span>
        <span className="wf-hint">{`${copy.promptAssetVersion}：v${String(data.versionId ?? '')}（${valueText(data.promptVersion)}）`}</span>
        <span className="wf-hint">{`${copy.promptAssetVersionRowId}：${valueText(data.rowId)}`}</span>
      </div>
      <TextAreaField
        label={copy.promptAssetBody}
        value={data.prompt}
        minHeight={360}
        onChange={(prompt) => onPatch({ prompt })}
      />
      <span className="wf-hint">{copy.promptAssetImmutableHint}</span>
      <span className="wf-hint">{copy.promptAssetActiveOnlyHint}</span>
    </div>
  )
}
