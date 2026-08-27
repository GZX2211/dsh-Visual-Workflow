// src/client/styles.ts
//
// 工作台样式（照搬旧项目 styles.js 的设计语言，类名前缀 wf-；TS 化 + 新模型扩展）：
// 全部使用 DSH 设计 token（--dsw-alias-*）→ 深色/浅色模式自动适配；
// 连线颜色变量 --wf-flow/--wf-context/--wf-database/--wf-pass/--wf-fail/--wf-content；
// 新增：浮窗/FAB、协作组卡片、虚拟节点虚线角标、阶段/数据库节点配色、服务控制台、模式菜单。

export const styles = `
:root,.wf-root{--wf-border:var(--dsw-alias-border-l1);--wf-border-strong:var(--dsw-alias-border-l2);--wf-bg:var(--dsw-alias-bg-base);--wf-layer:var(--dsw-alias-bg-layer-1);--wf-layer-2:var(--dsw-alias-bg-layer-2);--wf-brand:var(--dsw-alias-brand-primary);--wf-on-brand:var(--dsw-alias-label-primary-inverse,var(--dsw-alias-label-reverse,#ffffff));--wf-ink:var(--dsw-alias-label-primary);--wf-ink-2:var(--dsw-alias-label-secondary);--wf-ok:var(--dsw-alias-state-success-primary);--wf-warn:var(--dsw-alias-state-warn-primary);--wf-err:var(--dsw-alias-state-error-primary);--wf-flow:#9aa7b8;--wf-context:#d9a441;--wf-database:#4a9fd8;--wf-pass:#3fbf7f;--wf-fail:#e05c5c;--wf-content:#9a7fd0}
.wf-root{position:relative;inset:auto;width:100%;height:100%;max-height:100vh;min-height:0;display:grid;grid-template-rows:48px minmax(0,1fr);background:var(--wf-bg);color:var(--wf-ink);font:13px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}
.wf-root *{box-sizing:border-box}
.wf-root button,.wf-root input,.wf-root select,.wf-root textarea{font:inherit}
.wf-root button{cursor:pointer}
.wf-tabs{display:flex;align-items:center;gap:10px;padding:0 20px;background:var(--wf-layer);border-bottom:1px solid var(--wf-border);flex:none;min-width:0}
.wf-titlebar__title{font-size:14px;font-weight:720;color:var(--wf-ink);white-space:nowrap}
.wf-titlebar__badge{padding:3px 7px;border-radius:999px;background:color-mix(in srgb,var(--wf-brand) 10%,transparent);color:var(--wf-brand);font-size:10px;font-weight:700;white-space:nowrap}
.wf-titlebar__note{color:var(--wf-ink-2);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wf-titlebar__spacer{margin-left:auto;flex:1}
.wf-titlebar__mode{position:relative;flex:none}
.wf-titlebar__caret{margin-left:4px;font-size:9px;color:var(--wf-ink-2)}
.wf-titlebar__close{margin-left:2px}
.wf-mode-menu{position:absolute;z-index:60;right:0;top:calc(100% + 6px);min-width:170px;padding:6px;border:1px solid var(--wf-border-strong);border-radius:10px;background:var(--wf-layer);box-shadow:0 14px 34px color-mix(in srgb,var(--wf-ink) 22%,transparent);display:flex;flex-direction:column;gap:4px}
.wf-mode-menu__item{text-align:left;border:0;border-radius:7px;background:transparent;color:var(--wf-ink);padding:7px 10px;font-size:12px}
.wf-mode-menu__item:hover{background:color-mix(in srgb,var(--wf-brand) 10%,var(--wf-layer));color:var(--wf-brand)}
.wf-main{min-height:0;min-width:0;overflow:hidden;display:flex}
.wf-toolbar{flex:none;height:52px;min-height:52px;display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--wf-layer);border-bottom:1px solid var(--wf-border);flex-wrap:nowrap;overflow-x:auto;overflow-y:hidden;scrollbar-width:thin}
.wf-toolbar>*{flex:none}
.wf-btn{border:1px solid var(--wf-border-strong);border-radius:8px;background:var(--wf-layer-2);color:var(--wf-ink);padding:6px 11px;transition:border-color .15s ease,transform .15s ease,background .15s ease;white-space:nowrap}
.wf-btn:hover{border-color:var(--wf-brand);transform:translateY(-1px)}
/* 主按钮：采用 DSH 官方主按钮语义（--dsw-alias-button-primary-fill 与
   --dsw-alias-label-primary-foreground）：深色主题=浅底深字、浅色主题=深底白字，
   无论主题如何都保持文字可见（此前 fallback #fff 在深色主题浅底上白字不可见） */
.wf-btn.is-primary{border-color:var(--dsw-alias-button-primary-fill,var(--wf-brand));background:var(--dsw-alias-button-primary-fill,var(--wf-brand,#4f7cff));color:var(--dsw-alias-label-primary-foreground,var(--wf-bg,#15181d));font-weight:650}
.wf-btn.is-primary:hover{border-color:var(--dsw-alias-button-primary-hover,var(--wf-brand))}
.wf-btn.is-danger{border-color:color-mix(in srgb,var(--wf-err) 55%,var(--wf-border-strong));color:var(--wf-err)}
.wf-btn.is-danger:hover{border-color:var(--wf-err)}
.wf-btn.is-ghost{background:transparent}
.wf-btn:disabled{opacity:.5;cursor:default}
.wf-status{color:var(--wf-ink-2);font-size:12px;margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:38%}
.wf-status.is-running{color:var(--wf-ok)}
.wf-canvas-shell{position:relative;flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--wf-bg);overflow:hidden}
.wf-canvas-stage{position:relative;flex:1;min-height:0;display:flex;overflow:hidden}
.wf-canvas{flex:1;min-height:0;position:relative;overflow:hidden;touch-action:none;user-select:none;background-color:var(--wf-bg);background-image:radial-gradient(circle,var(--wf-border-strong) 1.1px,transparent 1.2px),radial-gradient(circle at 50% 0%,color-mix(in srgb,var(--wf-brand) 6%,transparent),transparent 42%);background-size:24px 24px,100% 100%;cursor:grab}
.wf-canvas.is-panning{cursor:grabbing}
.wf-graph__stage{position:absolute;left:0;top:0;width:1px;height:1px;transform-origin:0 0;will-change:transform}
.wf-graph__edges{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}
.wf-graph__edge{fill:none!important;stroke:var(--wf-flow);stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;vector-effect:non-scaling-stroke;filter:drop-shadow(0 0 2px color-mix(in srgb,var(--wf-flow) 30%,transparent));pointer-events:none}
.wf-graph__edge.is-selected{stroke-width:3.6;filter:drop-shadow(0 0 4px color-mix(in srgb,var(--wf-brand) 58%,transparent))}
.wf-graph__edge.is-ctx{stroke:var(--wf-context)}
.wf-graph__edge.is-db{stroke:var(--wf-database)}
.wf-graph__edge.is-pass{stroke:var(--wf-pass)}
.wf-graph__edge.is-fail{stroke:var(--wf-fail)}
.wf-graph__edge.is-content{stroke:var(--wf-content)}
.wf-arrow-head{fill:var(--wf-flow);stroke:none}
.wf-arrow-head.is-pass{fill:var(--wf-pass)}
.wf-arrow-head.is-fail{fill:var(--wf-fail)}
.wf-arrow-head.is-content{fill:var(--wf-content)}
.wf-graph__edge.is-running{stroke-dasharray:8 5}
.wf-graph__edge-hit{fill:none!important;stroke:transparent;stroke-width:18;vector-effect:non-scaling-stroke;pointer-events:stroke;cursor:pointer}
.wf-graph__connection{fill:none!important;stroke:var(--wf-brand);stroke-width:2;stroke-dasharray:7 5;vector-effect:non-scaling-stroke;pointer-events:none}
.wf-graph__label-bg{fill:var(--wf-layer);stroke:var(--wf-border);stroke-width:1;vector-effect:non-scaling-stroke}
.wf-graph__label{fill:var(--wf-ink);font-size:10px;font-weight:750;text-anchor:middle;dominant-baseline:middle;pointer-events:none}
.wf-graph__node{position:absolute;width:208px;height:116px;pointer-events:auto;cursor:grab}
.wf-graph__node.is-dragging{cursor:grabbing}
.wf-graph__handle{position:absolute;z-index:4;top:50%;width:13px;height:13px;padding:0;border:2px solid var(--wf-bg);border-radius:50%;background:var(--wf-brand);transform:translateY(-50%);cursor:crosshair;box-shadow:0 0 0 1px color-mix(in srgb,var(--wf-brand) 65%,var(--wf-border-strong));transition:transform .14s ease,box-shadow .14s ease}
.wf-graph__handle:hover,.wf-graph__handle:focus-visible{transform:translateY(-50%) scale(1.18);box-shadow:0 0 0 5px color-mix(in srgb,var(--wf-brand) 18%,transparent);outline:0}
.wf-graph__handle--target{left:-6px}
.wf-graph__handle--source{right:-6px}
.wf-graph__controls{position:absolute;z-index:8;left:12px;bottom:12px;display:grid;border:1px solid var(--wf-border-strong);border-radius:9px;overflow:hidden;background:var(--wf-layer);box-shadow:0 8px 20px color-mix(in srgb,var(--wf-ink) 9%,transparent)}
.wf-graph__controls button{width:32px;height:30px;border:0;border-bottom:1px solid var(--wf-border);background:var(--wf-layer-2);color:var(--wf-ink);font-weight:750}
.wf-graph__controls button:last-child{border-bottom:0}
.wf-graph__controls button:hover{background:color-mix(in srgb,var(--wf-brand) 10%,var(--wf-layer-2));color:var(--wf-brand)}
.wf-node{width:100%;height:100%;padding:12px 14px;border:1px solid var(--wf-border-strong);border-radius:12px;background:color-mix(in srgb,var(--wf-layer) 96%,var(--wf-brand) 4%);color:var(--wf-ink);box-shadow:0 8px 24px color-mix(in srgb,var(--wf-ink) 9%,transparent);transition:border-color .16s ease,box-shadow .16s ease,transform .16s ease;overflow:hidden}
.wf-node:hover{border-color:color-mix(in srgb,var(--wf-brand) 55%,var(--wf-border-strong));box-shadow:0 12px 30px color-mix(in srgb,var(--wf-ink) 12%,transparent)}
.wf-node.is-selected{border-color:var(--wf-brand);box-shadow:0 0 0 3px color-mix(in srgb,var(--wf-brand) 18%,transparent),0 12px 30px color-mix(in srgb,var(--wf-ink) 12%,transparent)}
.wf-node.is-highlighted{border-color:var(--wf-brand);box-shadow:0 0 0 3px color-mix(in srgb,var(--wf-brand) 26%,transparent),0 0 18px color-mix(in srgb,var(--wf-brand) 30%,transparent)}
.wf-node.is-proxy{border-style:dashed;border-color:var(--wf-warn)}
.wf-node__kind{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--wf-ink-2);margin-bottom:2px;display:flex;align-items:center;gap:6px}
.wf-node__label{font-weight:650;font-size:13px;word-break:break-word;display:flex;align-items:center;gap:6px}
.wf-node__proxy-badge{flex:none;font-size:9px;font-weight:750;color:var(--wf-warn);border:1px solid var(--wf-warn);border-radius:999px;padding:0 5px;line-height:15px}
.wf-node__prompt{margin-top:5px;font-size:11px;color:var(--wf-ink-2);white-space:pre-wrap;max-height:34px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.wf-node--parent .wf-node__kind{color:var(--wf-brand)}
.wf-node--agent .wf-node__kind{color:var(--wf-brand)}
.wf-node--file .wf-node__kind{color:var(--wf-ink-2)}
.wf-node--database .wf-node__kind{color:var(--wf-database)}
.wf-node--start .wf-node__kind{color:var(--wf-ok)}
.wf-node--end .wf-node__kind{color:var(--wf-err)}
.wf-node--pause .wf-node__kind{color:var(--wf-warn)}
.wf-node--group .wf-node__kind{color:var(--wf-warn)}
.wf-node--group{display:flex;flex-direction:column;padding:10px 12px}
.wf-group-node{width:300px;height:220px}
/* 拖拽悬停入组高亮（用户验收标注：卡片插入协作组卡片区域即识别为入组） */
.wf-group-node.is-drop-target .wf-node--group{border-color:var(--wf-pass);box-shadow:0 0 0 3px color-mix(in srgb,var(--wf-pass) 26%,transparent),0 0 22px color-mix(in srgb,var(--wf-pass) 32%,transparent)}
.wf-group__drop-hint{flex:none;margin:6px 0 2px;padding:4px 8px;border:1px dashed var(--wf-pass);border-radius:8px;color:var(--wf-pass);font-size:10px;font-weight:700;text-align:center;pointer-events:none}
/* 已选文件列表（文件表单，按钮下方显示；用户验收标注） */
.wf-file-list{display:flex;flex-direction:column;gap:4px;padding:6px;border:1px solid var(--wf-border);border-radius:8px;background:var(--wf-layer-2);max-height:120px;overflow:auto;scrollbar-width:thin}
.wf-file-chip{display:block;font-size:11px;color:var(--wf-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:2px 6px;border-radius:6px;background:color-mix(in srgb,var(--wf-brand) 8%,transparent)}
.wf-group__members{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:5px;margin-top:6px;padding:6px;border:1px solid var(--wf-border);border-radius:8px;background:var(--wf-layer-2);scrollbar-width:thin}
/* 组内成员 = 缩小版角色卡：仅名称+状态，数据库/上下文接点，无流程接点（用户批注 Q2） */
.wf-group__member{position:relative;display:flex;align-items:center;gap:6px;min-height:36px;border:1px solid var(--wf-border-strong);border-radius:8px;background:color-mix(in srgb,var(--wf-layer) 90%,var(--wf-brand) 10%);color:var(--wf-ink);padding:6px 10px;font-size:11px;text-align:left;box-shadow:0 2px 6px color-mix(in srgb,var(--wf-ink) 8%,transparent);transition:border-color .16s ease,box-shadow .16s ease}
.wf-group__member:hover{border-color:color-mix(in srgb,var(--wf-brand) 55%,var(--wf-border-strong));box-shadow:0 2px 10px color-mix(in srgb,var(--wf-ink) 12%,transparent)}
.wf-graph__handle--mini{width:9px;height:9px;border-width:1px}
.wf-graph__handle--mini:hover{transform:translateY(-50%) scale(1.25)}
.wf-group__member-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:650}
.wf-group__resize{position:absolute;z-index:6;right:-4px;bottom:-4px;width:14px;height:14px;border-right:3px solid var(--wf-border-strong);border-bottom:3px solid var(--wf-border-strong);border-radius:0 0 6px 0;cursor:nwse-resize}
.wf-group__resize:hover{border-color:var(--wf-brand)}
.wf-canvas-empty{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}
.wf-canvas-empty__hint{display:flex;flex-direction:column;align-items:center;gap:10px;color:var(--wf-ink-2);font-size:12px;text-align:center;opacity:.85}
.wf-canvas-empty__icon{width:52px;height:52px;border:1px dashed var(--wf-border-strong);border-radius:16px;display:grid;place-items:center;font-size:22px;color:var(--wf-brand)}
.wf-docrail{flex:none;width:auto;display:flex;flex-direction:column;background:var(--wf-layer);min-height:0;overflow:hidden}
.wf-docrail.is-collapsed{visibility:hidden;pointer-events:none;width:0}
.wf-docrail__list{flex:1 1 0;height:0;min-height:0;overflow:auto;overscroll-behavior:contain;padding:9px;display:flex;flex-direction:column;gap:6px;scrollbar-width:thin}
.wf-lib-tabs{flex:none;display:flex;gap:4px;padding:8px 10px 0;border-bottom:1px solid var(--wf-border)}
.wf-lib-tab{flex:1;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:9px 9px 0 0;background:transparent;color:var(--wf-ink-2);padding:7px 4px;font-size:11px;font-weight:650;cursor:pointer}
.wf-lib-tab:hover{color:var(--wf-ink);background:color-mix(in srgb,var(--wf-brand) 6%,transparent)}
.wf-lib-tab.is-active{color:var(--wf-brand);background:color-mix(in srgb,var(--wf-brand) 10%,transparent);box-shadow:inset 0 -2px 0 var(--wf-brand)}
.wf-docgroup{display:flex;align-items:center;justify-content:space-between;padding:5px 7px 2px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--wf-ink-2)}
.wf-docgroup__add{width:20px;height:20px;min-width:20px;border:1px solid var(--wf-border-strong);border-radius:6px;background:transparent;color:var(--wf-ink-2);font-size:13px;line-height:0;padding:0;display:flex;align-items:center;justify-content:center;cursor:pointer}
.wf-docgroup__add:hover{border-color:var(--wf-brand);color:var(--wf-brand)}
.wf-docitem{width:100%;display:grid;grid-template-columns:26px minmax(0,1fr);gap:9px;align-items:center;text-align:left;border:1px solid transparent;border-radius:10px;background:transparent;color:var(--wf-ink);padding:8px;cursor:grab;touch-action:none}
.wf-docitem:hover{background:var(--wf-layer-2);border-color:var(--wf-border)}
.wf-docitem.is-active{background:color-mix(in srgb,var(--wf-brand) 10%,var(--wf-layer));border-color:color-mix(in srgb,var(--wf-brand) 45%,var(--wf-border));color:var(--wf-brand)}
.wf-docitem.is-pinned{background:color-mix(in srgb,var(--wf-brand) 6%,var(--wf-layer));border-color:color-mix(in srgb,var(--wf-brand) 28%,var(--wf-border))}
.wf-docitem__icon{width:26px;height:30px;border:1px solid currentColor;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;opacity:.76}
.wf-docitem__label{display:block;font-size:12px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wf-docitem__path{display:block;font:9px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--wf-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wf-drag-preview{position:fixed;z-index:999;pointer-events:none;min-width:150px;max-width:230px;padding:9px 12px;border:1px solid var(--wf-brand);border-radius:10px;background:color-mix(in srgb,var(--wf-layer) 94%,var(--wf-brand) 6%);color:var(--wf-ink);font-size:12px;font-weight:650;box-shadow:0 14px 34px color-mix(in srgb,var(--wf-ink) 22%,transparent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wf-inspector{flex:none;width:auto;height:100%;max-height:100%;display:flex;flex-direction:column;background:var(--wf-layer);overflow:hidden;min-height:0}
.wf-inspector__scroll{flex:1 1 0;height:0;min-height:0;overflow:auto;overscroll-behavior:contain;padding:15px;display:flex;flex-direction:column;gap:11px;scrollbar-width:thin}
.wf-inspector__scroll>*{flex-shrink:0}
.wf-inspector.is-collapsed{visibility:hidden;pointer-events:none;padding:0;width:0!important}
.wf-inspector h3{margin:0;font-size:14px;color:var(--wf-ink)}
.wf-inspector label{display:grid;gap:4px;color:var(--wf-ink-2);font-size:12px}
.wf-inspector input,.wf-inspector select,.wf-inspector textarea{width:100%;border:1px solid var(--wf-border-strong);border-radius:7px;background:var(--wf-layer-2);color:var(--wf-ink);padding:6px 8px;outline:0}
.wf-inspector input:focus,.wf-inspector select:focus,.wf-inspector textarea:focus{border-color:var(--wf-brand)}
.wf-inspector textarea{min-height:92px;resize:none;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.55}
.wf-inspector__footer{flex:none;display:flex;align-items:center;gap:7px;padding:10px 14px;border-top:1px solid var(--wf-border);background:var(--wf-layer)}
.wf-inspector__footer .wf-btn{font-size:11px;padding:5px 11px}
.wf-inspector .wf-empty{color:var(--wf-ink-2);font-size:12px}
.wf-field{display:flex;flex-direction:column;gap:4px}
.wf-check-list{max-height:190px;overflow:auto;display:flex;flex-direction:column;gap:4px;padding:6px;border:1px solid var(--wf-border);border-radius:8px;background:var(--wf-layer-2);scrollbar-width:thin}
.wf-check-list label{display:flex;align-items:center;gap:7px;color:var(--wf-ink);font-size:11px}
.wf-hint{color:var(--wf-ink-2);font-size:11px}
.wf-advanced{border:1px solid var(--wf-border);border-radius:9px;background:var(--wf-layer-2);padding:0 9px;margin:12px 0 0}
.wf-advanced summary{cursor:pointer;padding:8px 0;color:var(--wf-ink-2);font-size:11px;font-weight:650}
.wf-advanced__content{display:grid;gap:9px;padding:0 0 10px}
.wf-pathbox{display:flex;flex-direction:column;gap:2px;padding:9px 10px;border:1px solid var(--wf-border);border-radius:9px;background:var(--wf-layer-2)}
.wf-pathbox__label{font-size:10px;color:var(--wf-ink-2)}
.wf-pathbox__value{font:10px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--wf-ink);word-break:break-all}
.wf-iconbtn{width:32px;height:32px;padding:0;display:inline-flex;align-items:center;justify-content:center;font-size:16px}
.wf-splitter{position:relative;z-index:12;flex:none;min-width:9px;width:9px;cursor:col-resize;touch-action:none;background:var(--wf-layer);outline:0}
.wf-splitter::before{content:"";position:absolute;inset:0 3px;background:var(--wf-border)}
.wf-splitter:hover::before,.wf-splitter:focus-visible::before,.wf-splitter.is-dragging::before{inset:0 2px;background:var(--wf-brand)}
.wf-confirm-backdrop{position:absolute;z-index:40;inset:0;display:grid;place-items:center;padding:20px;background:color-mix(in srgb,var(--wf-bg) 72%,transparent);backdrop-filter:blur(4px)}
.wf-confirm{width:min(540px,100%);max-height:calc(100vh - 40px);overflow:auto;padding:18px;border:1px solid var(--wf-border-strong);border-radius:14px;background:var(--wf-layer);box-shadow:0 20px 60px color-mix(in srgb,var(--wf-ink) 18%,transparent)}
.wf-confirm h3{margin:0 0 8px;font-size:15px;color:var(--wf-ink)}
.wf-confirm p{margin:0;color:var(--wf-ink-2);font-size:12px;line-height:1.65;white-space:pre-wrap}
.wf-confirm__actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px;flex-wrap:wrap}
.wf-history-backdrop{position:absolute;z-index:30;inset:0;display:grid;place-items:center;padding:20px;background:color-mix(in srgb,var(--wf-bg) 72%,transparent);backdrop-filter:blur(4px)}
.wf-history{width:min(760px,100%);max-height:calc(100vh - 40px);display:flex;flex-direction:column;padding:18px;border:1px solid var(--wf-border-strong);border-radius:14px;background:var(--wf-layer);box-shadow:0 20px 60px color-mix(in srgb,var(--wf-ink) 18%,transparent)}
.wf-history h3{margin:0 0 10px;font-size:15px;color:var(--wf-ink)}
.wf-history__list{min-height:0;overflow:auto;display:flex;flex-direction:column;gap:6px;scrollbar-width:thin}
.wf-history__item{display:flex;flex-direction:column;gap:4px;text-align:left;border:1px solid var(--wf-border);border-radius:10px;background:var(--wf-layer-2);padding:9px 11px;cursor:pointer}
.wf-history__item:hover{border-color:var(--wf-brand)}
.wf-history__item.is-active{border-color:var(--wf-brand);background:color-mix(in srgb,var(--wf-brand) 8%,var(--wf-layer-2))}
.wf-history__title{font-size:12px;font-weight:650;color:var(--wf-ink);display:flex;align-items:center;gap:6px}
.wf-history__chain{font-size:9px;color:var(--wf-ink-2);border:1px solid var(--wf-border);border-radius:999px;padding:0 6px}
.wf-history__meta{font:9px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--wf-ink-2)}
.wf-history__resume{align-self:flex-end}
.wf-history__actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}
.wf-status-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px;background:var(--wf-ink-2)}
.wf-status-dot.is-running{background:var(--wf-ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--wf-ok) 18%,transparent)}
.wf-status-dot.is-ok{background:var(--wf-ok)}
.wf-status-dot.is-fail{background:var(--wf-err)}
.wf-status-dot.is-paused,.wf-status-dot.is-interrupted{background:var(--wf-warn)}
.wf-import-hidden{display:none}
.wf-toast-host{position:fixed;z-index:9999;top:56px;right:16px;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.wf-toast{pointer-events:auto;display:flex;align-items:flex-start;gap:8px;min-width:190px;max-width:330px;padding:9px 12px;border-radius:10px;font-size:12px;line-height:1.5;box-shadow:0 12px 32px color-mix(in srgb,var(--wf-ink) 22%,transparent);animation:wf-toast-in .18s ease}
.wf-toast.is-success{background:color-mix(in srgb,var(--wf-ok) 16%,var(--wf-layer));border:1px solid color-mix(in srgb,var(--wf-ok) 55%,var(--wf-border-strong));color:var(--wf-ink)}
.wf-toast.is-error{background:color-mix(in srgb,var(--wf-err) 14%,var(--wf-layer));border:1px solid color-mix(in srgb,var(--wf-err) 55%,var(--wf-border-strong));color:var(--wf-ink)}
.wf-toast.is-info{background:var(--wf-layer);border:1px solid var(--wf-border-strong);color:var(--wf-ink)}
.wf-toast__dot{flex:none;width:8px;height:8px;border-radius:50%;margin-top:5px}
.wf-toast.is-success .wf-toast__dot{background:var(--wf-ok)}
.wf-toast.is-error .wf-toast__dot{background:var(--wf-err)}
.wf-toast.is-info .wf-toast__dot{background:var(--wf-brand)}
@keyframes wf-toast-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.wf-message{position:absolute;z-index:25;left:50%;bottom:18px;transform:translateX(-50%);max-width:70%;padding:8px 14px;border:1px solid var(--wf-border-strong);border-radius:10px;background:var(--wf-layer);color:var(--wf-ink-2);font-size:12px;box-shadow:0 10px 26px color-mix(in srgb,var(--wf-ink) 14%,transparent)}
.wf-window{position:fixed;z-index:2147483000;display:flex;flex-direction:column;border:1px solid var(--wf-border-strong);border-radius:14px;background:var(--wf-bg);box-shadow:0 34px 90px color-mix(in srgb,var(--wf-ink) 34%,transparent);overflow:hidden;overflow-wrap:anywhere}
.wf-window__body{flex:1;min-height:0;display:flex}
.wf-window .wf-tabs{cursor:grab}
.wf-window .wf-tabs button,.wf-window .wf-tabs input,.wf-window .wf-tabs select{cursor:pointer}
.wf-window .wf-tabs .wf-titlebar__title{cursor:grab}
.wf-window__resize{position:absolute;z-index:5}
.wf-window__resize.is-n{top:-4px;left:12px;right:12px;height:8px;cursor:n-resize}
.wf-window__resize.is-s{bottom:-4px;left:12px;right:12px;height:8px;cursor:s-resize}
.wf-window__resize.is-e{right:-4px;top:12px;bottom:12px;width:8px;cursor:e-resize}
.wf-window__resize.is-w{left:-4px;top:12px;bottom:12px;width:8px;cursor:w-resize}
.wf-window__resize.is-ne{top:-5px;right:-5px;width:14px;height:14px;cursor:ne-resize}
.wf-window__resize.is-nw{top:-5px;left:-5px;width:14px;height:14px;cursor:nw-resize}
.wf-window__resize.is-se{bottom:-5px;right:-5px;width:14px;height:14px;cursor:se-resize}
.wf-window__resize.is-sw{bottom:-5px;left:-5px;width:14px;height:14px;cursor:sw-resize}
.wf-fab{position:fixed;right:22px;bottom:22px;z-index:2147482999;width:56px;height:56px;border:2px solid rgba(255,255,255,0.28);border-radius:50%;background:var(--wf-brand,#4f7cff);color:#ffffff;display:grid;place-items:center;cursor:pointer;box-shadow:0 10px 26px rgba(0,0,0,0.45),0 2px 8px rgba(0,0,0,0.35),0 0 0 4px rgba(79,124,255,0.18);transition:transform .16s ease,box-shadow .16s ease}
.wf-fab:hover{transform:translateY(-2px) scale(1.05);box-shadow:0 14px 32px rgba(0,0,0,0.5),0 4px 10px rgba(0,0,0,0.4),0 0 0 6px rgba(79,124,255,0.24)}
.wf-fab:focus-visible{outline:3px solid #ffffff;outline-offset:2px}
.wf-combo-backdrop{position:absolute;z-index:35;inset:0;display:grid;place-items:center;padding:16px;background:color-mix(in srgb,var(--wf-bg) 72%,transparent);backdrop-filter:blur(4px)}
.wf-combo{width:min(1080px,94%);height:min(92%,760px);max-height:92%;display:flex;flex-direction:column;border:1px solid var(--wf-border-strong);border-radius:14px;background:var(--wf-layer);box-shadow:0 20px 60px color-mix(in srgb,var(--wf-ink) 18%,transparent);overflow:hidden}
.wf-combo__search{flex:none;padding:8px 12px 0}
.wf-combo__search input{width:100%;border:1px solid var(--wf-border-strong);border-radius:8px;background:var(--wf-layer-2);color:var(--wf-ink);padding:7px 10px;outline:0}
.wf-combo__search input:focus{border-color:var(--wf-brand)}
.wf-combo__head{flex:none;display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--wf-border)}
.wf-combo__head h3{margin:0;font-size:14px;color:var(--wf-ink);flex:none}
.wf-combo__head .wf-status{margin-left:0}
.wf-combo__close{margin-left:auto}
.wf-combo__body{flex:1;min-height:0;display:flex;overflow:hidden}
.wf-combo__catalog{flex:1.35;min-width:0;display:flex;flex-direction:column;border-right:1px solid var(--wf-border);overflow:hidden;position:relative;z-index:2}
.wf-combo__tabs{flex:none;display:flex;gap:4px;padding:8px 10px 0;border-bottom:1px solid var(--wf-border)}
.wf-combo__tab{display:inline-flex;align-items:center;gap:6px;border:0;border-radius:9px 9px 0 0;background:transparent;color:var(--wf-ink-2);padding:7px 12px;font-size:11px;font-weight:650;cursor:pointer}
.wf-combo__tab:hover{color:var(--wf-ink)}
.wf-combo__tab.is-active{color:var(--wf-brand);background:color-mix(in srgb,var(--wf-brand) 10%,transparent);box-shadow:inset 0 -2px 0 var(--wf-brand)}
.wf-combo__tab-count{padding:1px 6px;border-radius:999px;background:var(--wf-layer-2);font-size:9px;color:var(--wf-ink-2)}
.wf-combo__grid{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;display:grid;grid-template-columns:repeat(auto-fill,minmax(228px,1fr));gap:8px;align-content:start;padding:12px;scrollbar-width:thin}
.wf-combo-card{display:flex;gap:9px;align-items:flex-start;text-align:left;border:1px solid var(--wf-border);border-radius:11px;background:var(--wf-layer-2);padding:10px 11px;cursor:pointer;transition:border-color .14s ease,background .14s ease}
.wf-combo-card:hover{border-color:var(--wf-brand)}
.wf-combo-card.is-checked{border-color:var(--wf-brand);background:color-mix(in srgb,var(--wf-brand) 8%,var(--wf-layer-2))}
.wf-combo-card input{flex:none;margin-top:2px;accent-color:var(--wf-brand)}
.wf-combo-card__body{min-width:0;display:flex;flex-direction:column;gap:3px}
.wf-combo-card__name{font-size:12px;font-weight:650;color:var(--wf-ink);word-break:break-all}
.wf-combo-card__desc{font-size:10px;line-height:1.45;color:var(--wf-ink-2);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.wf-combo-card__badge{display:inline-block;align-self:flex-start;padding:1px 6px;border-radius:999px;background:var(--wf-layer);border:1px solid var(--wf-border);font-size:8px;color:var(--wf-ink-2)}
.wf-combo__side{flex:1;min-width:290px;max-width:380px;display:flex;flex-direction:column;overflow:hidden}
.wf-combo__side-head{flex:none;display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--wf-border)}
.wf-combo__side-head h4{margin:0;font-size:12px;color:var(--wf-ink);flex:1}
.wf-combo__side-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:6px;padding:10px 14px;scrollbar-width:thin}
.wf-combo-item{display:flex;align-items:center;gap:8px;text-align:left;border:1px solid var(--wf-border);border-radius:10px;background:var(--wf-layer-2);padding:8px 10px;cursor:pointer}
.wf-combo-item:hover{border-color:var(--wf-brand)}
.wf-combo-item.is-active{border-color:var(--wf-brand);background:color-mix(in srgb,var(--wf-brand) 8%,var(--wf-layer-2))}
.wf-combo-item__label{flex:1;min-width:0;font-size:12px;font-weight:650;color:var(--wf-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wf-combo-item__meta{font-size:9px;color:var(--wf-ink-2)}
.wf-combo__edit{flex:none;display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-top:1px solid var(--wf-border)}
.wf-combo__edit label{display:grid;gap:4px;color:var(--wf-ink-2);font-size:11px}
.wf-combo__edit input{border:1px solid var(--wf-border-strong);border-radius:7px;background:var(--wf-layer-2);color:var(--wf-ink);padding:6px 8px;outline:0}
.wf-combo__edit input:focus{border-color:var(--wf-brand)}
.wf-combo__selection{flex:none;max-height:120px;overflow:auto;display:flex;flex-wrap:wrap;gap:5px;padding:8px 14px;border-top:1px solid var(--wf-border);scrollbar-width:thin}
.wf-combo-chip{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--wf-brand) 10%,var(--wf-layer-2));border:1px solid color-mix(in srgb,var(--wf-brand) 35%,var(--wf-border));font-size:10px;color:var(--wf-ink)}
.wf-combo-chip button{border:0;background:transparent;color:var(--wf-ink-2);cursor:pointer;font-size:10px;line-height:1;padding:0}
.wf-combo-chip button:hover{color:var(--wf-err)}
.wf-combo__side-foot{flex:none;display:flex;gap:7px;padding:10px 14px;border-top:1px solid var(--wf-border)}
.wf-combo__side-foot .wf-btn{flex:1;font-size:11px;padding:6px 10px}
.wf-mcp-form{flex:none;display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-top:1px solid var(--wf-border)}
.wf-mcp-form label{display:grid;gap:4px;color:var(--wf-ink-2);font-size:11px}
.wf-mcp-form input{width:100%;border:1px solid var(--wf-border-strong);border-radius:7px;background:var(--wf-layer-2);color:var(--wf-ink);padding:6px 8px;outline:0}
.wf-mcp-form input:focus{border-color:var(--wf-brand)}
.wf-mcp-form__row{display:flex;gap:6px}
.wf-mcp-form__row .wf-btn{flex:1;font-size:11px;padding:6px 10px}
.wf-combo-hint{flex:none;padding:8px 14px;border-top:1px solid var(--wf-border);font-size:10px;color:var(--wf-ink-2);line-height:1.5}
.wf-service-console{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;padding:8px 12px;border-bottom:1px solid var(--wf-border);background:var(--wf-layer)}
.wf-service-console__head{display:flex;align-items:center;gap:8px;min-width:0;flex:1}
.wf-service-console__head strong{font-size:12px;color:var(--wf-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
.wf-service-console__actions{display:flex;gap:7px;margin-left:auto}
.wf-service-console__debug{flex-basis:100%;display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--wf-border);padding-top:7px}
.wf-service-console__debug-head{display:flex;align-items:center;gap:8px}
.wf-service-console__debug-title{font-size:11px;font-weight:600;color:var(--wf-ink)}
.wf-service-console__input{width:100%;resize:vertical;border:1px solid var(--wf-border-strong);border-radius:7px;background:var(--wf-layer-2);color:var(--wf-ink);padding:6px 8px;outline:0;font:inherit;font-size:12px;min-height:44px;box-sizing:border-box}
.wf-service-console__input:focus{border-color:var(--wf-brand)}
.wf-service-console__debug-actions{display:flex;gap:7px}
.wf-service-console__debug-actions .wf-btn{font-size:11px;padding:4px 10px}
.wf-service-console__output{flex:none;min-height:56px;max-height:200px;overflow:auto;white-space:pre-wrap;word-break:break-word;margin:0;padding:8px;border:1px solid var(--wf-border);border-radius:7px;background:var(--wf-layer-2);color:var(--wf-ink);font:inherit;font-size:12px;line-height:1.6;box-sizing:border-box}
.wf-service-dot{width:9px;height:9px;border-radius:50%;flex:none}
.wf-service-dot.is-running{background:var(--wf-ok);box-shadow:0 0 0 3px color-mix(in srgb,var(--wf-ok) 18%,transparent)}
.wf-service-dot.is-stopped{background:var(--wf-ink-2)}
.wf-service-dot.is-crashed{background:var(--wf-err)}
@media(max-width:1180px){.wf-status{display:none}.wf-titlebar__note{display:none}}
@media(max-width:760px){.wf-toolbar{padding:7px}.wf-tabs{padding:0 10px}.wf-titlebar__badge{display:none}.wf-lib-tab{font-size:10px}.wf-confirm__actions .wf-btn{flex:1}}
`
