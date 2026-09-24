// src/client/styles/service-console.ts
//
// 模式二服务控制台。状态行与调试终端（输入 / 输出 / 操作按钮）。
//
// 本文件内规则顺序即覆盖顺序（同特异性下后写的覆盖先写的），禁止重排。

export const serviceConsoleStyles = `
/* ---- 服务控制台 ---- */
.wf-service-console {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--wf-border);
  background: var(--wf-layer);
}

.wf-service-console__debug {
  flex-basis: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-top: 1px solid var(--wf-border);
  padding-top: 7px;
}

.wf-service-console__debug-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wf-service-console__debug-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--wf-ink);
}

.wf-service-console__input {
  width: 100%;
  resize: vertical;
  border: 1px solid var(--wf-border-strong);
  border-radius: 7px;
  background: var(--wf-layer-2);
  color: var(--wf-ink);
  padding: 6px 8px;
  outline: 0;
  font: inherit;
  font-size: 12px;
  min-height: 44px;
  box-sizing: border-box;
}

.wf-service-console__input:focus {
  border-color: var(--wf-brand);
}

.wf-service-console__debug-actions {
  display: flex;
  gap: 7px;
}

.wf-service-console__debug-actions .wf-btn {
  font-size: 11px;
  padding: 4px 10px;
}

.wf-service-console__output {
  flex: none;
  min-height: 56px;
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
  padding: 8px;
  border: 1px solid var(--wf-border);
  border-radius: 7px;
  background: var(--wf-layer-2);
  color: var(--wf-ink);
  font: inherit;
  font-size: 12px;
  line-height: 1.6;
  box-sizing: border-box;
}
`
