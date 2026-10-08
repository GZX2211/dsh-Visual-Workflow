// 经验表单（资产态「数据」Tag 以「经验」呈现时，属性栏的编辑面）。
//
// 字段与顺序（用户裁决，自上而下）：责任范围 → 任务类型 → 决策领域 → 情境 →
// 触发信号 → 原则 → 建议行动 → 不适用条件 → 证据；末尾三组只读区：长期质量统计、
// 系统生成的检索投影与领域记账的来源信息——界面只展示，绝不随保存回传（保存载荷由
// useExperiences 的 experiencePatchOf 投影）。
//
// 不适用条件 / 证据按「每行一条」编辑：文本域与数组的换算只在本文件发生，
// 空文本域即空数组（「清空」与「不改」的区分由投影层决定）。
//
// 经验**没有版本控制**，因此本表单没有 System Prompt / 模型 / 工具组合等运行期字段，
// 也没有回滚入口；状态切换（归档 / 恢复）由属性栏底部按钮承担（见 Inspector）。

import type { Dict } from '../../../i18n.js'
import { experienceStatRowsOf } from '../../../lib/experience-stats.js'
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

/** 只读值展示：缺省或空白统一显示占位符，避免出现只有标签的半截行。 */
function valueText(value: unknown): string {
  const text = String(value ?? '').trim()
  return text === '' ? '—' : text
}

/** 数组 → 文本域内容（每行一条；非数组按空处理）。 */
function linesOf(value: unknown): string {
  return Array.isArray(value) ? value.map((item) => String(item ?? '')).join('\n') : ''
}

/** 文本域内容 → 数组（按行切分，丢弃空行；空文本域即空数组）。 */
function listOf(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter((line) => line !== '')
}

export function ExperienceForm({ data, copy, onPatch }: ExperienceFormProps) {
  const statRows = experienceStatRowsOf(data.stats)
  return (
    <div>
      <h3>{copy.libTabExperience}</h3>
      <TextAreaField
        label={copy.experienceResponsibility}
        value={data.responsibility}
        minHeight={50}
        onChange={(responsibility) => onPatch({ responsibility })}
      />
      <InputField
        label={copy.experienceTaskType}
        value={data.taskType}
        onChange={(taskType) => onPatch({ taskType })}
      />
      <TextAreaField
        label={copy.experienceDecisionDomain}
        value={data.decisionDomain}
        minHeight={50}
        onChange={(decisionDomain) => onPatch({ decisionDomain })}
      />
      <TextAreaField
        label={copy.experienceSituation}
        value={data.situation}
        minHeight={70}
        onChange={(situation) => onPatch({ situation })}
      />
      <TextAreaField
        label={copy.experienceTrigger}
        value={data.trigger}
        minHeight={50}
        onChange={(trigger) => onPatch({ trigger })}
      />
      <TextAreaField
        label={copy.experiencePrinciple}
        value={data.principle}
        minHeight={80}
        onChange={(principle) => onPatch({ principle })}
      />
      <TextAreaField
        label={copy.experienceRecommendedAction}
        value={data.recommendedAction}
        minHeight={60}
        onChange={(recommendedAction) => onPatch({ recommendedAction })}
      />
      <TextAreaField
        label={copy.experienceExclusions}
        value={linesOf(data.exclusions)}
        placeholder={copy.experienceListPlaceholder}
        minHeight={50}
        onChange={(text) => onPatch({ exclusions: listOf(text) })}
      />
      <TextAreaField
        label={copy.experienceEvidence}
        value={linesOf(data.evidence)}
        placeholder={copy.experienceListPlaceholder}
        minHeight={50}
        onChange={(text) => onPatch({ evidence: listOf(text) })}
      />
      {/* 只读：长期质量统计（Host 由评价历史聚合的派生事实，§34 不允许人工编辑） */}
      <div className="wf-form-stack">
        <span className="wf-hint">{copy.experienceStatsTitle}</span>
        {statRows === null
          ? <span className="wf-hint">{copy.experienceStatsEmpty}</span>
          : (
            <dl className="wf-stat-list">
              {statRows.map((row) => (
                <div className="wf-stat" key={row.field}>
                  <dt className="wf-stat__label">{copy.experienceStatsFields[row.field]}</dt>
                  <dd className="wf-stat__value">{row.text}</dd>
                </div>
              ))}
            </dl>
          )}
        <span className="wf-hint">{copy.experienceStatsHint}</span>
      </div>
      {/* 只读：系统生成的检索投影（保存时由经验域重算，界面不参与） */}
      <div className="wf-form-stack">
        <span className="wf-hint">{copy.experienceRetrievalTitle}</span>
        <span className="wf-hint">{`${copy.experienceTaskRetrievalText}：${valueText(data.taskRetrievalText)}`}</span>
        <span className="wf-hint">{`${copy.experienceDecisionRetrievalText}：${valueText(data.decisionRetrievalText)}`}</span>
      </div>
      {/* 只读：来源信息（领域记账的事实，保存不改变它们） */}
      <div className="wf-form-stack">
        <span className="wf-hint">{copy.experienceProvenanceTitle}</span>
        <span className="wf-hint">{`${copy.experienceIdLabel}：${String(data.id ?? '')}`}</span>
        <span className="wf-hint">{`${copy.experienceSourceRun}：${valueText(data.sourceRunId)}`}</span>
        <span className="wf-hint">{`${copy.experienceGenerationPromptId}：${valueText(data.generationPromptId)}`}</span>
        <span className="wf-hint">{`${copy.experienceGenerationPromptVersion}：${valueText(data.generationPromptVersion)}`}</span>
        <span className="wf-hint">{`${copy.experienceEmbeddingModel}：${valueText(data.embeddingModel)}`}</span>
        <span className="wf-hint">{`${copy.experienceEmbeddingDimension}：${valueText(data.embeddingDimension)}`}</span>
        <span className="wf-hint">{`${copy.experienceCreatedAt}：${timeText(data.createdAt)}`}</span>
        <span className="wf-hint">{`${copy.experienceUpdatedAt}：${timeText(data.updatedAt)}`}</span>
      </div>
    </div>
  )
}
