// src/client/styles/combo.ts
//
// 组合管理域。工具 / MCP 组合弹层：容器与搜索、标签筛选、目录卡片网格、右侧详情与编辑、MCP 表单、对话框变体。
//
// 本文件内规则顺序即覆盖顺序（同特异性下后写的覆盖先写的），禁止重排。

export const comboStyles = `
/* ---- 弹层容器与搜索 / 标签筛选 ---- */
.wf-combo-backdrop {
  position: absolute;
  z-index: 35;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 16px;
  background: color-mix(in srgb, var(--wf-bg) 72%, transparent);
  backdrop-filter: blur(4px);
}

.wf-combo {
  width: min(1080px, 94%);
  height: min(92%, 760px);
  max-height: 92%;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--wf-border-strong);
  border-radius: 14px;
  background: var(--wf-layer);
  box-shadow: 0 20px 60px color-mix(in srgb, var(--wf-ink) 18%, transparent);
  overflow: hidden;
}

.wf-combo__search {
  flex: none;
  padding: 8px 12px 0;
}

.wf-combo__search input {
  width: 100%;
  border: 1px solid var(--wf-border-strong);
  border-radius: 8px;
  background: var(--wf-layer-2);
  color: var(--wf-ink);
  padding: 7px 10px;
  outline: 0;
}

.wf-combo__search input:focus {
  border-color: var(--wf-brand);
}

.wf-combo__tags {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 8px 12px 0;
}

.wf-combo-tag {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border: 1px solid var(--wf-border);
  border-radius: 999px;
  background: var(--wf-layer-2);
  color: var(--wf-ink-2);
  font-size: 10px;
  cursor: pointer;
  transition: border-color .14s ease, background .14s ease, color .14s ease;
}

.wf-combo-tag:hover {
  border-color: var(--wf-brand);
  color: var(--wf-ink);
}

.wf-combo-tag.is-active {
  border-color: var(--wf-brand);
  background: color-mix(in srgb, var(--wf-brand) 12%, var(--wf-layer-2));
  color: var(--wf-brand);
}

.wf-combo-tag__bulk {
  margin-left: auto;
  border-color: var(--wf-border-strong);
  background: color-mix(in srgb, var(--wf-brand) 8%, var(--wf-layer-2));
  color: var(--wf-ink);
  font-weight: 650;
}

.wf-combo-tag__bulk:hover {
  border-color: var(--wf-brand);
  color: var(--wf-brand);
}

.wf-combo-tag__bulk:disabled {
  opacity: .45;
  cursor: default;
}

/* ---- 弹层头部 ---- */
.wf-combo__head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--wf-border);
}

.wf-combo__head h3 {
  margin: 0;
  font-size: 14px;
  color: var(--wf-ink);
  flex: none;
}

.wf-combo__head .wf-status {
  margin-left: 0;
}

.wf-combo__close {
  margin-left: auto;
}

/* ---- 目录区（标签页 + 卡片网格） ---- */
.wf-combo__body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.wf-combo__catalog {
  flex: 1.35;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--wf-border);
  overflow: hidden;
  position: relative;
  z-index: 2;
}

.wf-combo__tabs {
  flex: none;
  display: flex;
  gap: 4px;
  padding: 8px 10px 0;
  border-bottom: 1px solid var(--wf-border);
}

.wf-combo__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  border-radius: 9px 9px 0 0;
  background: transparent;
  color: var(--wf-ink-2);
  padding: 7px 12px;
  font-size: 11px;
  font-weight: 650;
  cursor: pointer;
}

.wf-combo__tab:hover {
  color: var(--wf-ink);
}

.wf-combo__tab.is-active {
  color: var(--wf-brand);
  background: color-mix(in srgb, var(--wf-brand) 10%, transparent);
  box-shadow: inset 0 -2px 0 var(--wf-brand);
}

.wf-combo__tab-count {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--wf-layer-2);
  font-size: 9px;
  color: var(--wf-ink-2);
}

.wf-combo__grid {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(228px, 1fr));
  gap: 8px;
  align-content: start;
  padding: 12px;
  scrollbar-width: thin;
}

.wf-combo-card {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  text-align: left;
  border: 1px solid var(--wf-border);
  border-radius: 11px;
  background: var(--wf-layer-2);
  padding: 10px 11px;
  cursor: pointer;
  transition: border-color .14s ease, background .14s ease;
  min-height: 96px;
}

.wf-combo-card:hover {
  border-color: var(--wf-brand);
}

.wf-combo-card.is-checked {
  border-color: var(--wf-brand);
  background: color-mix(in srgb, var(--wf-brand) 8%, var(--wf-layer-2));
}

.wf-combo-card.is-disabled {
  opacity: .55;
  cursor: default;
  border-style: dashed;
}

.wf-combo-card.is-disabled .wf-combo-card__name {
  color: var(--wf-ink-2);
}

.wf-combo-card input {
  flex: none;
  margin-top: 2px;
  accent-color: var(--wf-brand);
}

/* 卡片主区（点击勾选）与右下角操作区：此前为内联 style，现按语义类名表达 */
.wf-combo-card {
  position: relative;
}

.wf-combo-card__main {
  display: flex;
  gap: 9px;
  align-items: flex-start;
  text-align: left;
  border: 0;
  background: transparent;
  padding: 0 88px 30px 0;
  flex: 1;
  cursor: pointer;
}

.wf-combo-card__main:disabled {
  cursor: default;
}

.wf-combo-card__actions {
  display: flex;
  gap: 4px;
  position: absolute;
  right: 8px;
  bottom: 8px;
}

.wf-combo__grid-empty {
  grid-column: 1 / -1;
  padding: 14px;
}

.wf-combo-card__body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.wf-combo-card__name {
  font-size: 12px;
  font-weight: 650;
  color: var(--wf-ink);
  word-break: break-all;
}

.wf-combo-card__desc {
  font-size: 10px;
  line-height: 1.45;
  color: var(--wf-ink-2);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.wf-combo-card__badge {
  display: inline-block;
  align-self: flex-start;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--wf-layer);
  border: 1px solid var(--wf-border);
  font-size: 8px;
  color: var(--wf-ink-2);
}

/* ---- 右侧详情栏（条目列表 / 编辑 / 已选清单） ---- */
.wf-combo__side {
  flex: 1;
  min-width: 290px;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.wf-combo__side-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--wf-border);
}

.wf-combo__side-head h4 {
  margin: 0;
  font-size: 12px;
  color: var(--wf-ink);
  flex: 1;
}

.wf-combo__side-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 14px;
  scrollbar-width: thin;
}

.wf-combo-item {
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  border: 1px solid var(--wf-border);
  border-radius: 10px;
  background: var(--wf-layer-2);
  padding: 8px 10px;
  cursor: pointer;
}

.wf-combo-item:hover {
  border-color: var(--wf-brand);
}

.wf-combo-item.is-active {
  border-color: var(--wf-brand);
  background: color-mix(in srgb, var(--wf-brand) 8%, var(--wf-layer-2));
}

.wf-combo-item__label {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 650;
  color: var(--wf-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wf-combo-item__meta {
  font-size: 9px;
  color: var(--wf-ink-2);
}

.wf-combo__edit {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid var(--wf-border);
}

.wf-combo__edit label {
  display: grid;
  gap: 4px;
  color: var(--wf-ink-2);
  font-size: 11px;
}

.wf-combo__edit input {
  border: 1px solid var(--wf-border-strong);
  border-radius: 7px;
  background: var(--wf-layer-2);
  color: var(--wf-ink);
  padding: 6px 8px;
  outline: 0;
}

.wf-combo__edit input:focus {
  border-color: var(--wf-brand);
}

.wf-combo__selection {
  flex: none;
  max-height: 120px;
  overflow: auto;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 8px 14px;
  border-top: 1px solid var(--wf-border);
  scrollbar-width: thin;
}

.wf-combo-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wf-brand) 10%, var(--wf-layer-2));
  border: 1px solid color-mix(in srgb, var(--wf-brand) 35%, var(--wf-border));
  font-size: 10px;
  color: var(--wf-ink);
}

.wf-combo-chip button {
  border: 0;
  background: transparent;
  color: var(--wf-ink-2);
  cursor: pointer;
  font-size: 10px;
  line-height: 1;
  padding: 0;
}

.wf-combo-chip button:hover {
  color: var(--wf-err);
}

.wf-combo__side-foot {
  flex: none;
  display: flex;
  gap: 7px;
  padding: 10px 14px;
  border-top: 1px solid var(--wf-border);
}

.wf-combo__side-foot .wf-btn {
  flex: 1;
  font-size: 11px;
  padding: 6px 10px;
}

/* ---- MCP 表单 ---- */
.wf-mcp-form {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid var(--wf-border);
}

.wf-mcp-form label {
  display: grid;
  gap: 4px;
  color: var(--wf-ink-2);
  font-size: 11px;
}

.wf-mcp-form input {
  width: 100%;
  border: 1px solid var(--wf-border-strong);
  border-radius: 7px;
  background: var(--wf-layer-2);
  color: var(--wf-ink);
  padding: 6px 8px;
  outline: 0;
}

.wf-mcp-form input:focus {
  border-color: var(--wf-brand);
}

.wf-mcp-form__row {
  display: flex;
  gap: 6px;
}

.wf-mcp-form__row .wf-btn {
  flex: 1;
  font-size: 11px;
  padding: 6px 10px;
}

/* MCP 表单内联行 / 堆叠区（此前为内联 style） */
.wf-mcp-form__inline {
  display: flex;
  gap: 8px;
  padding: 0 14px 12px;
}

.wf-mcp-form__grow {
  flex: 1;
}

.wf-mcp-form__stack {
  display: grid;
  gap: 8px;
  padding: 0 14px 12px;
}

.wf-mcp-form__note {
  align-self: center;
  flex: 1;
}

.wf-combo__head--sub {
  border-top: 1px solid var(--wf-border);
  padding: 8px 14px;
}

.wf-mcp-import__body {
  padding: 0 14px 12px;
  display: grid;
  gap: 8px;
}

.wf-mcp-import__text {
  min-height: 150px;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid var(--wf-border-strong);
  background: var(--wf-layer-2);
  color: var(--wf-ink);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

/* ---- 弹层变体（对话框 / 提示行） ---- */
.wf-combo--dialog {
  max-width: 560px;
  height: auto;
  max-height: 82%;
}

.wf-hint--block {
  font-size: 10px;
  line-height: 1.5;
  color: var(--wf-ink-2);
}

.wf-combo-hint {
  flex: none;
  padding: 8px 14px;
  border-top: 1px solid var(--wf-border);
  font-size: 10px;
  color: var(--wf-ink-2);
  line-height: 1.5;
}
`
