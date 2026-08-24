// src/client/styles.ts
//
// 工作台样式（字符串注入 style[data-plugin]）：浮窗入口 + 工作台骨架。
// 深浅色经 CSS 变量（--wf-* 系列，与 shared/protocol.ts 颜色变量一致）。

export const styles = `
:root {
  --wf-flow: #9aa7b8;
  --wf-context: #d9a441;
  --wf-database: #4a9fd8;
  --wf-pass: #3fbf7f;
  --wf-fail: #e05c5c;
  --wf-content: #9a7fd0;
  --wf-bg: #15181d;
  --wf-bg-elev: #1c2128;
  --wf-bg-panel: #191d24;
  --wf-border: #2c333d;
  --wf-text: #d7dde6;
  --wf-text-dim: #8b94a3;
  --wf-accent: #4f8cff;
  --wf-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}

[data-theme='light'] {
  --wf-bg: #f5f7fa;
  --wf-bg-elev: #ffffff;
  --wf-bg-panel: #fbfcfd;
  --wf-border: #d9dfe7;
  --wf-text: #22262d;
  --wf-text-dim: #667085;
  --wf-shadow: 0 12px 40px rgba(30, 40, 60, 0.22);
}

/* ---- 右下角圆形 FAB ---- */
.wf-fab {
  position: fixed;
  right: 22px;
  bottom: 22px;
  z-index: 2147483000;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 1px solid var(--wf-border);
  background: var(--wf-accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: var(--wf-shadow);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.wf-fab:hover { transform: translateY(-2px) scale(1.04); box-shadow: 0 16px 44px rgba(0, 0, 0, 0.5); }
.wf-fab[hidden] { display: none; }

/* ---- 浮窗 ---- */
.wf-window {
  position: fixed;
  z-index: 2147482990;
  display: flex;
  flex-direction: column;
  background: var(--wf-bg);
  border: 1px solid var(--wf-border);
  border-radius: 10px;
  box-shadow: var(--wf-shadow);
  overflow: hidden;
  min-width: 480px;
  min-height: 320px;
}
.wf-window__titlebar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  height: 38px;
  background: var(--wf-bg-elev);
  border-bottom: 1px solid var(--wf-border);
  cursor: move;
  user-select: none;
}
.wf-window__title { font-weight: 600; font-size: 13px; color: var(--wf-text); }
.wf-window__badge {
  font-size: 11px;
  color: var(--wf-accent);
  border: 1px solid var(--wf-accent);
  border-radius: 999px;
  padding: 1px 8px;
}
.wf-window__spacer { flex: 1; }
.wf-window__close {
  border: none;
  background: transparent;
  color: var(--wf-text-dim);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 6px;
}
.wf-window__close:hover { background: var(--wf-border); color: var(--wf-text); }
.wf-window__body { flex: 1; min-height: 0; display: flex; }
/* 八方向缩放边 */
.wf-window__resize { position: absolute; z-index: 2; }
.wf-window__resize.is-n { top: -3px; left: 10px; right: 10px; height: 6px; cursor: ns-resize; }
.wf-window__resize.is-s { bottom: -3px; left: 10px; right: 10px; height: 6px; cursor: ns-resize; }
.wf-window__resize.is-e { right: -3px; top: 10px; bottom: 10px; width: 6px; cursor: ew-resize; }
.wf-window__resize.is-w { left: -3px; top: 10px; bottom: 10px; width: 6px; cursor: ew-resize; }
.wf-window__resize.is-ne { top: -4px; right: -4px; width: 12px; height: 12px; cursor: nesw-resize; }
.wf-window__resize.is-nw { top: -4px; left: -4px; width: 12px; height: 12px; cursor: nwse-resize; }
.wf-window__resize.is-se { bottom: -4px; right: -4px; width: 12px; height: 12px; cursor: nwse-resize; }
.wf-window__resize.is-sw { bottom: -4px; left: -4px; width: 12px; height: 12px; cursor: nesw-resize; }

/* ---- 工作台骨架 ---- */
.wf-root {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--wf-bg);
  color: var(--wf-text);
  font-size: 13px;
}
.wf-tabs {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 12px;
  height: 40px;
  border-bottom: 1px solid var(--wf-border);
  background: var(--wf-bg-elev);
}
.wf-titlebar__title { font-weight: 600; }
.wf-titlebar__badge { font-size: 11px; color: var(--wf-accent); }
.wf-titlebar__note { font-size: 11px; color: var(--wf-text-dim); }
.wf-titlebar__spacer { flex: 1; }
.wf-titlebar__session { font-size: 11px; color: var(--wf-text-dim); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wf-main { flex: 1; min-height: 0; display: flex; }
.wf-left, .wf-inspector {
  flex: none;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--wf-bg-panel);
  border-color: var(--wf-border);
}
.wf-left { border-right: 1px solid var(--wf-border); }
.wf-inspector { border-left: 1px solid var(--wf-border); }
.wf-splitter { flex: none; width: 5px; cursor: col-resize; background: transparent; }
.wf-splitter:hover, .wf-splitter.is-dragging { background: var(--wf-accent); opacity: 0.5; }
.wf-canvas-shell { flex: 1; min-width: 0; display: flex; flex-direction: column; position: relative; }
.wf-canvas-toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--wf-border);
  background: var(--wf-bg-elev);
}
.wf-canvas-toolbar__mode { font-size: 11px; color: var(--wf-accent); border: 1px solid var(--wf-accent); border-radius: 999px; padding: 1px 8px; }
.wf-canvas-toolbar__flow { font-size: 12px; color: var(--wf-text-dim); }
.wf-canvas-toolbar__spacer { flex: 1; }
.wf-canvas-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--wf-text-dim);
}
.wf-canvas-empty__running { color: var(--wf-pass); }
.wf-btn {
  border: 1px solid var(--wf-border);
  background: var(--wf-bg-elev);
  color: var(--wf-text);
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
.wf-btn:hover:not(:disabled) { border-color: var(--wf-accent); color: var(--wf-accent); }
.wf-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.wf-lib-tabs { flex: none; display: flex; border-bottom: 1px solid var(--wf-border); }
.wf-lib-tab {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--wf-text-dim);
  padding: 8px 4px;
  font-size: 12px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.wf-lib-tab.is-active { color: var(--wf-accent); border-bottom-color: var(--wf-accent); }
.wf-lib-tab__add { flex: none; width: 34px; font-size: 16px; }
.wf-lib-list { flex: 1; overflow-y: auto; padding: 6px; }
.wf-lib-list ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.wf-lib-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--wf-border);
  background: var(--wf-bg-elev);
  color: var(--wf-text);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
}
.wf-lib-item:hover, .wf-lib-item.is-active { border-color: var(--wf-accent); }
.wf-lib-item__name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wf-lib-item__status { font-size: 10px; color: var(--wf-text-dim); }
.wf-lib-empty { color: var(--wf-text-dim); font-size: 12px; padding: 16px 8px; text-align: center; }
.wf-inspector__empty { color: var(--wf-text-dim); font-size: 12px; padding: 16px; }
.wf-inspector__current { padding: 8px 16px; color: var(--wf-text); border-top: 1px solid var(--wf-border); }
.wf-message { flex: none; padding: 4px 12px; font-size: 12px; color: var(--wf-text-dim); border-top: 1px solid var(--wf-border); }
.wf-toast-host {
  position: absolute;
  right: 14px;
  bottom: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 10;
}
.wf-toast {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--wf-bg-elev);
  border: 1px solid var(--wf-border);
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 12px;
  box-shadow: var(--wf-shadow);
}
.wf-toast__dot { width: 8px; height: 8px; border-radius: 50%; }
.wf-toast.is-info .wf-toast__dot { background: var(--wf-accent); }
.wf-toast.is-success .wf-toast__dot { background: var(--wf-pass); }
.wf-toast.is-error .wf-toast__dot { background: var(--wf-fail); }
`
