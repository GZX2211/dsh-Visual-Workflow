// src/client/styles/sidebar-entry.ts
//
// 宿主接入：官方侧边栏入口按钮。官方 sidebar.footer.action 插槽的「工作流」入口按钮（展开态 / 折叠态 / 焦点环重置）。
// 注意：选择器写 *.wf-sidebar-entry 以压过官方按钮样式，勿改成单类。
//
// 本文件内规则顺序即覆盖顺序（同特异性下后写的覆盖先写的），禁止重排。

export const sidebarEntryStyles = `
/* ---- 官方侧边栏入口按钮（sidebar.footer.action 插槽） ----
   迁移（0.1.5-rc.1）：入口按钮不再由 MutationObserver 注入到官方「设置」按钮上方，而是注册进
   官方 sidebar.footer.action 插槽。官方 DOM 结构（dsh-client-ui-sidebar 取证）：
     div.footArea（纵向 column）
       ├ div.footerActions（flex 横向行，width:100%） ← 本按钮在此
       └ div.settingsArea
   折叠态官方给 footerActions 加 justify-content:center（width:auto），故此处保持 width:100%，
   折叠类 wf-sidebar-entry--rail 改为固定方形图标即可与官方「设置」按钮同级视觉。
   样式取自官方「设置」按钮（dsh-client-ui-settings-general 的 trigger）：*.wf-sidebar-entry 前缀
   提高特异性（0,1,1），并显式 appearance:none / border:none / box-shadow:none 重置浏览器默认外观。 */
button.wf-sidebar-entry {
  box-sizing: border-box;
  cursor: pointer;
  width: 100%;
  min-width: 0;
  height: 42px;
  color: var(--dsw-alias-label-primary);
  background: 0 0;
  border: none;
  border-radius: 12px;
  box-shadow: none;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 0 10px 0 8px;
  font-family: inherit;
  font-size: 14px;
  line-height: 22px;
  display: flex;
  overflow: hidden;
  -webkit-appearance: none;
  appearance: none;
}

button.wf-sidebar-entry:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}

.wf-sidebar-entry__label {
  white-space: nowrap;
  overflow: hidden;
}

button.wf-sidebar-entry--rail {
  corner-shape: round;
  border-radius: 50%;
  width: 36px;
  height: 36px;
  justify-content: center;
  gap: 0;
  margin: 0;
  padding: 0;
}

.wf-sidebar-entry--rail .wf-sidebar-entry__label {
  display: none;
}

/* 清除聚焦/点击后的发光焦点环（含默认浏览器/主题 focus 圈），保持与设置按钮一致 */
button.wf-sidebar-entry:focus,
button.wf-sidebar-entry:focus-visible,
button.wf-sidebar-entry:active {
  outline: none;
  box-shadow: none;
  -webkit-tap-highlight-color: transparent;
}
`
