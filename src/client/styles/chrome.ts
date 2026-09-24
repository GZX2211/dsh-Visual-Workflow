// src/client/styles/chrome.ts
//
// 顶栏与骨架。工作台根容器、顶部标签栏（标题 / 模式徽标 / 说明 / 模式菜单）与主区容器。
//
// 本文件内规则顺序即覆盖顺序（同特异性下后写的覆盖先写的），禁止重排。

export const chromeStyles = `
/* ---- 工作台骨架：根容器与全局字体 ---- */
.wf-root {
  position: relative;
  inset: auto;
  width: 100%;
  height: 100%;
  max-height: 100vh;
  min-height: 0;
  display: grid;
  grid-template-rows: 48px minmax(0, 1fr) auto;
  background: var(--wf-bg);
  color: var(--wf-ink);
  font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  overflow: hidden;
}

.wf-root * {
  box-sizing: border-box;
}

.wf-root button,
.wf-root input,
.wf-root select,
.wf-root textarea {
  font: inherit;
}

.wf-root button {
  cursor: pointer;
}

/* ---- 顶栏标签栏（标题 / 徽标 / 说明） ---- */
.wf-tabs {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px;
  background: var(--wf-layer);
  border-bottom: 1px solid var(--wf-border);
  flex: none;
  min-width: 0;
}

.wf-titlebar__title {
  font-size: 14px;
  font-weight: 720;
  color: var(--wf-ink);
  white-space: nowrap;
}

.wf-titlebar__badge {
  padding: 3px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--wf-brand) 10%, transparent);
  color: var(--wf-brand);
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}

.wf-titlebar__note {
  color: var(--wf-ink-2);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wf-titlebar__spacer {
  margin-left: auto;
  flex: 1;
}

.wf-titlebar__mode {
  position: relative;
  flex: none;
}

.wf-titlebar__caret {
  margin-left: 4px;
  font-size: 9px;
  color: var(--wf-ink-2);
}

/* ---- 顶栏模式菜单 ---- */
.wf-mode-menu {
  position: absolute;
  z-index: 60;
  right: 0;
  top: calc(100% + 6px);
  min-width: 170px;
  padding: 6px;
  border: 1px solid var(--wf-border-strong);
  border-radius: 10px;
  background: var(--wf-layer);
  box-shadow: 0 14px 34px color-mix(in srgb, var(--wf-ink) 22%, transparent);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wf-mode-menu__item {
  text-align: left;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--wf-ink);
  padding: 7px 10px;
  font-size: 12px;
}

.wf-mode-menu__item:hover {
  background: color-mix(in srgb, var(--wf-brand) 10%, var(--wf-layer));
  color: var(--wf-brand);
}

/* ---- 主区容器（左右栏 + 画布） ---- */
.wf-main {
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  display: flex;
}
`
