// src/client/components/panels/inspector/role-form.tsx
//
// 角色表单（父/子代理；父代理模式仅 preset + 高级项只含 ReAct/重试）：
// System Prompt + 开关 + Provider/模型/模式/思考强度 + 高级项。

import type { Dict } from '../../../i18n.js'
import type { PresetItem, ModelItem } from '../../../studio/studio-state.js'
import { Field } from '../form-field.js'
import { InputField, NameField, TextAreaField } from './form-primitives.js'

export interface ComboLike { id: string; name: string; tools?: string[]; mcpServers?: string[] }
/** 预设条目（与 studio-state PresetItem 同构，复用避免双份漂移）。 */
export type PresetLike = PresetItem
/** 模型条目（studio-state ModelItem 同构：含适配器公布的思考强度档位，V-02）。 */
export type ModelLike = ModelItem

/** 思考强度回退档位（DeepSeek 适配器公布 off/low/high/max；适配器未提供 efforts 时使用）。 */
const FALLBACK_EFFORTS: Array<{ id: string; name: string }> = [
  { id: 'off', name: 'Off' },
  { id: 'low', name: 'Low' },
  { id: 'high', name: 'High' },
  { id: 'max', name: 'Max' },
]

export function RoleForm({ data, copy, presets, models, combos, onPatch, onLoadMd, isParent = false, allowCombos = true }: {
  data: Record<string, unknown>
  copy: Dict
  presets: PresetLike[]
  models: ModelLike[]
  combos: ComboLike[]
  onPatch(patch: Record<string, unknown>): void
  onLoadMd(): void
  isParent?: boolean
  allowCombos?: boolean
}) {
  const providers = [...new Set(models.map((entry) => entry.provider))].filter(Boolean)
  const modelsForProvider = models.filter((entry) => entry.provider === String(data.provider ?? ''))
  const presetId = String(data.presetId ?? 'standard')
  const selectedCombo = allowCombos ? combos.find((combo) => combo.id === presetId) ?? null : null
  const toolCount = selectedCombo
    ? (selectedCombo.tools?.length ?? 0) + (selectedCombo.mcpServers?.length ?? 0)
    : null
  const modeOptions = (presets ?? []).map((preset) => ({ value: preset.id, label: preset.name ?? preset.id }))
  const modeGroups = allowCombos && (combos ?? []).length > 0
    ? [{ label: copy.combos, options: (combos ?? []).map((combo) => ({ value: combo.id, label: combo.name })) }]
    : []
  const hasMode = modeOptions.length > 0 || modeGroups.length > 0
  // 思考强度下拉：优先取所选模型公布的 efforts；未公布（undefined）回退内置档位；
  // 明确不支持（空数组）时只显示"默认"。
  const selectedModel = modelsForProvider.find((entry) => entry.model === String(data.model ?? ''))
  const effortOptions = selectedModel?.efforts == null
    ? FALLBACK_EFFORTS
    : selectedModel.efforts
  const effortsKnown = selectedModel?.efforts != null

  return (
    <div>
      <h3>{isParent ? copy.nodeKinds.parent : copy.nodeKinds.agent}</h3>
      <NameField data={data} copy={copy} onPatch={onPatch} />
      <Field label={copy.persona}>
        <div className="wf-form-stack">
          <textarea
            value={String(data.systemPrompt ?? '')}
            placeholder={copy.personaHint}
            spellCheck={false}
            style={{ minHeight: 130 }}
            onChange={(event) => onPatch({ systemPrompt: event.target.value })}
          />
          <div className="wf-form-row">
            <button type="button" className="wf-btn" title={copy.loadMdTitle} onClick={onLoadMd}>{copy.loadMd}</button>
            {String(data.systemPromptSource ?? '').trim()
              ? <span className="wf-hint" title={copy.loadMdTitle}>{String(data.systemPromptSource)}</span>
              : null}
          </div>
          {/* 官方系统提示词开关：贴左边框；复选框需覆盖 .wf-inspector input{width:100%} 全局样式（否则被撑成大方框、不贴边） */}
          <div className="wf-form-check">
            <input
              type="checkbox"
              className="wf-form-check__box"
              checked={data.injectSystemPrompt !== false}
              onChange={(event) => onPatch({ injectSystemPrompt: event.target.checked })}
            />
            <span className="wf-hint" style={{ whiteSpace: 'nowrap' }}>
              {copy.injectSystemPromptLabel}：{data.injectSystemPrompt === false ? copy.injectSystemPromptNotInjected : copy.injectSystemPromptInjected}
            </span>
          </div>
          {/* 工具提示词（tool:* 段）开关：贴左边框；复选框需覆盖 .wf-inspector input{width:100%} 全局样式（否则被撑成大方框、不贴边） */}
          <div className="wf-form-check">
            <input
              type="checkbox"
              className="wf-form-check__box"
              checked={data.injectToolSections !== false}
              onChange={(event) => onPatch({ injectToolSections: event.target.checked })}
            />
            <span className="wf-hint" style={{ whiteSpace: 'nowrap' }}>
              {copy.injectToolSectionsLabel}：{data.injectToolSections === false ? copy.injectToolSectionsNotInjected : copy.injectToolSectionsInjected}
            </span>
          </div>
          {/* Prompt 文件宿主路径：提示语置于输入框上方（设置后运行时自动读取该 .md，文件改动自动重载） */}
          <span className="wf-hint">{copy.promptFilePathHint}</span>
          <input
            type="text"
            value={String(data.promptFilePath ?? '')}
            placeholder={copy.promptFilePathPlaceholder}
            spellCheck={false}
            onChange={(event) => onPatch({ promptFilePath: event.target.value.trim() || undefined })}
          />
        </div>
      </Field>
      <div className="wf-form-grid-2">
        <Field label={copy.provider}>
          <select value={String(data.provider ?? '')} onChange={(event) => onPatch({ provider: event.target.value, model: '' })}>
            <option value="">(default)</option>
            {providers.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
          </select>
        </Field>
        <Field label={copy.model}>
          <select value={String(data.model ?? '')} onChange={(event) => onPatch({ model: event.target.value })}>
            <option value="">(default)</option>
            {modelsForProvider.map((entry) => <option key={entry.model} value={entry.model}>{entry.model}</option>)}
          </select>
        </Field>
      </div>
      <div className={hasMode ? 'wf-form-grid-2' : 'wf-form-grid-1'}>
        {hasMode ? (
          <Field label={copy.modeLabel}>
            <select value={presetId} disabled={isParent} onChange={(event) => onPatch({ presetId: event.target.value })}>
              {modeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              {modeGroups.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label={copy.thinking}>
          <select
            value={String(data.reasoning ?? '')}
            onChange={(event) => onPatch({ reasoning: event.target.value || null })}
          >
            <option value="">(default)</option>
            {effortOptions.map((effort) => <option key={effort.id} value={effort.id}>{effort.name}</option>)}
          </select>
        </Field>
      </div>
      {effortsKnown && effortOptions.length === 0
        ? <span className="wf-hint">{copy.thinkingUnsupportedHint}</span>
        : null}
      {toolCount != null ? <span className="wf-hint">{copy.modeSummary.replace('{count}', String(toolCount))}</span> : null}
      <details className="wf-advanced">
        <summary>{copy.advanced}</summary>
        <div className="wf-advanced__content">
          <div className="wf-form-grid-2">
            <Field label={copy.retryLimit}>
              <input
                type="number"
                min={1}
                max={20}
                value={Number(data.retryLimit ?? 3)}
                onChange={(event) => onPatch({ retryLimit: Math.max(1, Math.min(20, Number(event.target.value) || 3)) })}
              />
            </Field>
            <Field label={copy.reactLimit}>
              <input
                type="number"
                min={0}
                placeholder={copy.reactLimitHint}
                value={Number(data.reactLimit ?? 0) || ''}
                onChange={(event) => onPatch({ reactLimit: Number(event.target.value) > 0 ? Number(event.target.value) : null })}
              />
            </Field>
          </div>
          {isParent ? (
            <span className="wf-hint">{copy.parentAdvancedHint}</span>
          ) : (
            <>
              <TextAreaField label={copy.inputSchema} value={data.inputSchema} placeholder="如：{query: string}" onChange={(value) => onPatch({ inputSchema: value })} />
              <TextAreaField label={copy.outputSchema} value={data.outputSchema} placeholder="如：{result: string, pass: boolean}" onChange={(value) => onPatch({ outputSchema: value })} />
            </>
          )}
        </div>
      </details>
    </div>
  )
}
