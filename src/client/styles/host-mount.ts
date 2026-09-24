// src/client/styles/host-mount.ts
//
// 宿主接入：Sidebar 标签页挂载点。官方右侧 Sidebar 标签页挂载点，以及常驻容器 holder / host 的几何与占位提示。
// 注意：工作台内部弹层 z-index 必须大于官方浮动层（40）。
//
// 本文件内规则顺序即覆盖顺序（同特异性下后写的覆盖先写的），禁止重排。

export const hostMountStyles = `
/* ── 工作台 × 官方右侧 Sidebar 标签页（0.1.5-rc.1 迁移） ─────────────────────
   工作台内容由插件自持的常驻容器承载（Studio 永不卸载），标签页激活时该容器被搬进下面这个
   挂载点；未持有容器时（多标签页 body 并存）显示占位提示，避免出现空白面板。
   官方右侧 Sidebar 的浮动层 z-index 最高 40，工作台内部弹层须大于它。 */
.wf-tab-mount {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--wf-bg);
  color: var(--wf-ink);
}

.wf-tab-mount__placeholder {
  display: none;
  flex: 1;
  min-height: 0;
  align-items: center;
  justify-content: center;
  padding: 0 24px;
  color: var(--wf-ink-2);
  font-size: 12px;
  text-align: center;
}

.wf-tab-mount[data-wf-mount="empty"] .wf-tab-mount__placeholder {
  display: flex;
}

/* 无标签页持有容器时，常驻容器停放在隐藏 holder 内（display:none 不销毁子树，Studio 保持挂载） */
#visual-workflow-workbench-holder {
  display: none;
}

#visual-workflow-workbench-host {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
`
