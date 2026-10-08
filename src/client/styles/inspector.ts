// src/client/styles/inspector.ts
//
// 属性栏域。属性栏容器与表单控件、字段与表单行布局（各表单共用）、复选清单、提示与高级折叠、路径展示、图标按钮与竖向分隔条。
// 注意：表单布局类由各表单组件共用，改动会影响全部属性栏表单。
//
// 本文件内规则顺序即覆盖顺序（同特异性下后写的覆盖先写的），禁止重排。

export const inspectorStyles = `
/* ---- 属性栏容器与控件 ---- */
.wf-inspector {
  flex: none;
  width: auto;
  height: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--wf-layer);
  overflow: hidden;
  min-height: 0;
}

.wf-inspector__scroll {
  flex: 1 1 0;
  height: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 15px;
  display: flex;
  flex-direction: column;
  gap: 11px;
  scrollbar-width: thin;
}

.wf-inspector__scroll>* {
  flex-shrink: 0;
}

.wf-inspector.is-collapsed {
  visibility: hidden;
  pointer-events: none;
  padding: 0;
  width: 0 !important;
}

.wf-inspector h3 {
  margin: 0;
  font-size: 14px;
  color: var(--wf-ink);
}

.wf-inspector label {
  display: grid;
  gap: 4px;
  color: var(--wf-ink-2);
  font-size: 12px;
}

.wf-inspector input,
.wf-inspector select,
.wf-inspector textarea {
  width: 100%;
  border: 1px solid var(--wf-border-strong);
  border-radius: 7px;
  background: var(--wf-layer-2);
  color: var(--wf-ink);
  padding: 6px 8px;
  outline: 0;
}

.wf-inspector input:focus,
.wf-inspector select:focus,
.wf-inspector textarea:focus {
  border-color: var(--wf-brand);
}

.wf-inspector textarea {
  min-height: 92px;
  resize: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  line-height: 1.55;
}

.wf-inspector__footer {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 14px;
  border-top: 1px solid var(--wf-border);
  background: var(--wf-layer);
}

.wf-inspector__footer .wf-btn {
  font-size: 11px;
  padding: 5px 11px;
}

/* ---- 资产版本上拉列表（底部「回滚」按钮展开） ---- */
.wf-asset-versions__backdrop {
  position: fixed;
  inset: 0;
  z-index: 30;
}

.wf-asset-versions {
  position: absolute;
  z-index: 31;
  left: 10px;
  right: 10px;
  bottom: 100%;
  margin-bottom: 6px;
  max-height: 240px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 10px;
  border: 1px solid var(--wf-border-strong);
  border-radius: 9px;
  background: var(--wf-layer-2);
  box-shadow: 0 12px 30px color-mix(in srgb, var(--wf-ink) 12%, transparent);
  scrollbar-width: thin;
}

.wf-asset-versions__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.wf-asset-versions__title {
  font-size: 11px;
  font-weight: 650;
  color: var(--wf-ink);
}

.wf-asset-versions__hint {
  color: var(--wf-ink-2);
  font-size: 11px;
}

.wf-asset-versions__list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wf-asset-versions__item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  text-align: left;
  border: 1px solid var(--wf-border);
  border-radius: 7px;
  background: var(--wf-layer);
  color: var(--wf-ink);
  font-size: 11px;
  padding: 5px 8px;
  cursor: pointer;
}

.wf-asset-versions__item:hover {
  border-color: var(--wf-brand);
}

.wf-asset-versions__item.is-active {
  border-color: var(--wf-brand);
}

.wf-asset-versions__version {
  flex: none;
  font-weight: 650;
  color: var(--wf-brand);
}

.wf-asset-versions__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-asset-versions__meta {
  flex: none;
  color: var(--wf-ink-2);
}

.wf-asset-versions__badge {
  flex: none;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid var(--wf-brand);
  color: var(--wf-brand);
  font-size: 9px;
}

.wf-inspector .wf-empty {
  color: var(--wf-ink-2);
  font-size: 12px;
}

.wf-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

/* 字段与表单行布局（属性栏表单共用；此前散落在各表单的内联 style） */
.wf-field--gap6 {
  gap: 6px;
}

.wf-form-stack {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 只读统计清单（经验「长期统计」区）：标签 + 数值两列，无控件外观——
   与可编辑字段在视觉上区分（编辑区沿用 .wf-field 的输入控件样式）。 */
.wf-stat-list {
  display: grid;
  gap: 4px;
  margin: 0;
}

.wf-stat {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.wf-stat__label {
  color: var(--wf-ink-2);
  font-size: 11px;
}

.wf-stat__value {
  margin: 0;
  color: var(--wf-ink);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.wf-form-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.wf-form-grid-1 {
  display: grid;
  gap: 8px;
}

.wf-form-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.wf-form-grid-wide {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 8px;
}

.wf-form-preline {
  white-space: pre-line;
}

.wf-form-check {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-start;
}

/* 复选框需覆盖 .wf-inspector input{width:100%}（否则被撑成大方框、不贴边） */
.wf-inspector .wf-form-check__box {
  width: auto;
  flex: 0 0 auto;
  padding: 0;
  margin: 0;
  min-width: 0;
  accent-color: var(--wf-brand);
}

/* ---- 复选清单 / 提示 / 高级折叠 / 路径展示 ---- */
.wf-check-list__row {
  justify-content: space-between;
}

.wf-btn--xs {
  font-size: 9px;
  padding: 2px 6px;
}

.wf-check-list {
  max-height: 190px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border: 1px solid var(--wf-border);
  border-radius: 8px;
  background: var(--wf-layer-2);
  scrollbar-width: thin;
}

.wf-check-list label {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--wf-ink);
  font-size: 11px;
}

.wf-hint {
  color: var(--wf-ink-2);
  font-size: 11px;
}

.wf-advanced {
  border: 1px solid var(--wf-border);
  border-radius: 9px;
  background: var(--wf-layer-2);
  padding: 0 9px;
  margin: 12px 0 0;
}

.wf-advanced summary {
  cursor: pointer;
  padding: 8px 0;
  color: var(--wf-ink-2);
  font-size: 11px;
  font-weight: 650;
}

.wf-advanced__content {
  display: grid;
  gap: 9px;
  padding: 0 0 10px;
}

.wf-pathbox {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 10px;
  border: 1px solid var(--wf-border);
  border-radius: 9px;
  background: var(--wf-layer-2);
}

.wf-pathbox__label {
  font-size: 10px;
  color: var(--wf-ink-2);
}

.wf-pathbox__value {
  font: 10px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--wf-ink);
  word-break: break-all;
}

/* ---- 图标按钮与竖向分隔条 ---- */
.wf-iconbtn {
  width: 32px;
  height: 32px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}

.wf-splitter {
  position: relative;
  z-index: 12;
  flex: none;
  min-width: 9px;
  width: 9px;
  cursor: col-resize;
  touch-action: none;
  background: var(--wf-layer);
  outline: 0;
}

.wf-splitter::before {
  content: "";
  position: absolute;
  inset: 0 3px;
  background: var(--wf-border);
}

.wf-splitter:hover::before,
.wf-splitter:focus-visible::before,
.wf-splitter.is-dragging::before {
  inset: 0 2px;
  background: var(--wf-brand);
}
`
