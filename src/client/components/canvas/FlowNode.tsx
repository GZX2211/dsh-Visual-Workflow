// src/client/components/canvas/FlowNode.tsx
//
// 画布节点卡片（照搬旧项目 graph-canvas.js 的 FlowNode，TSX 化 + 新模型适配）：
// 角色（父/子代理）/ 文件 / 数据库 / 阶段 / 虚拟节点。接点按 HANDLES 展开；
// 运行状态徽标（pending/running/ok/fail）回显；虚拟节点虚线边框 + 「↻ 引用」角标。
//
// 用户验收标注修复（2026.08.25）：
//   - 角色卡元信息两行显示：模型：<model> / 组合：<模式或组合名>（原为单行「模式：…」）；
//   - 文件节点卡：文本类型显示内容（不显示文件类型词、超两行省略）；文件类型显示
//     所选文件名列表（不显示「文件」前缀、超出省略）；
//   - 虚拟节点「↻ 引用」徽标只渲染一处（原 label 行 + 元信息行各一处 → 重复）；
//   - 输入/输出节点只保留一个连接点（用户验收：模式二输入=flow-out、输出=flow-in）。
//
// 功能与优化批注（2026.08.26）：
//   - 卡片右上角新增「交换左右连接点」按钮（交换两侧连接点位置，美化布线防交叉）；
//     交换后出点移到左侧、入点移到右侧，再次点击恢复；状态随节点持久化（swapPorts）；
//   - 连接点按「入口/出口」区分颜色（左/右位置由交换决定，颜色区分方向）。协作组卡片不提供该按钮。

import type { Dict } from '../../i18n.js'
import type { CanvasNode } from '../../studio/studio-state.js'
import { HANDLES } from '../../lib/graph-model.js'
import { handleY, nodeSizeOf } from './geometry.js'

interface FlowNodeProps {
  node: CanvasNode
  copy: Dict & { modeName(id: string | null | undefined): string }
  mode: 'mode1' | 'mode2'
  selected: boolean
  highlighted: boolean
  dragging: boolean
  runStatus: { status: string; attempts: number } | null
  onPointerDown(event: React.PointerEvent, id: string): void
  onHandlePointerDown(event: React.PointerEvent, id: string, handle: string): void
  /** 交换左右连接点（节点属性 swapPorts 取反）。 */
  onToggleSwap(id: string): void
}

/**
 * 连接点（按模式裁剪：输入/输出节点仅保留流程连接点，用户验收标注「应当只有一个」；
 * 支持交换：swapped 时出点放左侧、入点放右侧，顺序由 handleY 决定，与批注一致）。
 */
function nodeHandles(kind: string, mode: 'mode1' | 'mode2', swapped: boolean): { left: string[]; right: string[] } {
  const def = HANDLES[kind] ?? HANDLES.agent
  // 启动/输入：仅右出 flow-out；结束/输出：仅左入 flow-in（原 ctx 连接点裁剪，
  // 外部问题已自动注入输入节点产出，流式返回亦不依赖输出节点 ctx-in 连线）
  if (kind === 'start') return { left: [], right: ['flow-out'] }
  if (kind === 'end') return { left: ['flow-in'], right: [] }
  const inputs = (def.inputs ?? []).filter((handle) => !(mode === 'mode1' && kind === 'end' && handle === 'ctx-in'))
  const outputs = (def.outputs ?? []).filter((handle) => !(mode === 'mode1' && kind === 'start' && handle === 'ctx-out'))
  // 默认左入右出；交换后左出右入（批注：左侧上下文出、流程出；右侧数据库入、上下文入、流程入）
  const left = swapped ? [...outputs].reverse() : [...inputs].reverse()
  const right = swapped ? [...inputs].reverse() : [...outputs].reverse()
  return { left, right }
}

/** 截断文本（按字符数；中文友好）。 */
function clip(text: string, limit: number): string {
  const value = String(text ?? '')
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

/** 节点元信息行（每行独立渲染；用户验收：角色卡为「模型 / 组合」两行）。 */
function metaLinesOf(node: CanvasNode, copy: Dict & { modeName(id: string | null | undefined): string }): string[] {
  const kind = node.kind
  const data = node.data
  const out: string[] = []
  if (kind === 'proxy') {
    // 虚拟节点：不在此处重复渲染「↻ 引用」徽标（label 行已有）
    return out
  }
  if (kind === 'parent' || kind === 'agent') {
    // 格式：模型：deepseek（换行）组合：（显示选择的模式或组合）
    const modelLabel = String(copy.nodeMetaModel ?? '模型')
    const presetLabel = String(copy.nodeMetaPreset ?? '组合')
    out.push(`${modelLabel}：${String(data.model ?? '').trim() || '—'}`)
    out.push(`${presetLabel}：${copy.modeName((data.presetId as string | null) ?? null)}`)
  } else if (kind === 'file') {
    const fileKind = String(data.fileKind ?? 'text')
    const files = (data.files as Array<{ fileName?: unknown; managedPath?: unknown }> | undefined) ?? []
    if (fileKind === 'text') {
      // 文本类型：显示输入的内容（不显示文件类型词），超出两行省略
      const content = clip(String(data.content ?? ''), 56)
      if (content.trim()) out.push(content)
    } else {
      // 文件类型：显示所选文件名列表（不显示「文件」前缀），超出省略
      const names = files.length > 0
        ? files.map((item) => String(item?.fileName ?? '')).filter(Boolean)
        : [String(data.fileName ?? '')].filter(Boolean)
      if (names.length > 0) out.push(clip(names.join('，'), 40))
    }
  } else if (kind === 'database') {
    out.push(data.dbType === 'server' ? `${String(data.dbKind ?? 'mysql')} · ${String(copy.dbTypeServer ?? '服务器')}` : String(copy.dbLocalLabel ?? '本地库'))
    if (data.vectorSource === 'bm25') out.push(String(copy.dbBm25Badge ?? '相似度检索（非语义）'))
  }
  return out.filter((line) => String(line ?? '').trim())
}

export function FlowNode({ node, copy, mode, selected, highlighted, dragging, runStatus, onPointerDown, onHandlePointerDown, onToggleSwap }: FlowNodeProps) {
  const kind = node.kind
  const isProxy = kind === 'proxy'
  // 阶段节点（启动/结束/暂停）：单/双流程连接点，交换无意义且会产生死数据（审查 BUG-1），
  // 与协作组一致不渲染交换按钮。
  const isStage = kind === 'start' || kind === 'end' || kind === 'pause'
  // 交换状态随节点持久化（用户批注：作为节点属性保存，重载后保持）
  const swapped = (node.data as { swapPorts?: unknown }).swapPorts === true
  const displayKind = isProxy ? 'agent' : kind
  const handles = nodeHandles(displayKind, mode, swapped)
  const status = runStatus?.status ?? null
  const statusText = status ? String((copy.status as Record<string, string>)[status] ?? '') : ''
  const metaLines = metaLinesOf(node, copy)
  // 每行独立元信息（角色卡「模型 / 组合」两行显示；CSS white-space:pre-wrap 生效）
  const metaText = metaLines.join('\n')
  const size = nodeSizeOf(node)
  const cls = [
    'wf-node',
    `wf-node--${displayKind}`,
    selected ? 'is-selected' : '',
    highlighted ? 'is-highlighted' : '',
    isProxy ? 'is-proxy' : '',
  ].filter(Boolean).join(' ')

  // 单侧接点渲染：side 决定左右位置，dir 决定入口/出口颜色（批注：区分入口与出口）
  const handleEl = (handle: string, side: 'left' | 'right'): React.ReactNode => {
    const dir = handle.endsWith('-out') ? 'out' : 'in'
    const style: React.CSSProperties = { top: `${handleY(handle) * 100}%` }
    if (side === 'left') style.left = -6
    else style.right = -6
    return (
      <span
        key={handle}
        className={`wf-graph__handle is-side-${side} is-${dir}`}
        style={style}
        data-handle={handle}
        title={handle}
        onPointerDown={(event) => onHandlePointerDown(event, node.id, handle)}
      />
    )
  }

  return (
    <div
      className={`wf-graph__node${dragging ? ' is-dragging' : ''}`}
      data-wf-node-id={node.id}
      style={{ left: node.position.x, top: node.position.y, width: size.w, height: size.h }}
      onPointerDown={(event) => onPointerDown(event, node.id)}
    >
      <div className={cls}>
        {!isStage ? (
          <button
            type="button"
            className={`wf-node__swap${swapped ? ' is-active' : ''}`}
            title={String(copy.swapPorts ?? '交换左右连接点')}
            aria-label={String(copy.swapPorts ?? '交换左右连接点')}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); onToggleSwap(node.id) }}
          >{swapped ? '⇆' : '⇄'}</button>
        ) : null}
        <div className="wf-node__kind">
          <span>{String(copy.nodeKinds?.[displayKind] ?? displayKind)}</span>
          {statusText ? <span className={`wf-status-dot is-${status}`} /> : null}
          {statusText ? <span className="wf-hint">{statusText}</span> : null}
        </div>
        <div className="wf-node__label">
          {isProxy ? <span className="wf-node__proxy-badge">↻ 引用</span> : null}
          {String(node.data.label ?? copy.nodeKinds?.[displayKind] ?? '')}
        </div>
        {metaLines.length > 0 ? <div className="wf-node__prompt">{metaText}</div> : null}
        {handles.left.map((handle) => handleEl(handle, 'left'))}
        {handles.right.map((handle) => handleEl(handle, 'right'))}
      </div>
    </div>
  )
}
