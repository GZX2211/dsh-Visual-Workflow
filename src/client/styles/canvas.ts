// src/client/styles/canvas.ts
//
// 画布域。画布容器与网格背景、图舞台（连线 / 箭头 / 接点 / 缩放控件）、节点卡片与协作组卡片、画布内文件列表与空态提示。
//
// 本文件内规则顺序即覆盖顺序（同特异性下后写的覆盖先写的），禁止重排。

export const canvasStyles = `
/* ---- 画布容器与网格背景 ---- */
.wf-canvas-shell {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--wf-bg);
  overflow: hidden;
}

.wf-canvas-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.wf-canvas {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  background-color: var(--wf-bg);
  background-image: radial-gradient(circle, var(--wf-border-strong) 1.1px, transparent 1.2px), radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--wf-brand) 6%, transparent), transparent 42%);
  background-size: 24px 24px, 100% 100%;
  cursor: grab;
}

.wf-canvas.is-panning {
  cursor: grabbing;
}

/* ---- 图舞台：连线 / 箭头 / 标签 ---- */
.wf-graph__stage {
  position: absolute;
  left: 0;
  top: 0;
  width: 1px;
  height: 1px;
  transform-origin: 0 0;
  will-change: transform;
}

.wf-graph__edges {
  position: absolute;
  left: 0;
  top: 0;
  width: 1px;
  height: 1px;
  overflow: visible;
  pointer-events: none;
}

.wf-graph__edge {
  fill: none !important;
  stroke: var(--wf-flow);
  stroke-width: 2.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
  filter: drop-shadow(0 0 2px color-mix(in srgb, var(--wf-flow) 30%, transparent));
  pointer-events: none;
}

.wf-graph__edge.is-selected {
  stroke-width: 3.6;
  filter: drop-shadow(0 0 4px color-mix(in srgb, var(--wf-brand) 58%, transparent));
}

.wf-graph__edge.is-ctx {
  stroke: var(--wf-context);
}

.wf-graph__edge.is-db {
  stroke: var(--wf-database);
}

.wf-graph__edge.is-pass {
  stroke: var(--wf-pass);
}

.wf-graph__edge.is-fail {
  stroke: var(--wf-fail);
}

.wf-graph__edge.is-content {
  stroke: var(--wf-content);
}

.wf-arrow-head {
  fill: var(--wf-flow);
  stroke: none;
}

.wf-arrow-head.is-pass {
  fill: var(--wf-pass);
}

.wf-arrow-head.is-fail {
  fill: var(--wf-fail);
}

.wf-arrow-head.is-content {
  fill: var(--wf-content);
}

.wf-graph__edge.is-running {
  stroke-dasharray: 8 5;
}

/* 运行中锁定连线（已完成流程 / 执行中节点左入口）：灰化虚线 + 不可点击（点击不选中、属性栏不展开） */
.wf-graph__edge.is-locked {
  stroke: var(--wf-ink-2);
  stroke-dasharray: 3 4;
  opacity: .55;
  filter: none;
}

.wf-graph__edge-hit {
  fill: none !important;
  stroke: transparent;
  stroke-width: 18;
  vector-effect: non-scaling-stroke;
  pointer-events: stroke;
  cursor: pointer;
}

g.is-locked .wf-graph__edge-hit {
  cursor: not-allowed;
}

.wf-graph__connection {
  fill: none !important;
  stroke: var(--wf-brand);
  stroke-width: 2;
  stroke-dasharray: 7 5;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}

.wf-graph__label-bg {
  fill: var(--wf-layer);
  stroke: var(--wf-border);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.wf-graph__label {
  fill: var(--wf-ink);
  font-size: 10px;
  font-weight: 750;
  text-anchor: middle;
  dominant-baseline: middle;
  pointer-events: none;
}

/* ---- 节点定位与接点（入口蓝 / 出口橙，side 由交换决定） ---- */
.wf-graph__node {
  position: absolute;
  width: 208px;
  height: 116px;
  pointer-events: auto;
  cursor: grab;
}

.wf-graph__node.is-dragging {
  cursor: grabbing;
}

.wf-graph__handle {
  position: absolute;
  z-index: 4;
  top: 50%;
  width: 13px;
  height: 13px;
  padding: 0;
  border: 2px solid var(--wf-bg);
  border-radius: 50%;
  background: var(--wf-brand);
  transform: translateY(-50%);
  cursor: crosshair;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--wf-brand) 65%, var(--wf-border-strong));
  transition: transform .14s ease, box-shadow .14s ease;
}

.wf-graph__handle:hover,
.wf-graph__handle:focus-visible {
  transform: translateY(-50%) scale(1.18);
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--wf-brand) 18%, transparent);
  outline: 0;
}

/* 接点左右位置：普通卡片（角色/文件/数据库/阶段/虚拟）按交换状态动态指定 side；协作组卡固定 target/source */
.wf-graph__handle.is-side-left {
  left: -6px;
}

.wf-graph__handle.is-side-right {
  right: -6px;
}

/* 接点颜色区分入口/出口（用户批注：入口=蓝、出口=橙；位置由交换决定，颜色标识方向） */
.wf-graph__handle.is-in {
  background: var(--wf-port-in);
}

.wf-graph__handle.is-out {
  background: var(--wf-port-out);
}

.wf-graph__handle--target {
  left: -6px;
  background: var(--wf-port-in);
}

.wf-graph__handle--source {
  right: -6px;
  background: var(--wf-port-out);
}

/* ---- 画布缩放控件 ---- */
.wf-graph__controls {
  position: absolute;
  z-index: 8;
  left: 12px;
  bottom: 12px;
  display: grid;
  border: 1px solid var(--wf-border-strong);
  border-radius: 9px;
  overflow: hidden;
  background: var(--wf-layer);
  box-shadow: 0 8px 20px color-mix(in srgb, var(--wf-ink) 9%, transparent);
}

.wf-graph__controls button {
  width: 32px;
  height: 30px;
  border: 0;
  border-bottom: 1px solid var(--wf-border);
  background: var(--wf-layer-2);
  color: var(--wf-ink);
  font-weight: 750;
}

.wf-graph__controls button:last-child {
  border-bottom: 0;
}

.wf-graph__controls button:hover {
  background: color-mix(in srgb, var(--wf-brand) 10%, var(--wf-layer-2));
  color: var(--wf-brand);
}

/* ---- 节点卡片本体（悬停 / 选中 / 高亮 / 虚拟节点 / 锁定） ---- */
.wf-node {
  width: 100%;
  height: 100%;
  padding: 12px 14px;
  border: 1px solid var(--wf-border-strong);
  border-radius: 12px;
  background: color-mix(in srgb, var(--wf-layer) 96%, var(--wf-brand) 4%);
  color: var(--wf-ink);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--wf-ink) 9%, transparent);
  transition: border-color .16s ease, box-shadow .16s ease, transform .16s ease;
  overflow: hidden;
}

.wf-node:hover {
  border-color: color-mix(in srgb, var(--wf-brand) 55%, var(--wf-border-strong));
  box-shadow: 0 12px 30px color-mix(in srgb, var(--wf-ink) 12%, transparent);
}

.wf-node.is-selected {
  border-color: var(--wf-brand);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--wf-brand) 18%, transparent), 0 12px 30px color-mix(in srgb, var(--wf-ink) 12%, transparent);
}

.wf-node.is-highlighted {
  border-color: var(--wf-brand);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--wf-brand) 26%, transparent), 0 0 18px color-mix(in srgb, var(--wf-brand) 30%, transparent);
}

.wf-node.is-proxy {
  border-style: dashed;
  border-color: var(--wf-warn);
}

.wf-node__kind {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--wf-ink-2);
  margin-bottom: 2px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.wf-node__label {
  font-weight: 650;
  font-size: 13px;
  word-break: break-word;
  display: flex;
  align-items: center;
  gap: 6px;
}

.wf-node__proxy-badge {
  flex: none;
  font-size: 9px;
  font-weight: 750;
  color: var(--wf-warn);
  border: 1px solid var(--wf-warn);
  border-radius: 999px;
  padding: 0 5px;
  line-height: 15px;
}

/* 运行中锁定角标（已完成/执行中节点；仅提示不可修改，节点仍可拖动移动） */
.wf-node__lock-badge {
  flex: none;
  font-size: 9px;
  line-height: 14px;
  opacity: .75;
  cursor: help;
}

/* P4 闸门可视化：里程碑闸门用实线强调边框（普通虚拟节点是虚线） */
.wf-node.is-gate {
  border-style: solid;
  border-color: var(--wf-brand);
  box-shadow: 0 0 0 1px var(--wf-brand) inset;
}

.wf-node__proxy-badge.is-gate {
  color: var(--wf-brand);
  border-color: var(--wf-brand);
}

/* P4：父代理补丁改动的节点角标 */
.wf-node__agent-badge {
  flex: none;
  font-size: 9px;
  font-weight: 750;
  color: var(--wf-brand);
  border: 1px solid var(--wf-brand);
  border-radius: 999px;
  padding: 0 5px;
  line-height: 15px;
  opacity: .9;
}

.wf-node.is-locked {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--wf-ink-2) 35%, transparent);
}

.wf-node.is-locked .wf-node__label {
  opacity: .92;
}

.wf-node__prompt {
  margin-top: 5px;
  font-size: 11px;
  color: var(--wf-ink-2);
  white-space: pre-wrap;
  max-height: 34px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

/* 卡片右上角「交换左右连接点」按钮（用户批注：美化布线防交叉；交换后连线端点随之换向） */
.wf-node__swap {
  position: absolute;
  z-index: 5;
  top: 7px;
  right: 8px;
  width: 22px;
  height: 22px;
  min-width: 22px;
  padding: 0;
  border: 1px solid var(--wf-border-strong);
  border-radius: 7px;
  background: var(--wf-layer-2);
  color: var(--wf-ink-2);
  font-size: 13px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-color .14s ease, color .14s ease;
}

.wf-node__swap:hover {
  border-color: var(--wf-brand);
  color: var(--wf-brand);
}

.wf-node__swap.is-active {
  border-color: var(--wf-brand);
  color: var(--wf-brand);
  background: color-mix(in srgb, var(--wf-brand) 10%, var(--wf-layer-2));
}

/* 画布左上角工作流名称角标（用户批注：模板/实例 + 名称；固定不随缩放平移） */
.wf-canvas-caption {
  position: absolute;
  z-index: 7;
  top: 12px;
  left: 14px;
  max-width: 46%;
  padding: 5px 11px;
  border: 1px solid var(--wf-border-strong);
  border-radius: 9px;
  background: var(--wf-layer);
  color: var(--wf-ink-2);
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  box-shadow: 0 6px 16px color-mix(in srgb, var(--wf-ink) 8%, transparent);
}

.wf-canvas-caption strong {
  color: var(--wf-ink);
  font-weight: 720;
}

/* ---- 按节点种类着色（wf-node--<kind>） ---- */
.wf-node--parent .wf-node__kind {
  color: var(--wf-brand);
}

.wf-node--agent .wf-node__kind {
  color: var(--wf-brand);
}

.wf-node--file .wf-node__kind {
  color: var(--wf-ink-2);
}

.wf-node--database .wf-node__kind {
  color: var(--wf-database);
}

.wf-node--start .wf-node__kind {
  color: var(--wf-ok);
}

.wf-node--end .wf-node__kind {
  color: var(--wf-err);
}

.wf-node--pause .wf-node__kind {
  color: var(--wf-warn);
}

.wf-node--group .wf-node__kind {
  color: var(--wf-warn);
}

/* ---- 协作组卡片 ---- */
.wf-node--group {
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
}

.wf-group-node {
  width: 300px;
  height: 220px;
}

/* 拖拽悬停入组高亮（用户验收标注：卡片插入协作组卡片区域即识别为入组） */
.wf-group-node.is-drop-target .wf-node--group {
  border-color: var(--wf-pass);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--wf-pass) 26%, transparent), 0 0 22px color-mix(in srgb, var(--wf-pass) 32%, transparent);
}

.wf-group__drop-hint {
  flex: none;
  margin: 6px 0 2px;
  padding: 4px 8px;
  border: 1px dashed var(--wf-pass);
  border-radius: 8px;
  color: var(--wf-pass);
  font-size: 10px;
  font-weight: 700;
  text-align: center;
  pointer-events: none;
}

/* 已选文件列表（文件表单，按钮下方显示；用户验收标注） */
.wf-file-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--wf-border);
  border-radius: 8px;
  background: var(--wf-layer-2);
  max-height: 120px;
  overflow: auto;
  scrollbar-width: thin;
}

.wf-file-chip {
  display: block;
  font-size: 11px;
  color: var(--wf-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 2px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--wf-brand) 8%, transparent);
}

/* ---- 协作组成员列表（缩小版角色卡） ---- */
.wf-group__members {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-top: 6px;
  padding: 6px;
  border: 1px solid var(--wf-border);
  border-radius: 8px;
  background: var(--wf-layer-2);
  scrollbar-width: thin;
}

/* 组内成员 = 缩小版角色卡：仅名称+状态，数据库/上下文接点，无流程接点（用户批注 Q2） */
.wf-group__member {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  border: 1px solid var(--wf-border-strong);
  border-radius: 8px;
  background: color-mix(in srgb, var(--wf-layer) 90%, var(--wf-brand) 10%);
  color: var(--wf-ink);
  padding: 6px 10px;
  font-size: 11px;
  text-align: left;
  box-shadow: 0 2px 6px color-mix(in srgb, var(--wf-ink) 8%, transparent);
  transition: border-color .16s ease, box-shadow .16s ease;
}

.wf-group__member:hover {
  border-color: color-mix(in srgb, var(--wf-brand) 55%, var(--wf-border-strong));
  box-shadow: 0 2px 10px color-mix(in srgb, var(--wf-ink) 12%, transparent);
}

.wf-graph__handle--mini {
  width: 9px;
  height: 9px;
  border-width: 1px;
}

.wf-graph__handle--mini:hover {
  transform: translateY(-50%) scale(1.25);
}

.wf-group__member-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 650;
}

.wf-group__member-status {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: none;
  font-size: 10px;
  color: var(--wf-ink-2);
  padding: 1px 6px;
  border: 1px solid var(--wf-border-strong);
  border-radius: 6px;
  background: color-mix(in srgb, var(--wf-layer) 92%, var(--wf-ink) 8%);
}

.wf-group__resize {
  position: absolute;
  z-index: 6;
  right: -4px;
  bottom: -4px;
  width: 14px;
  height: 14px;
  border-right: 3px solid var(--wf-border-strong);
  border-bottom: 3px solid var(--wf-border-strong);
  border-radius: 0 0 6px 0;
  cursor: nwse-resize;
}

.wf-group__resize:hover {
  border-color: var(--wf-brand);
}

/* ---- 画布空态提示 ---- */
.wf-canvas-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: none;
}

.wf-canvas-empty__hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--wf-ink-2);
  font-size: 12px;
  text-align: center;
  opacity: .85;
}

.wf-canvas-empty__icon {
  width: 52px;
  height: 52px;
  border: 1px dashed var(--wf-border-strong);
  border-radius: 16px;
  display: grid;
  place-items: center;
  font-size: 22px;
  color: var(--wf-brand);
}
`
