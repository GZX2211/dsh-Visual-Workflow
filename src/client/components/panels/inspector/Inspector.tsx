// src/client/components/panels/inspector/Inspector.tsx
//
// 右侧属性面板（照搬旧项目 inspector.js，TSX 化）：
// 所见即所操作——点击模板编辑模板、点击画布节点编辑节点实例、点击连线编辑连线；
// 底部保存/删除作用于当前选中对象；阶段无保存（只读）；虚拟节点只读。

import type { Dict } from '../../../i18n.js'
import type { EditorData } from '../../../studio/studio-state.js'
import {
  RoleForm, FileForm, DatabaseForm, StageForm, GroupForm, ProxyForm, LinePanel, WorkflowForm,
} from './forms.js'

export interface InspectorProps {
  copy: Dict
  open: boolean
  width: number
  editorData: EditorData | null
  presets: Array<{ id: string; name?: string }>
  tools: unknown[]
  models: Array<{ provider: string; model: string; efforts?: Array<{ id: string; name: string }> }>
  combos: Array<{ id: string; name: string; tools?: string[]; mcpServers?: string[] }>
  flowMeta: { nodeCount: number; revision: number }
  onPatch(patch: Record<string, unknown>): void
  onDelete(): void
  onSave(): void
  /** 图2 交互改造：实例 → 模板（另存为模板；用户裁决提供入口）。 */
  onSaveAsTemplate?(): void
  onCopyProxy(): void
  onRemoveMember(memberId: string): void
  onFileSelect(files: File[]): void
  onLoadMd(): void
  /** 协作 Prompt 从 .md 加载（与角色 System Prompt 一致）。 */
  onLoadGroupMd(): void
  onTestDb(): void
  saveDisabled: boolean
  importBusy: boolean
}

export function Inspector(props: InspectorProps) {
  const {
    copy: t, open, width, editorData, presets, tools, models, combos, flowMeta,
    onPatch, onDelete, onSave, onSaveAsTemplate, onCopyProxy, onRemoveMember, onFileSelect, onLoadMd, onLoadGroupMd, onTestDb,
    saveDisabled, importBusy,
  } = props
  void tools

  let content: React.ReactNode
  if (!editorData) {
    content = <div className="wf-empty">{t.inspectorEmpty}</div>
  } else {
    const data = editorData.data
    switch (editorData.kind) {
      case 'workflow':
      case 'service':
        content = <WorkflowForm data={data} copy={t} isService={editorData.kind === 'service'} flowMeta={flowMeta} onPatch={onPatch} />
        break
      case 'role':
        // 父代理规则：左侧模板点击无属性（不可编辑）；画布父代理节点可编辑
        // （名称/System Prompt/服务商/模型/思考强度/模式（仅 preset）/高级选项，§4.2.3.1）
        content = editorData.isParent && editorData.template
          ? <div className="wf-empty">{String(t.parentTemplateHint ?? '')}</div>
          : (
              <RoleForm
                data={data}
                copy={t}
                presets={presets}
                models={models}
                combos={combos}
                onPatch={onPatch}
                onLoadMd={onLoadMd}
                isParent={editorData.isParent === true}
                allowCombos={editorData.isParent !== true}
              />
            )
        break
      case 'file':
        content = <FileForm data={data} copy={t} onPatch={onPatch} onFileSelect={onFileSelect} />
        break
      case 'database':
        content = <DatabaseForm data={data} copy={t} onPatch={onPatch} onTest={onTestDb} />
        break
      case 'group':
        content = <GroupForm data={data} copy={t} members={editorData.members ?? []} onPatch={onPatch} onLoadMd={onLoadGroupMd} onRemoveMember={onRemoveMember} />
        break
      case 'stage':
        content = <StageForm data={data} copy={t} nodeLabel={String(data.label ?? '')} />
        break
      case 'proxy':
        content = <ProxyForm data={data} copy={t} mainLabel={editorData.mainLabel ?? ''} />
        break
      case 'edge':
        content = <LinePanel data={data} copy={t} onPatch={onPatch} />
        break
      default:
        content = <div className="wf-empty">{t.inspectorEmpty}</div>
    }
  }

  // 底部按钮规则（所见即所操作）
  const footer: React.ReactNode[] = []
  if (editorData) {
    const kind = editorData.kind
    const isStage = kind === 'stage'
    const isProxy = kind === 'proxy'
    // 复制按钮：画布角色节点（含父代理节点，§4.2.3.1 规则 3 可创建虚拟节点）；
    // 模板与父代理模板不可复制
    const canCopyProxy = kind === 'role' && !editorData.template
    if (!isStage) {
      footer.push(
        <button key="save" type="button" className="wf-btn is-primary" onClick={onSave} disabled={importBusy || saveDisabled}>
          {t.inspectorSave}
        </button>,
      )
    }
    footer.push(
      <button key="delete" type="button" className="wf-btn is-danger" onClick={onDelete} disabled={importBusy}>
        {t.inspectorDelete}
      </button>,
    )
    if (canCopyProxy) {
      footer.push(
        <button key="copy" type="button" className="wf-btn" onClick={onCopyProxy} disabled={importBusy}>
          {t.inspectorCopy}
        </button>,
      )
    }
    // 图2 交互改造：实例态（工作流/服务实例）提供「另存为模板」——当前实例内容
    // 复制为全局共享的工作流模板（模板库 + 号也能新建空白模板，二者均可）。
    if ((kind === 'workflow' || kind === 'service') && !editorData.template && onSaveAsTemplate) {
      footer.push(
        <button key="save-as-template" type="button" className="wf-btn" onClick={onSaveAsTemplate} disabled={importBusy}>
          {String(t.saveAsTemplate ?? '')}
        </button>,
      )
    }
    void isProxy
  }

  return (
    <aside className={`wf-inspector${open ? '' : ' is-collapsed'}`} style={{ width: open ? width : undefined }}>
      <div className="wf-inspector__scroll">{content}</div>
      {footer.length > 0
        ? <div className="wf-inspector__footer">{footer}</div>
        : null}
    </aside>
  )
}
