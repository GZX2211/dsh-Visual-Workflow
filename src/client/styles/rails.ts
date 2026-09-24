// src/client/styles/rails.ts
//
// 侧栏与底栏域。左侧资源树（分组 / 条目 / 徽标）、左栏标签页、底栏（Tag 区与横向卡片）、分隔条、拖拽预览浮标。
// 注意：底栏上边界拖动线（.wf-splitter--horizontal）在这里，竖向基类在 inspector.ts。
//
// 本文件内规则顺序即覆盖顺序（同特异性下后写的覆盖先写的），禁止重排。

export const railsStyles = `
/* ---- 左侧资源树容器 ---- */
.wf-docrail {
  flex: none;
  width: auto;
  display: flex;
  flex-direction: column;
  background: var(--wf-layer);
  min-height: 0;
  overflow: hidden;
}

.wf-docrail.is-collapsed {
  visibility: hidden;
  pointer-events: none;
  width: 0;
}

.wf-docrail__list {
  flex: 1 1 0;
  height: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 9px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  scrollbar-width: thin;
}

/* ---- 左栏标签页 ---- */
.wf-lib-tabs {
  flex: none;
  display: flex;
  gap: 4px;
  padding: 8px 10px 0;
  border-bottom: 1px solid var(--wf-border);
}

.wf-lib-tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 0;
  border-radius: 9px 9px 0 0;
  background: transparent;
  color: var(--wf-ink-2);
  padding: 7px 4px;
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
}

.wf-lib-tab:hover {
  color: var(--wf-ink);
  background: color-mix(in srgb, var(--wf-brand) 6%, transparent);
}

.wf-lib-tab.is-active {
  color: var(--wf-brand);
  background: color-mix(in srgb, var(--wf-brand) 10%, transparent);
  box-shadow: inset 0 -2px 0 var(--wf-brand);
}

/* ---- 底栏（新增；与左栏相互切换；卡片横向 flex-wrap 动态追加排） ---- */
.wf-bottom-area {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.wf-bottombar {
  flex: none;
  display: flex;
  flex-direction: row;
  background: var(--wf-layer);
  border-top: 1px solid var(--wf-border);
  min-height: 0;
  overflow: hidden;
}

.wf-bottombar.is-collapsed {
  visibility: hidden;
  pointer-events: none;
  height: 0;
}

/* Tag 区：位于底栏【左侧】（竖向排布），但每个 Tag 文字是【横向】的（工作流/角色/数据/其他），不显示图标 */
.wf-bottombar__tags {
  flex: none;
  width: 88px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  padding: 8px 6px;
  border-right: 1px solid var(--wf-border);
}

.wf-bottombar__tag {
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--wf-ink-2);
  padding: 7px 8px;
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
  white-space: nowrap;
  text-align: center;
}

.wf-bottombar__tag:hover {
  color: var(--wf-ink);
  background: color-mix(in srgb, var(--wf-brand) 6%, transparent);
}

.wf-bottombar__tag.is-active {
  color: var(--wf-brand);
  background: color-mix(in srgb, var(--wf-brand) 10%, transparent);
  border-color: color-mix(in srgb, var(--wf-brand) 45%, var(--wf-border));
}

.wf-bottombar__scroll {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  scrollbar-width: thin;
}

.wf-bottombar__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wf-bottombar__group {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--wf-ink-2);
}

.wf-bottombar__group-title {
  flex: none;
  white-space: nowrap;
}

.wf-bottombar__cards {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-content: flex-start;
}

/* 底栏卡片：只显示名称（图片批注：不再显示描述和其他内容，包括图标） */
.wf-hcard {
  max-width: 180px;
  min-width: 96px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--wf-border);
  border-radius: 8px;
  background: var(--wf-layer-2);
  color: var(--wf-ink);
  font-size: 11px;
  font-weight: 650;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: grab;
  touch-action: none;
  transition: border-color .14s ease, background .14s ease;
}

.wf-hcard:hover {
  border-color: color-mix(in srgb, var(--wf-brand) 55%, var(--wf-border-strong));
}

.wf-hcard.is-active {
  border-color: color-mix(in srgb, var(--wf-brand) 45%, var(--wf-border));
  background: color-mix(in srgb, var(--wf-brand) 12%, var(--wf-layer));
  color: var(--wf-brand);
}

.wf-hcard__name {
  display: block;
  width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 底栏上边界拖动线（水平、位于底栏顶部，上下调整大小；图片批注：边界线同样可拖动）。
   双类选择器覆盖 .wf-splitter 的竖向默认（width:9px/col-resize），确保为横向。 */
.wf-splitter.wf-splitter--horizontal {
  position: relative;
  z-index: 12;
  flex: none;
  min-width: 0;
  width: auto;
  min-height: 8px;
  height: 8px;
  cursor: row-resize;
  touch-action: none;
  background: var(--wf-layer-2);
  outline: 0;
  border-top: 1px solid var(--wf-border);
}

.wf-splitter.wf-splitter--horizontal::before {
  content: "";
  position: absolute;
  inset: 3px 0;
  background: var(--wf-border);
}

.wf-splitter.wf-splitter--horizontal:hover::before,
.wf-splitter.wf-splitter--horizontal:focus-visible::before,
.wf-splitter.wf-splitter--horizontal.is-dragging::before {
  inset: 2px 0;
  background: var(--wf-brand);
}

/* ---- 资源条目（分组 / 条目 / 徽标） ---- */
.wf-docgroup {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 7px 2px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--wf-ink-2);
}

.wf-docgroup__add {
  width: 20px;
  height: 20px;
  min-width: 20px;
  border: 1px solid var(--wf-border-strong);
  border-radius: 6px;
  background: transparent;
  color: var(--wf-ink-2);
  font-size: 13px;
  line-height: 0;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.wf-docgroup__add:hover {
  border-color: var(--wf-brand);
  color: var(--wf-brand);
}

.wf-docitem {
  width: 100%;
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  gap: 9px;
  align-items: center;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  color: var(--wf-ink);
  padding: 8px;
  cursor: grab;
  touch-action: none;
}

.wf-docitem:hover {
  background: var(--wf-layer-2);
  border-color: var(--wf-border);
}

.wf-docitem.is-active {
  background: color-mix(in srgb, var(--wf-brand) 10%, var(--wf-layer));
  border-color: color-mix(in srgb, var(--wf-brand) 45%, var(--wf-border));
  color: var(--wf-brand);
}

.wf-docitem.is-pinned {
  background: color-mix(in srgb, var(--wf-brand) 6%, var(--wf-layer));
  border-color: color-mix(in srgb, var(--wf-brand) 28%, var(--wf-border));
}

.wf-docitem__icon {
  width: 26px;
  height: 30px;
  border: 1px solid currentColor;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 800;
  opacity: .76;
}

.wf-docitem__texts {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.wf-docitem__title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.wf-docitem__title-row .wf-docitem__label {
  flex: 0 1 auto;
  min-width: 0;
}

.wf-docitem__title-row .wf-docitem__badge {
  flex: none;
  margin-left: 0;
}

.wf-docitem__label {
  display: block;
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wf-docitem__path {
  display: block;
  font: 9px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--wf-ink-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wf-docitem__badge {
  justify-self: end;
  white-space: nowrap;
  font-size: 10px;
  font-weight: 700;
  color: var(--wf-ok);
  border: 1px solid color-mix(in srgb, var(--wf-ok) 40%, var(--wf-border));
  border-radius: 6px;
  padding: 2px 7px;
  background: color-mix(in srgb, var(--wf-ok) 12%, transparent);
}

/* 工作台全局化：「当前」徽标（当前主会话对应的实例；品牌色以区分普通状态徽标） */
.wf-docitem__badge.is-current {
  color: var(--wf-brand);
  border-color: color-mix(in srgb, var(--wf-brand) 45%, var(--wf-border));
  background: color-mix(in srgb, var(--wf-brand) 12%, transparent);
}

/* ---- 拖拽预览浮标 ---- */
.wf-drag-preview {
  position: fixed;
  z-index: 999;
  pointer-events: none;
  min-width: 150px;
  max-width: 230px;
  padding: 9px 12px;
  border: 1px solid var(--wf-brand);
  border-radius: 10px;
  background: color-mix(in srgb, var(--wf-layer) 94%, var(--wf-brand) 6%);
  color: var(--wf-ink);
  font-size: 12px;
  font-weight: 650;
  box-shadow: 0 14px 34px color-mix(in srgb, var(--wf-ink) 22%, transparent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
`
