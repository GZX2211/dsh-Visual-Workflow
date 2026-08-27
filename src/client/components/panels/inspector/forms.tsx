// src/client/components/panels/inspector/forms.tsx
//
// 属性面板表单（照搬旧项目 node-panels.js，TSX 化 + 按需求 §4.2.2~§4.3 适配）：
// 模板（name 数据源）/ 画布节点（label 数据源）共用；阶段/虚拟节点只读；
// 协作组含成员管理；连线含类型（流程/通过/不通过/内容）与内容值。

import type { Dict } from '../../../i18n.js'
import type { EditorData, ModelItem, PresetItem } from '../../../studio/studio-state.js'

// ---------------------------------------------------------------------------
// 通用字段
// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="wf-field">
      <span className="wf-hint">{label}</span>
      {children}
    </label>
  )
}

function InputField({ label, value, placeholder, onChange, type = 'text' }: { label: string; value: unknown; placeholder?: string; onChange(value: string): void; type?: string }) {
  return (
    <Field label={label}>
      <input type={type} value={String(value ?? '')} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </Field>
  )
}

function TextAreaField({ label, value, placeholder, onChange, minHeight }: { label: string; value: unknown; placeholder?: string; onChange(value: string): void; minHeight?: number }) {
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

function nameOf(data: Record<string, unknown>): string {
  return String(data?.name ?? data?.label ?? '')
}

function NameField({ data, copy, onPatch }: { data: Record<string, unknown>; copy: Dict; onPatch(patch: Record<string, unknown>): void }) {
  return (
    <InputField
      label={copy.label}
      value={nameOf(data)}
      onChange={(value) => onPatch({ label: value, name: value })}
    />
  )
}

// ---------------------------------------------------------------------------
// 角色表单（父/子代理；父代理模式仅 preset + 高级项只含 ReAct/重试）
// ---------------------------------------------------------------------------

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            value={String(data.systemPrompt ?? '')}
            placeholder={copy.personaHint}
            spellCheck={false}
            style={{ minHeight: 130 }}
            onChange={(event) => onPatch({ systemPrompt: event.target.value })}
          />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button type="button" className="wf-btn" title={copy.loadMdTitle} onClick={onLoadMd}>{copy.loadMd}</button>
            {String(data.systemPromptSource ?? '').trim()
              ? <span className="wf-hint" title={copy.loadMdTitle}>{String(data.systemPromptSource)}</span>
              : null}
          </div>
          {/* 官方系统提示词开关：贴左边框；复选框需覆盖 .wf-inspector input{width:100%} 全局样式（否则被撑成大方框、不贴边） */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-start' }}>
            <input
              type="checkbox"
              checked={data.injectSystemPrompt !== false}
              onChange={(event) => onPatch({ injectSystemPrompt: event.target.checked })}
              style={{ width: 'auto', flex: '0 0 auto', padding: 0, margin: 0, minWidth: 0, accentColor: 'var(--wf-brand)' }}
            />
            <span className="wf-hint" style={{ whiteSpace: 'nowrap' }}>
              {copy.injectSystemPromptLabel}：{data.injectSystemPrompt === false ? copy.injectSystemPromptNotInjected : copy.injectSystemPromptInjected}
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
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
      <div style={{ display: 'grid', gridTemplateColumns: hasMode ? '1fr 1fr' : '1fr', gap: 8 }}>
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
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

// ---------------------------------------------------------------------------
// 文件表单（text 文本内容 / file 受管文件，支持多选所有类型文件）
// ---------------------------------------------------------------------------

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
          <option value="text">{copy.fileKindLabel?.text}</option>
          <option value="file">{copy.fileKindLabel?.file}</option>
        </select>
      </Field>
      {fileKind === 'text' ? (
        <TextAreaField label={copy.fileContent} value={data.content} placeholder={copy.fileContent} onChange={(value) => onPatch({ content: value })} />
      ) : (
        <div className="wf-field" style={{ gap: 6 }}>
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

// ---------------------------------------------------------------------------
// 数据库表单（本地 / 服务器）
// ---------------------------------------------------------------------------

export function DatabaseForm({ data, copy, onPatch, onTest }: {
  data: Record<string, unknown>
  copy: Dict
  onPatch(patch: Record<string, unknown>): void
  onTest(): void
}) {
  const isServer = data.dbType === 'server'
  const conn = (data.conn ?? {}) as { host?: string; port?: number; user?: string; password?: string; db?: string }
  return (
    <div>
      <h3>{copy.nodeKinds.database}</h3>
      <NameField data={data} copy={copy} onPatch={onPatch} />
      <TextAreaField label={copy.description} value={data.description} placeholder={copy.descriptionHint} onChange={(value) => onPatch({ description: value })} />
      <Field label={copy.dbTypeLabel}>
        <select value={String(data.dbType ?? 'local')} onChange={(event) => onPatch({ dbType: event.target.value })}>
          <option value="local">{copy.dbTypeLocal}</option>
          <option value="server">{copy.dbTypeServer}</option>
        </select>
      </Field>
      {isServer ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <Field label={copy.dbKindLabel}>
            <select value={String(data.dbKind ?? 'mysql')} onChange={(event) => onPatch({ dbKind: event.target.value })}>
              <option value="mysql">MySQL</option>
              <option value="postgresql">PostgreSQL</option>
            </select>
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
            <InputField label={copy.dbHost} value={conn.host} onChange={(value) => onPatch({ conn: { ...conn, host: value } })} />
            <InputField label={copy.dbPort} type="number" value={conn.port ?? ''} onChange={(value) => onPatch({ conn: { ...conn, port: Number(value) || 0 } })} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <InputField label={copy.dbUser} value={conn.user} onChange={(value) => onPatch({ conn: { ...conn, user: value } })} />
            <InputField label={copy.dbPassword} type="password" value={conn.password} onChange={(value) => onPatch({ conn: { ...conn, password: value } })} />
          </div>
          <InputField label={copy.dbName} value={conn.db} onChange={(value) => onPatch({ conn: { ...conn, db: value } })} />
          <div>
            <button type="button" className="wf-btn" onClick={onTest} disabled={!conn.host}>{copy.dbTest}</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          <InputField label={copy.dbLocalPath} value={data.localPath} placeholder="D:\data\mydb.sqlite" onChange={(value) => onPatch({ localPath: value })} />
          <Field label={copy.dbVectorSource}>
            <select value={String(data.vectorSource ?? 'embedding')} onChange={(event) => onPatch({ vectorSource: event.target.value })}>
              <option value="embedding">{copy.dbVectorEmbedding}</option>
              <option value="bm25">{copy.dbVectorBm25}</option>
            </select>
          </Field>
          <span className="wf-hint">{copy.dbLocalHint}</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 阶段 / 协作组 / 虚拟节点
// ---------------------------------------------------------------------------

/** 阶段属性只读（无描述字段，无保存按钮，需求 §4.2.5.1）。 */
export function StageForm({ data, copy, nodeLabel }: { data: Record<string, unknown>; copy: Dict; nodeLabel: string }) {
  return (
    <div>
      <h3>{nodeLabel || String(data.label ?? '')}</h3>
      <div className="wf-pathbox">
        <span className="wf-pathbox__label">{copy.label}</span>
        <span className="wf-pathbox__value">{String(data.label ?? '')}</span>
      </div>
      <span className="wf-hint">{copy.stageReadonlyHint}</span>
    </div>
  )
}

/** 协作组（名称/协作 Prompt/成员列表删除）。 */
export function GroupForm({ data, copy, members, onPatch, onLoadMd, onRemoveMember }: {
  data: Record<string, unknown>
  copy: Dict
  members: Array<{ id: string; label: string }>
  onPatch(patch: Record<string, unknown>): void
  onLoadMd(): void
  onRemoveMember(memberId: string): void
}) {
  return (
    <div>
      <h3>{copy.nodeKinds.group}</h3>
      <NameField data={data} copy={copy} onPatch={onPatch} />
      <Field label={copy.collabPrompt}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <textarea
            value={String(data.collabPrompt ?? '')}
            placeholder={copy.collabPromptHint}
            spellCheck={false}
            onChange={(event) => onPatch({ collabPrompt: event.target.value })}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="wf-btn" title={copy.loadMdTitle} onClick={onLoadMd}>{copy.loadMd}</button>
          </div>
        </div>
      </Field>
      <Field label={copy.groupMembers}>
        <div className="wf-check-list">
          {members.length === 0 ? (
            <span className="wf-hint">{copy.groupMemberHint}</span>
          ) : (
            members.map((member) => (
              <label key={member.id} style={{ justifyContent: 'space-between' }}>
                <span>{member.label || member.id}</span>
                <button type="button" className="wf-btn is-danger" style={{ fontSize: 9, padding: '2px 6px' }} onClick={() => onRemoveMember(member.id)}>✕</button>
              </label>
            ))
          )}
        </div>
      </Field>
    </div>
  )
}

/** 虚拟节点只读（仅显示主节点名称，不可修改，§4.2.3.2 规则 3）。 */
export function ProxyForm({ data, copy, mainLabel }: { data: Record<string, unknown>; copy: Dict; mainLabel: string }) {
  return (
    <div>
      <h3>{copy.nodeKinds.proxy}</h3>
      <div className="wf-pathbox">
        <span className="wf-pathbox__label">{copy.proxyMainLabel}</span>
        <span className="wf-pathbox__value">{mainLabel || String(data.proxySourceId ?? '—')}</span>
      </div>
      <span className="wf-hint">{copy.proxyReadonlyHint}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 连线 / 工作流（服务）
// ---------------------------------------------------------------------------

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
          {`${flowMeta.nodeCount} ${copy.nodes ?? 'nodes'} · rev ${flowMeta.revision} · ${isService ? copy.mode2 : copy.mode1}`}
        </span>
      </div>
    </div>
  )
}
