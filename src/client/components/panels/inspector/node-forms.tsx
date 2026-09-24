// src/client/components/panels/inspector/node-forms.tsx
//
// 阶段 / 协作组 / 虚拟节点表单。

import type { Dict } from '../../../i18n.js'
import { Field } from '../form-field.js'
import { NameField } from './form-primitives.js'

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

/** 协作组（名称/协作 Prompt/成员列表删除）。模板态无成员（成员在画布内拖入登记），隐藏成员区。 */
export function GroupForm({ data, copy, members, onPatch, onLoadMd, onRemoveMember }: {
  data: Record<string, unknown>
  copy: Dict
  members?: Array<{ id: string; label: string }>
  onPatch(patch: Record<string, unknown>): void
  onLoadMd(): void
  onRemoveMember(memberId: string): void
}) {
  return (
    <div>
      <h3>{copy.nodeKinds.group}</h3>
      <NameField data={data} copy={copy} onPatch={onPatch} />
      <Field label={copy.collabPrompt}>
        <div className="wf-form-stack">
          <textarea
            value={String(data.collabPrompt ?? '')}
            placeholder={copy.collabPromptHint}
            spellCheck={false}
            onChange={(event) => onPatch({ collabPrompt: event.target.value })}
          />
          <div className="wf-form-row">
            <button type="button" className="wf-btn" title={copy.loadMdTitle} onClick={onLoadMd}>{copy.loadMd}</button>
          </div>
        </div>
      </Field>
      {members !== undefined ? (
        <Field label={copy.groupMembers}>
          <div className="wf-check-list">
            {members.length === 0 ? (
              <span className="wf-hint">{copy.groupMemberHint}</span>
            ) : (
              members.map((member) => (
                <label key={member.id} className="wf-check-list__row">
                  <span>{member.label || member.id}</span>
                  <button type="button" className="wf-btn is-danger wf-btn--xs" onClick={() => onRemoveMember(member.id)}>✕</button>
                </label>
              ))
            )}
          </div>
        </Field>
      ) : null}
    </div>
  )
}

/**
 * 虚拟节点表单（P4 闸门可视化）：引用主节点只读（§4.2.3.2 规则 3），另可编辑
 *   - 显示名（画布上替代角色名，如「里程碑①：方案评审」）；
 *   - 角色：普通执行入口（缺省，沿用自动完成）或里程碑闸门（不自动完成，
 *     只能由父代理 `wf_graph_patch(mark_node)` 显式标记，D-07/D-21）。
 */
export function ProxyForm({ data, copy, onPatch, mainLabel }: {
  data: Record<string, unknown>
  copy: Dict
  onPatch(patch: Record<string, unknown>): void
  mainLabel: string
}) {
  const isMilestone = data.role === 'milestone'
  return (
    <div>
      <h3>{copy.nodeKinds.proxy}</h3>
      <div className="wf-pathbox">
        <span className="wf-pathbox__label">{copy.proxyMainLabel}</span>
        <span className="wf-pathbox__value">{mainLabel || String(data.proxySourceId ?? '—')}</span>
      </div>
      <Field label={String(copy.proxyLabel)}>
        <input
          type="text"
          value={String(data.label ?? '')}
          placeholder={String(copy.proxyLabelHint)}
          onChange={(event) => onPatch({ label: event.target.value })}
        />
      </Field>
      <Field label={String(copy.proxyRole)}>
        <div className="wf-form-stack">
          <label className="wf-form-check">
            <input
              type="checkbox"
              className="wf-form-check__box"
              checked={isMilestone}
              onChange={(event) => onPatch({ role: event.target.checked ? 'milestone' : null })}
            />
            <span>{isMilestone ? copy.proxyRoleMilestone : copy.proxyRoleExecutor}</span>
          </label>
          <span className="wf-hint">{copy.proxyRoleMilestoneHint}</span>
        </div>
      </Field>
      <span className="wf-hint">{copy.proxyReadonlyHint}</span>
    </div>
  )
}
