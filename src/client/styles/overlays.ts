// src/client/styles/overlays.ts
//
// 浮层域。二次确认弹层、运行历史弹层、状态圆点、导入隐藏输入、顶部 Toast 提示。
//
// 本文件内规则顺序即覆盖顺序（同特异性下后写的覆盖先写的），禁止重排。

export const overlaysStyles = `
/* ---- 二次确认弹层 ---- */
.wf-confirm-backdrop {
  position: absolute;
  z-index: 40;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: color-mix(in srgb, var(--wf-bg) 72%, transparent);
  backdrop-filter: blur(4px);
}

.wf-confirm {
  width: min(540px, 100%);
  max-height: calc(100vh - 40px);
  overflow: auto;
  padding: 18px;
  border: 1px solid var(--wf-border-strong);
  border-radius: 14px;
  background: var(--wf-layer);
  box-shadow: 0 20px 60px color-mix(in srgb, var(--wf-ink) 18%, transparent);
}

.wf-confirm h3 {
  margin: 0 0 8px;
  font-size: 15px;
  color: var(--wf-ink);
}

.wf-confirm p {
  margin: 0;
  color: var(--wf-ink-2);
  font-size: 12px;
  line-height: 1.65;
  white-space: pre-wrap;
}

.wf-confirm__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
  flex-wrap: wrap;
}

/* ---- 运行历史弹层 ---- */
.wf-history-backdrop {
  position: absolute;
  z-index: 30;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: color-mix(in srgb, var(--wf-bg) 72%, transparent);
  backdrop-filter: blur(4px);
}

.wf-history {
  width: min(760px, 100%);
  max-height: calc(100vh - 40px);
  display: flex;
  flex-direction: column;
  padding: 18px;
  border: 1px solid var(--wf-border-strong);
  border-radius: 14px;
  background: var(--wf-layer);
  box-shadow: 0 20px 60px color-mix(in srgb, var(--wf-ink) 18%, transparent);
}

.wf-history h3 {
  margin: 0 0 10px;
  font-size: 15px;
  color: var(--wf-ink);
}

.wf-history__list {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  scrollbar-width: thin;
}

.wf-history__item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
  border: 1px solid var(--wf-border);
  border-radius: 10px;
  background: var(--wf-layer-2);
  padding: 9px 11px;
  cursor: pointer;
}

.wf-history__item:hover {
  border-color: var(--wf-brand);
}

.wf-history__item.is-active {
  border-color: var(--wf-brand);
  background: color-mix(in srgb, var(--wf-brand) 8%, var(--wf-layer-2));
}

.wf-history__title {
  font-size: 12px;
  font-weight: 650;
  color: var(--wf-ink);
  display: flex;
  align-items: center;
  gap: 6px;
}

.wf-history__chain {
  font-size: 9px;
  color: var(--wf-ink-2);
  border: 1px solid var(--wf-border);
  border-radius: 999px;
  padding: 0 6px;
}

.wf-history__meta {
  font: 9px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--wf-ink-2);
}

.wf-history__resume {
  align-self: flex-end;
}

.wf-history__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

/* ---- 状态圆点（运行 / 成功 / 失败 / 暂停 / 跳过 …） ---- */
.wf-status-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  margin-right: 5px;
  background: var(--wf-ink-2);
}

.wf-status-dot.is-running {
  background: var(--wf-ok);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--wf-ok) 18%, transparent);
}

.wf-status-dot.is-ok {
  background: var(--wf-ok);
}

.wf-status-dot.is-fail {
  background: var(--wf-err);
}

.wf-status-dot.is-armed {
  background: var(--wf-warn);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--wf-warn) 16%, transparent);
}

.wf-status-dot.is-pending {
  background: var(--wf-ink-2);
}

.wf-status-dot.is-skipped {
  background: var(--wf-ink-2);
  opacity: .6;
}

.wf-status-dot.is-react-capped {
  background: var(--wf-context);
}

.wf-status-dot.is-paused,
.wf-status-dot.is-interrupted {
  background: var(--wf-warn);
}

/* ---- 导入隐藏输入与顶部提示 ---- */
.wf-import-hidden {
  display: none;
}

.wf-toast-host {
  position: fixed;
  z-index: 9999;
  top: 56px;
  right: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  pointer-events: none;
}

.wf-toast {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 190px;
  max-width: 330px;
  padding: 9px 12px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.5;
  box-shadow: 0 12px 32px color-mix(in srgb, var(--wf-ink) 22%, transparent);
  animation: wf-toast-in .18s ease;
}

.wf-toast.is-success {
  background: color-mix(in srgb, var(--wf-ok) 16%, var(--wf-layer));
  border: 1px solid color-mix(in srgb, var(--wf-ok) 55%, var(--wf-border-strong));
  color: var(--wf-ink);
}

.wf-toast.is-error {
  background: color-mix(in srgb, var(--wf-err) 14%, var(--wf-layer));
  border: 1px solid color-mix(in srgb, var(--wf-err) 55%, var(--wf-border-strong));
  color: var(--wf-ink);
}

.wf-toast.is-info {
  background: var(--wf-layer);
  border: 1px solid var(--wf-border-strong);
  color: var(--wf-ink);
}

.wf-toast__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 5px;
}

.wf-toast.is-success .wf-toast__dot {
  background: var(--wf-ok);
}

.wf-toast.is-error .wf-toast__dot {
  background: var(--wf-err);
}

.wf-toast.is-info .wf-toast__dot {
  background: var(--wf-brand);
}

@keyframes wf-toast-in {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }

  to {
    opacity: 1;
    transform: none;
  }
}
`
