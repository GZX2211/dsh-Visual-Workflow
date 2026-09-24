// src/client/styles/tokens.ts
//
// 全局样式：设计 token。颜色、边框、层级、连线与端口配色的 --wf-* 变量表。
// 注意：改主题只改这里；不得在别处复制 token 取值。
//
// 本文件内规则顺序即覆盖顺序（同特异性下后写的覆盖先写的），禁止重排。

export const tokensStyles = `
:root,
.wf-root {
  --wf-border: var(--dsw-alias-border-l1);
  --wf-border-strong: var(--dsw-alias-border-l2);
  --wf-bg: var(--dsw-alias-bg-base);
  --wf-layer: var(--dsw-alias-bg-layer-1);
  --wf-layer-2: var(--dsw-alias-bg-layer-2);
  --wf-brand: var(--dsw-alias-brand-primary);
  --wf-on-brand: var(--dsw-alias-label-primary-inverse, var(--dsw-alias-label-reverse, #ffffff));
  --wf-ink: var(--dsw-alias-label-primary);
  --wf-ink-2: var(--dsw-alias-label-secondary);
  // 弱化文字（日历前后月灰显）：刻意不随主题变化，保持与历史渲染一致
  --wf-ink-3: #6b7075;
  --wf-ok: var(--dsw-alias-state-success-primary);
  --wf-warn: var(--dsw-alias-state-warn-primary);
  --wf-err: var(--dsw-alias-state-error-primary);
  --wf-flow: #9aa7b8;
  --wf-context: #d9a441;
  --wf-database: #4a9fd8;
  --wf-pass: #3fbf7f;
  --wf-fail: #e05c5c;
  --wf-content: #9a7fd0;
  --wf-port-in: #3d8bfd;
  --wf-port-out: #ff8a4c;
}
`
