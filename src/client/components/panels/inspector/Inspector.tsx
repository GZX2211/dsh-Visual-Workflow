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
  onCopyProxy(): void
  onRemoveMember(memberId: string): void
  onFileSelect(file: File): void
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
    onPatch, onDelete, onSave, onCopyProxy, onRemoveMember, onFileSelect, onLoadMd, onLoadGroupMd, onTestDb,
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
        content = editorData.isParent
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
                isParent={false}
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
    const canCopyProxy = kind === 'role' && !editorData.isParent && !editorData.template
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
