// src/client/components/canvas/GroupCard.tsx
//
// 协作组卡片（需求 §4.2.5.2）：组标签 + 成员迷你列表（可滚动）+ 右下角拉伸把手。
// 成员节点为组内角色（data.groupId = 组 id），作为迷你卡片渲染于组内（见 GraphCanvas）；
// 组卡片仅提供流程入/出连接点（跨组上下文连线走成员接点）。

import type { Dict } from '../../i18n.js'
import type { CanvasNode } from '../../studio/studio-state.js'
import { nodeSizeOf } from './geometry.js'

interface GroupCardProps {
  node: CanvasNode
  copy: Dict
  members: Array<{ id: string; label: string; status: string | null }>
  selected: boolean
  /** 拖拽悬停目标（左栏角色卡拖入时高亮并提示「放开以入组」）。 */
  dropTarget: boolean
  onPointerDown(event: React.PointerEvent, id: string): void
  onHandlePointerDown(event: React.PointerEvent, id: string, handle: string): void
  onMemberSelect(id: string): void
  onResizeStart(event: React.PointerEvent, id: string, direction: string): void
}

export function GroupCard({ node, copy, members, selected, dropTarget, onPointerDown, onHandlePointerDown, onMemberSelect, onResizeStart }: GroupCardProps) {
  const size = nodeSizeOf(node)
  const memberIds = (node.data.memberIds as string[] | undefined) ?? []
  // 组卡片提供流程入/出接点（居中；成员节点的上下文/数据库连线走成员自身接点）
  return (
    <div
      className={`wf-graph__node wf-group-node${dropTarget ? ' is-drop-target' : ''}`}
      data-wf-node-id={node.id}
      style={{ left: node.position.x, top: node.position.y, width: size.w, height: size.h }}
      onPointerDown={(event) => onPointerDown(event, node.id)}
    >
      <div className={`wf-node wf-node--group${selected ? ' is-selected' : ''}${dropTarget ? ' is-drop-target' : ''}`}>
        <div className="wf-node__kind">
          <span>{String(copy.nodeKinds?.group ?? '协作组')}</span>
          <span className="wf-hint">{`${memberIds.length} ${String(copy.groupMembers ?? '个成员')}`}</span>
        </div>
        {dropTarget ? <div className="wf-group__drop-hint">{String(copy.groupDropHint ?? '放开以入组')}</div> : null}
        <div className="wf-node__label">{String(node.data.label ?? copy.nodeKinds?.group ?? '协作组')}</div>
        <div className="wf-group__members">
          {members.length === 0
            ? <div className="wf-hint">{String(copy.groupMemberHint ?? '把角色拖入组内')}</div>
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
                  {member.status ? <span className={`wf-status-dot is-${member.status}`} /> : null}
                  {/* 组内成员只有上下文/数据库接点（流程接点由组卡片承担，需求 §4.2.5.2 规则 4） */}
                  {['db-in', 'ctx-in'].map((handle) => (
                    <span
                      key={handle}
                      className="wf-graph__handle wf-graph__handle--target wf-graph__handle--mini"
                      style={handle === 'ctx-in' ? { left: 10 } : undefined}
                      data-handle={handle}
                      title={handle}
                      onPointerDown={(event) => { event.stopPropagation(); onHandlePointerDown(event, member.id, handle) }}
                    />
                  ))}
                  <span
                    className="wf-graph__handle wf-graph__handle--source wf-graph__handle--mini"
                    data-handle="ctx-out"
                    title="ctx-out"
                    onPointerDown={(event) => { event.stopPropagation(); onHandlePointerDown(event, member.id, 'ctx-out') }}
                  />
                </button>
              ))}
        </div>
        <span
          className="wf-graph__handle wf-graph__handle--target"
          style={{ top: '50%' }}
          data-handle="flow-in"
          title="flow-in"
          onPointerDown={(event) => onHandlePointerDown(event, node.id, 'flow-in')}
        />
        <span
          className="wf-graph__handle wf-graph__handle--source"
          style={{ top: '50%' }}
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
}
