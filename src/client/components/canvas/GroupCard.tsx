// src/client/components/canvas/GroupCard.tsx
//
// 协作组卡片：组标签 + 成员迷你列表（可滚动）+ 右下角拉伸把手。
// 成员节点为组内角色（data.groupId = 组 id），作为迷你卡片渲染于组内（见 GraphCanvas）；
// 组卡片仅提供流程入/出连接点（跨组上下文连线走成员接点）。

import { memo } from 'react'
import type { Dict } from '../../i18n.js'
import type { CanvasNode } from '../../studio/studio-state.js'
import { nodeSizeOf } from '../../lib/card-geometry.js'
import { statusLabelOf } from '../../lib/status-label.js'

interface GroupCardProps {
  node: CanvasNode
  copy: Dict
  members: Array<{ id: string; label: string; status: string | null; locked?: boolean }>
  selected: boolean
  /** 联动高亮（与角色节点同款语义：外部选择/定位聚焦到本卡）。 */
  highlighted?: boolean
  /** 组卡片运行状态（快照 nodes[].status；缺省不渲染徽标）。 */
  runStatus?: { status: string; attempts: number } | null
  /** 拖拽悬停目标（左栏角色卡拖入时高亮并提示「放开以入组」）。 */
  dropTarget: boolean
  /** 组卡片自身运行中锁定（已完成/执行中）：锁角标 + 悬停提示。 */
  locked?: boolean
  lockHint?: string
  onPointerDown(event: React.PointerEvent, id: string): void
  onHandlePointerDown(event: React.PointerEvent, id: string, handle: string): void
  onMemberSelect(id: string): void
  onResizeStart(event: React.PointerEvent, id: string, direction: string): void
}

/**
 * 以 memo 包住：父组件拖拽/平移/缩放等本地渲染态变化时，只要组卡输入（节点、成员列表、
 * 选中/高亮/锁定、回调引用）未变即不重渲染；成员列表由 GraphCanvas 以 useMemo 保持引用稳定。
 */
export const GroupCard = memo(function GroupCard({ node, copy, members, selected, highlighted, runStatus, dropTarget, locked, lockHint, onPointerDown, onHandlePointerDown, onMemberSelect, onResizeStart }: GroupCardProps) {
  const size = nodeSizeOf(node)
  // 去重计数（历史数据可能残留重复 memberIds，避免计数虚高）
  const memberIds = [...new Set((node.data.memberIds as string[] | undefined) ?? [])]
  // 组卡片运行状态：状态点与文案与角色节点同源（statusLabelOf 走词典，不新增文案）
  const status = runStatus?.status ?? null
  const statusText = statusLabelOf(copy, status)
  // 组卡片提供流程入/出接点（居中；成员节点的上下文/数据库连线走成员自身接点）
  return (
    <div
      className={`wf-graph__node wf-group-node${dropTarget ? ' is-drop-target' : ''}`}
      data-wf-node-id={node.id}
      style={{ left: node.position.x, top: node.position.y, width: size.w, height: size.h }}
      onPointerDown={(event) => onPointerDown(event, node.id)}
    >
      <div className={`wf-node wf-node--group${selected ? ' is-selected' : ''}${highlighted ? ' is-highlighted' : ''}${status === 'running' ? ' is-running' : ''}${dropTarget ? ' is-drop-target' : ''}${locked ? ' is-locked' : ''}`} title={locked ? lockHint : undefined}>
        <div className="wf-node__kind">
          <span>{String(copy.nodeKinds.group)}</span>
          <span className="wf-hint">{`${memberIds.length} ${String(copy.groupMembers)}`}</span>
          {statusText ? <span className={`wf-status-dot is-${status}`} /> : null}
          {statusText ? <span className="wf-hint">{statusText}</span> : null}
          {locked ? <span className="wf-node__lock-badge" title={lockHint}>🔒</span> : null}
        </div>
        {dropTarget ? <div className="wf-group__drop-hint">{String(copy.groupDropHint)}</div> : null}
        <div className="wf-node__label">{String(node.data.label ?? copy.nodeKinds.group)}</div>
        <div className="wf-group__members">
          {members.length === 0
            ? <div className="wf-hint">{String(copy.groupMemberHint)}</div>
            : members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  className="wf-group__member"
                  data-wf-node-id={member.id}
                  onPointerDown={(event) => { event.stopPropagation() }}
                  onClick={(event) => { event.stopPropagation(); onMemberSelect(member.id) }}
                >
                  <span className="wf-group__member-name">{member.label || member.id}</span>
                  {member.locked ? <span className="wf-node__lock-badge" title={lockHint}>🔒</span> : null}
                  {member.status ? (
                    <span className="wf-group__member-status">
                      <span className={`wf-status-dot is-${member.status}`} />
                      <span className="wf-hint">{statusLabelOf(copy, member.status)}</span>
                    </span>
                  ) : null}
                  {/* 组内成员仅数据库/上下文接点，无流程接点（流程由组卡片承担）；
                      成员为缩小版角色卡：仅名称 + 状态（用户批注） */}
                  <span
                    className="wf-graph__handle wf-graph__handle--target wf-graph__handle--mini wf-graph__handle--member-db-in"
                    data-handle="db-in"
                    title="db-in"
                    onPointerDown={(event) => { event.stopPropagation(); onHandlePointerDown(event, member.id, 'db-in') }}
                  />
                  <span
                    className="wf-graph__handle wf-graph__handle--target wf-graph__handle--mini wf-graph__handle--member-ctx-in"
                    data-handle="ctx-in"
                    title="ctx-in"
                    onPointerDown={(event) => { event.stopPropagation(); onHandlePointerDown(event, member.id, 'ctx-in') }}
                  />
                  <span
                    className="wf-graph__handle wf-graph__handle--source wf-graph__handle--mini wf-graph__handle--member-ctx-out"
                    data-handle="ctx-out"
                    title="ctx-out"
                    onPointerDown={(event) => { event.stopPropagation(); onHandlePointerDown(event, member.id, 'ctx-out') }}
                  />
                </button>
              ))}
        </div>
        <span
          className="wf-graph__handle wf-graph__handle--target wf-graph__handle--group-flow"
          data-handle="flow-in"
          title="flow-in"
          onPointerDown={(event) => onHandlePointerDown(event, node.id, 'flow-in')}
        />
        <span
          className="wf-graph__handle wf-graph__handle--source wf-graph__handle--group-flow"
          data-handle="flow-out"
          title="flow-out"
          onPointerDown={(event) => onHandlePointerDown(event, node.id, 'flow-out')}
        />
        <div
          className="wf-group__resize is-se"
          onPointerDown={(event) => onResizeStart(event, node.id, 'se')}
        />
      </div>
    </div>
  )
})
