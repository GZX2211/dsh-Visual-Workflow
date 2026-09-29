// src/client/components/panels/inspector/experience-form.tsx
//
// 经验表单（资产态「数据」Tag 以「经验」呈现时，属性栏的编辑面）。
//
// 字段与顺序（用户裁决，自上而下）：任务类型 → 任务上下文 → 经验 → 证据 → 审核意见；
// 末尾是只读元信息（经验 id / 来源运行 / 创建与更新时间）——它们由资产库记账，
// 界面只展示，绝不随保存回传（保存载荷由 useExperiences 的 experiencePatchOf 投影）。
//
// 经验**没有版本控制**，因此本表单没有 System Prompt / 模型 / 工具组合等运行期字段，
// 也没有回滚入口；状态切换（归档 / 恢复）由属性栏底部按钮承担（见 Inspector）。

import type { Dict } from '../../../i18n.js'
import { InputField, TextAreaField } from './form-primitives.js'

export interface ExperienceFormProps {
  data: Record<string, unknown>
  copy: Dict
  onPatch(patch: Record<string, unknown>): void
}

/** 时间展示（epoch 毫秒 → 本地时间；非法值显示占位符，不抛错）。 */
function timeText(value: unknown): string {
  const date = new Date(Number(value))
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : '—'
}

export function ExperienceForm({ data, copy, onPatch }: ExperienceFormProps) {
  const sourceRunId = String(data.sourceRunId ?? '')
  return (
    <div>
      <h3>{copy.libTabExperience}</h3>
      <InputField
        label={copy.experienceTaskType}
        value={data.taskType}
        onChange={(taskType) => onPatch({ taskType })}
      />
      <TextAreaField
        label={copy.experienceTaskContext}
        value={data.taskContext}
        minHeight={70}
        onChange={(taskContext) => onPatch({ taskContext })}
      />
      <TextAreaField
        label={copy.experienceInsight}
        value={data.insight}
        minHeight={90}
        onChange={(insight) => onPatch({ insight })}
      />
      <TextAreaField
        label={copy.experienceEvidence}
        value={data.evidence}
        minHeight={60}
        onChange={(evidence) => onPatch({ evidence })}
      />
      <TextAreaField
        label={copy.experienceReviewFeedback}
        value={data.reviewFeedback}
        minHeight={50}
        onChange={(reviewFeedback) => onPatch({ reviewFeedback })}
      />
      {/* 只读元信息：领域记账的事实，界面只呈现（保存不改变它们） */}
      <div className="wf-form-stack">
        <span className="wf-hint">{`${copy.experienceIdLabel}：${String(data.id ?? '')}`}</span>
        {sourceRunId !== '' ? <span className="wf-hint">{`${copy.experienceSourceRun}：${sourceRunId}`}</span> : null}
        <span className="wf-hint">{`${copy.experienceCreatedAt}：${timeText(data.createdAt)}`}</span>
        <span className="wf-hint">{`${copy.experienceUpdatedAt}：${timeText(data.updatedAt)}`}</span>
      </div>
    </div>
  )
}
