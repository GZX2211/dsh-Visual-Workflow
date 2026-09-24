// src/client/styles/toolbar.ts
//
// 工具栏与通用控件。工具栏布局、通用按钮 .wf-btn 及其变体、右侧状态文案。
//
// 本文件内规则顺序即覆盖顺序（同特异性下后写的覆盖先写的），禁止重排。

export const toolbarStyles = `
/* ---- 工具栏 ---- */
.wf-toolbar {
  flex: none;
  height: 52px;
  min-height: 52px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--wf-layer);
  border-bottom: 1px solid var(--wf-border);
  flex-wrap: nowrap;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}

.wf-toolbar>* {
  flex: none;
}

.wf-toolbar__switch {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--wf-ink-2);
  font-size: 10px;
  cursor: pointer;
  white-space: nowrap;
}

.wf-toolbar__switch input {
  width: auto;
  flex: 0 0 auto;
  min-width: 0;
  margin: 0;
  accent-color: var(--wf-brand);
  cursor: pointer;
}

.wf-toolbar__workspace {
  width: 200px;
  border: 1px solid var(--wf-border-strong);
  border-radius: 7px;
  background: var(--wf-layer-2);
  color: var(--wf-ink);
  padding: 5px 8px;
  font-size: 10px;
  outline: 0;
}

.wf-toolbar__workspace:focus {
  border-color: var(--wf-brand);
}

/* 顶部一键折叠/展开两侧按钮（批注：折叠时图标泛品牌色，提示当前可展开） */
.wf-toolbar__panels svg {
  color: var(--wf-ink-2);
}

.wf-toolbar__panels.is-collapsed {
  border-color: color-mix(in srgb, var(--wf-brand) 45%, var(--wf-border-strong));
}

.wf-toolbar__panels.is-collapsed svg {
  color: var(--wf-brand);
}

/* ---- 通用按钮（主 / 危险 / 幽灵 / 禁用） ---- */
.wf-btn {
  border: 1px solid var(--wf-border-strong);
  border-radius: 8px;
  background: var(--wf-layer-2);
  color: var(--wf-ink);
  padding: 6px 11px;
  transition: border-color .15s ease, transform .15s ease, background .15s ease;
  white-space: nowrap;
}

.wf-btn:hover {
  border-color: var(--wf-brand);
  transform: translateY(-1px);
}

/* 主按钮：采用 DSH 官方主按钮语义（--dsw-alias-button-primary-fill 与
   --dsw-alias-label-primary-foreground）：深色主题=浅底深字、浅色主题=深底白字，
   无论主题如何都保持文字可见（此前 fallback #fff 在深色主题浅底上白字不可见） */
.wf-btn.is-primary {
  border-color: var(--dsw-alias-button-primary-fill, var(--wf-brand));
  background: var(--dsw-alias-button-primary-fill, var(--wf-brand));
  color: var(--dsw-alias-label-primary-foreground, var(--wf-bg));
  font-weight: 650;
}

.wf-btn.is-primary:hover {
  border-color: var(--dsw-alias-button-primary-hover, var(--wf-brand));
}

.wf-btn.is-danger {
  border-color: color-mix(in srgb, var(--wf-err) 55%, var(--wf-border-strong));
  color: var(--wf-err);
}

.wf-btn.is-danger:hover {
  border-color: var(--wf-err);
}

.wf-btn.is-ghost {
  background: transparent;
}

.wf-btn:disabled {
  opacity: .5;
  cursor: default;
}

/* ---- 工具栏右侧状态文案 ---- */
.wf-status {
  color: var(--wf-ink-2);
  font-size: 12px;
  margin-left: auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 38%;
}

.wf-status.is-running {
  color: var(--wf-ok);
}
`
