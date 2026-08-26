# BUG 清单（前端专项）

## 精准 Bug 表

| 序号 | 风险等级 | 问题类型 | 代码文件 | 位置 | 问题描述 | 影响/未对齐点 |
|------|----------|----------|----------|-----------|----------|---------------|
| 1 | P0 | 逻辑 Bug | `studio-state.ts` | `graphSnapshotOf()` 函数（第 299-301 行） | `graphSnapshotOf` 直接返回 `{ nodes: state.canvas.nodes, edges: state.canvas.edges }`，未对数组进行深拷贝，导致历史栈（past/future）中存储的是当前 canvas 对象的**引用**而非快照副本。后续修改 canvas 会直接修改历史记录中的内容，undo/redo 失效。 | **撤销重做功能完全不可用**：`UNDO` 从 past 中取出的是同一个对象引用，恢复后 canvas 仍指向同一对象，无法回退到历史状态。违反架构文档 §10（Client 半区设计：撤销重做）与需求文档 §4.5.3（画布控制栏：撤销/重做）。 |
| 2 | P1 | 代码质量 | `src/client/studio/Studio.tsx` | 全文（约 550 行） | Studio.tsx 集成了初始化、画布操作、运行控制、服务控制、模式切换、导入导出、键盘事件、拖拽逻辑、UI 渲染等全部职责，函数超过 30 个，内部状态依赖复杂。 | 违反架构文档 §10 "studio.js 拆分：Studio.tsx（布局）+ studio-state.ts（useReducer 状态机）+ hooks/ 目录 13 个 hooks"，实际 Studio.tsx 远超出"布局"范畴，严重违反单一职责原则，测试难以覆盖，维护成本高。 |
| 3 | P1 | 架构未对齐 | `src/client/studio/studio-state.ts` | L112-L115 | `combos: ToolCombo[]`、`presets: unknown[]`、`tools: unknown[]`、`models: unknown[]` 使用了 `unknown[]` 类型，而架构文档 §6.3 定义了明确的 `ToolCombo` 接口。`models` 本应有 `{ provider: string; model: string; efforts?: Array<{ id: string; name: string }> }` 结构，但类型声明为 `unknown[]`，导致 `forms.tsx` 中 `RoleForm` 的 `models` 参数无类型约束。 | 违反架构文档 §6.3 数据模型定义，类型安全完全丧失。 |
| 4 | P1 | 类型安全 | `src/client/hooks/useTemplates.ts` | L35-L37 | `...({ _draft: true } as object)` 将 `_draft` 标记强制断言为 `object`，然后 `as unknown as RoleTemplate` 逃逸了两次类型检查。模板对象在保存时 `_draft` 字段会被传递给后端，但后端契约中无此字段，可能导致后端接收未知字段而忽略或报错。 | 类型逃逸掩盖了数据模型不一致；`_draft` 是前端 UI 状态，不应混入持久化数据。 |
| 5 | P2 | 逻辑 Bug | `src/client/studio/studio-state.ts` | `UNDO`/`REDO` 处理，L295-314 | `UNDO` 和 `REDO` 操作后将 `dirty` 硬编码为 `true`，即使用户连续撤销回到初始保存状态，`dirty` 仍为 `true`，关闭/切换工作流时会误弹"未保存修改"确认框。 | 需求文档 §4.5.9 未保存守卫："切换工作流/切换模式/关闭前存在未保存修改时弹确认框"——已保存状态被误判为未保存，用户体验差。 |
| 6 | P3 | 可维护性 | `src/client/studio/Studio.tsx` | L1075-L1104 | `flowLayout` 纯函数内联在 `Studio.tsx` 底部，但 `lib/graph-model.ts` 中已有 `layoutNodes` 和 `layoutGraph` 函数，此处重新实现了一份布局逻辑（与 `layoutNodes` 高度重复但更简化）。 | 代码重复，布局算法有两份实现，未来维护需同步修改。 |

## 非重复 Bug 表

| 序号 | 风险等级 | 问题类型 | 代码文件 | 位置 | 问题描述 | 影响/未对齐点 |
|------|----------|----------|----------|-----------|----------|---------------|
| 1 | P0 | 需求未对齐 | `src/client/studio/Studio.tsx` | L177-L179 | `templates.loadTemplates()` 仅在 `state.sessionId` 存在时执行（L163 条件包裹）。若用户在无会话（新 DSH 窗口未发送消息）时打开工作台，`sessionId` 为空，`templates.loadTemplates()` 被跳过，导致**内置父代理模板永远无法创建**（L182-L194 的创建逻辑依赖 L177 的 load 完成）。需求 §4.2.3.1 要求"父代理模板在角色 Tab 置顶固定显示"，无会话时用户仍应能看到模板库。 | 违反需求 §4.2.3.1（父代理模板应始终可用），导致新用户首次打开工作台时角色 Tab 为空。 |
| 2 | P1 | 逻辑 Bug | `src/client/studio/Studio.tsx` | `removeSelected()` 函数，L1240-1270 | 删除主节点时弹窗提示虚拟引用数量，但确认回调 `removeNodeNow()` 中未实现虚拟节点级联删除（仅执行 `dispatch({ type: 'NODE_REMOVED', id })`），所有关联虚拟节点未被删除，画布残留孤儿节点。 | 违反需求文档 §4.2.3.2 规则 5："删除主节点时如有其对应的虚拟节点存在，提前弹窗提示……确认后级联删除所有关联虚拟节点。" |
| 3 | P1 | 需求未对齐 | `src/client/studio/Studio.tsx` | 初始化 effect，L192-260 | 初始化逻辑中 `templates.loadTemplates()` 与 `remote.call(EP_LIST_TEMPLATES)` 叠加调用，且内置父代理模板创建后再次调用 `loadTemplates()`，若创建过程中出现网络错误，状态可能部分更新（TEMPLATE_ADDED 已执行但 TEMPLATES_LOADED 覆盖），导致模板列表不一致。 | 需求文档 §4.2.3.1："父代理节点在"角色"Tab 的左侧栏置顶固定显示"；当前实现可能因竞态导致父代理模板重复创建或缺失。架构文档 §4.6 remote/ 端点约定"POST /visual-workflow/<endpoint>，响应 { ok, value / error }"，未规定幂等行为，前端应避免连续调用。 |
| 4 | P1 | 逻辑 Bug | `src/client/studio/studio-state.ts` | `SELECT_EDITOR` / `SELECT_LIB` 处理，L254-258 | 父代理模板点击时，`selectLibraryCard` 中调用了 `selection.selectLib('parentTemplate', id)` 后又调用 `selection.selectEditor(null)`，导致 `state.selection.lib` 被设置为 `{kind:'parentTemplate', id}` 但 `state.editor` 为 `null`，状态不一致。 | 需求文档 §4.2.3.1："父代理模板不可删除（点击无属性显示）"——右侧无显示是符合需求的，但左侧高亮状态与编辑状态未同步可能引发后续操作误判（如保存/删除按钮仍不可用但用户以为已选中）。 |
| 5 | P1 | 逻辑 Bug | `src/client/hooks/usePanelLayout.ts` | `beginResize()` 中的 pointer 事件，L88-130 | 拖拽面板宽度时若鼠标移出浏览器窗口，`pointermove` 事件不再触发，但 `pointerup` 在外部松开鼠标时可能不触发（取决于操作系统），导致 `body.style.cursor` 永久变为 `col-resize`，用户交互异常。 | 交互体验严重受损，用户无法恢复鼠标指针，必须刷新页面。架构文档 §10 要求"面板几何 localStorage 持久化"，未对异常松开场景做兜底处理。 |
| 6 | P1 | 逻辑 Bug | `src/client/components/canvas/GraphCanvas.tsx` | `beginNodeDrag()` 的 onUp 回调，L348-370 | 已属于某协作组的角色节点（`data.groupId` 非空）拖拽到另一个组卡片时，因条件判断 `!((node.data.groupId as string | null | undefined) ?? null)` 而被阻止入组，无法实现"将角色从一个组移到另一个组"的操作。 | 需求文档 §4.2.5.2 规则 1："将角色节点拖入协作组后，形成协作组合，支持拖入多个角色"——未明确禁止移动，但实际场景中用户期望可调整组成员，当前实现限制了灵活性。 |
| 7 | P1 | 状态管理缺陷 | `studio-state.ts` | `UNDO` / `REDO` case（第 221-238 行） | `UNDO`/`REDO` 恢复 canvas 后，`selection`、`editor` 未被清理或验证，可能指向已删除/不存在的节点 ID。 | 选中状态与实际 canvas 不一致，导致键盘删除操作（Delete/Backspace）可能尝试删除不存在的节点，或 `Inspector` 渲染空数据。 |
| 8 | P1 | 需求未对齐 | `hooks/useTemplates.ts` | `loadTemplates()` 函数（第 48-59 行） | 使用 `Promise.all` 并行加载三种模板，任一模板加载失败导致整个 `loadTemplates` 失败，其他类型模板也无法加载。 | 应使用 `Promise.allSettled` 或分别 try-catch，使某类模板加载失败不影响其他类型。违反鲁棒性设计要求。 |
| 9 | P1 | 竞态条件 | `hooks/useRunPolling.ts` | `useEffect` 轮询逻辑（第 19-44 行） | `poll()` 是异步函数，在 `setInterval` 回调中执行 `void poll()`。若组件在 `poll()` 的 `remote.call` 等待期间卸载，`cancelled` 标志被设置为 `true`，但 `poll()` 内部的检查在 `await` 之后，若远程调用恰好在卸载瞬间完成，仍会执行 `dispatch`。 | React 警告 "Can't perform a React state update on an unmounted component"，虽不崩溃但表明存在内存泄漏风险。 |
| 10 | P1 | 空值安全 | `hooks/useTemplates.ts` | `saveTemplate()` 函数（第 70-74 行） | `remote.call` 返回 `saved` 后直接 `dispatch({ type: 'TEMPLATE_UPDATED', kind, template: saved })`，若后端返回 `null` 或非模板对象，`studio-state.ts` 中的 reducer 会尝试用 `null` 替换数组中的模板条目。 | 编辑器数据可能被置为 `null`，导致右侧属性栏崩溃或显示空白。需要增加 `if (!saved) return` 守卫。 |
| 11 | P1 | 内存泄漏 | `src/client/components/canvas/GraphCanvas.tsx` | L168-L176 | `beginConnection` 中的 `onMove`/`onUp` 监听器在组件卸载时未清理（`useEffect` 返回清理函数仅清理了内部闭包，但 `window.addEventListener` 在 `useEffect` 外部注册）。若用户在拖拽连线过程中卸载组件（如快速切换工作流），监听器残留。 | 内存泄漏 + 可能导致状态更新在已卸载组件上执行（React 警告）。 |
| 12 | P1 | 需求未对齐 | `src/client/studio/Studio.tsx` | L786-L798 | `switchMode` 在切换模式时调用 `dispatch({ type: 'CLEAR_CANVAS' })` 清空画布，且仅调用 `workflows.loadWorkflows()` 或 `serviceControl.loadServices()`，但**未清空 `state.editor` 和 `state.selection`**。用户从模式一切换到模式二后，右侧属性栏可能仍显示上一个模式选中对象的编辑器引用，导致点击保存时操作错误的对象。 | 违反需求 §4.1.1 验收标准 1（"画布区域重置为空白画布"且无残留选中状态）。 |
| 13 | P1 | 错误处理 | `src/client/studio/Studio.tsx` | L358-L360 | `stageTemplateKinds(state.mode)` 中 `labels.find()` 可能返回 `undefined`，若 `kind` 不在数组中，`label` 变量为 `undefined`，节点 data.label 被设为 `undefined`。虽然后端校验可能拦截，但前端未做防御。 | 节点展示时 label 为 `undefined`，界面出现"未定义"文本。 |
| 14 | P1 | 逻辑Bug | `src/client/hooks/usePanelLayout.ts` | `onUp` 中宽度处理 | 当 `lastWidth < PANEL_COLLAPSE_THRESHOLD` 时，`finalOpen = false`，但 `lastWidth` 被强制设为 `Math.max(PANEL_COLLAPSE_THRESHOLD, startWidth || remembered || fallback)`，导致面板**关闭但宽度记忆值 ≥ 90px**。下次打开时宽度跳变 | 用户感知：面板关闭后重新打开，宽度非预期的 0 而是 90+ px，体验怪异 |
| 15 | P2 | 需求未对齐 | `src/client/studio/Studio.tsx` + `src/client/components/panels/inspector/Inspector.tsx` | `testDbConnection` 调用链 | 数据库“测试连接”按钮仅在编辑器来源为 `node` 时可用；模板编辑时（`source: 'template'`）按钮存在但点击无响应 | 需求文档 §4.2.4.2 要求数据库节点的“测试连接”功能在**右侧属性栏中**可用，未限定仅画布节点。模板编辑时也应能测试连接 |
| 16 | P2 | 性能问题 | `src/client/studio/Studio.tsx` | L66-L68 | `highlightedNodeIds` 的 `useMemo` 计算后始终返回 `[]`，但仍保留完整依赖与计算逻辑 | 无意义计算，浪费渲染性能；代码表明该功能未完成（原本应高亮与左侧选中模板同源的节点） |
| 17 | P2 | 错误处理 | `src/client/studio/Studio.tsx` | `resolveImportConflict` L748-L760 | 未检查 `state.confirm` 是否为 `null`，直接访问 `confirm.kind` | 理论上 `confirm` 可能为 `null`（虽 UI 条件渲染避免），但类型守卫不完整，存在潜在运行时错误 |
| 18 | P2 | 交互缺陷 | `src/client/studio/Studio.tsx` | `onKeyDown` Escape 处理 L862-L866 | 按下 Escape 键时，若存在 `state.confirm` 则关闭它；若不存在则清除画布选中。但用户在确认框中可能期望按 Esc 取消，但取消后选中也被清除 | 轻微交互混乱：确认框取消后，画布选中也被清除，用户需重新点击节点进行编辑 |
| 19 | P2 | 性能 | `src/client/components/canvas/FlowNode.tsx` | 组件定义，L68 | `FlowNode` 未使用 `React.memo` 包裹，且父组件 `GraphCanvas` 每次重渲染时重新计算 `renderedNodes` 和 `edgeViews`，导致所有节点卡片及连线 SVG 路径全部重新生成。 | 画布节点数 > 50 时，每次状态变更（如移动一个节点）都会触发全部节点重绘，首屏加载和交互响应显著变慢。 |
| 20 | P2 | 代码质量 | `src/client/lib/graph-model.ts` | `templateToNodeData()` 函数，L150-185 | `templateToNodeData` 对于角色模板返回的 `data` 对象中，`groupId` 和 `proxySourceId` 被设为 `null`，但调用方（`placeTemplateNode`/`placeParentNode`）未正确处理这些字段，可能导致节点数据中包含多余的 `null` 字段被序列化到工作流 JSON 中。 | 工作流 JSON 存在冗余字段（虽不影响运行），但长期积累可能污染数据模型。 |
| 21 | P2 | 重复代码 | `src/client/studio/studio-state.ts` | `flowToCanvas()` / `serviceToCanvas()`，L190-220 | 工作流与服务在 client 侧画布投影逻辑完全相同（节点和连线的字段结构一致），但写成了两个独立函数，代码高度重复。 | 违反 DRY 原则，后续若增加字段需同时修改两处，易引入遗漏。 |
| 22 | P2 | 性能/内存 | `src/client/hooks/useRunPolling.ts` | `useEffect`，L30-52 | 轮询定时器在 `runId` 变化时重新创建，但 `poll()` 函数在每次 effect 执行时重新定义，未用 `useCallback` 缓存。若 `runId` 频繁变化（如连续快速启动/停止运行），可能导致旧定时器未被正确清理（`setInterval` 的清理依赖 `clearInterval(timer)` 在 cleanup 中执行，但若 effect 快速重新执行，`timer` 变量可能被覆盖）。 | 潜在内存泄漏风险，极端情况下可能叠加多个轮询定时器。 |
| 23 | P2 | 交互缺失 | `src/client/studio/Studio.tsx` | 各异步操作按钮，L400-600 | 运行、保存、导入、导出等异步操作按钮在操作进行中未设置 `disabled` 状态，用户可重复点击导致多次请求并发。 | 需求文档 §4.5.3 未明确要求禁用状态，但用户体验受损（如导入过程中再次点击导入会触发多个文件选择器）。 |
| 24 | P2 | 错误处理 | `src/client/hooks/useTemplates.ts` | `saveTemplate()` / `deleteTemplate()`，L70-80 | `saveTemplate` 和 `deleteTemplate` 远端调用失败时，已 dispatch 的 `TEMPLATE_ADDED`/`TEMPLATE_REMOVED` 状态变更无法回滚，导致本地状态与后端不一致。 | 用户看到模板列表已更新，但实际保存失败，刷新后数据丢失。 |
| 25 | P2 | 逻辑 Bug | `components/canvas/GraphCanvas.tsx` | `connectionTargetAt()` 函数（第 292-295 行） | 使用 `document.elementFromPoint(clientX, clientY)` 检测悬停目标，在画布有缩放/平移时，屏幕坐标到世界坐标的转换未考虑画布的 `transform` 矩阵，仅用于检测 DOM 元素，实际上元素位置已在 DOM 中通过 `transform` 定位，`elementFromPoint` 工作正常。但若鼠标在组卡片的成员行上悬停，可能错误识别为组节点而非成员节点（因为成员行也是 `data-wf-node-id` 元素）。 | 连线拖拽到协作组卡片时，可能错误将连线目标识别为组节点而非组内成员节点，导致连线连接到组卡片而非成员。 |
| 26 | P2 | 代码质量 | `studio/Studio.tsx` | 多处（约 30+ 处 `as` 类型断言） | 大量使用 `as` 类型断言绕过 TypeScript 检查，如 `as WorkflowDocument`、`as never`、`as CanvasNode`、`as ServiceState` 等。 | 降低类型安全性，隐藏了潜在的运行时类型不匹配问题。 |
| 27 | P2 | 逻辑 Bug | `studio/studio-state.ts` | `flowToCanvas()` 函数（第 126-142 行） | 当 `node.position` 为 `undefined` 时，使用默认 `{ x: 120, y: 80 }`。但 `GraphNode` 类型中 `position` 为必填字段，理论上不应出现 `undefined`。若后端返回的节点缺少 `position`，此兜底逻辑生效。但未处理 `node.data` 为 `undefined` 的情况（`(node as { data?: Record<string, unknown> }).data ?? {}` 已处理）。 | 逻辑正确，但依赖类型断言，可能存在未预见的数据缺失场景。 |
| 28 | P2 | 未清理的副作用 | `components/canvas/GraphCanvas.tsx` | `beginGroupResize()` 函数（第 236-251 行） | `beginGroupResize` 在 `onPointerDown` 中向 `window` 添加 `pointermove`/`pointerup` 监听器，但未在组件卸载时清理这些监听器。若用户在拖拽过程中切换页面/卸载组件，监听器会残留。 | 潜在的内存泄漏和拖拽状态残留。需要使用 `useEffect` 清理或使用 `setPointerCapture` 自动释放。 |
| 29 | P2 | 竞态条件 | `studio/Studio.tsx` | 初始化 `useEffect`（第 155-208 行） | `boot()` 函数中 `templates.loadTemplates()` 和 `enums()` 并行执行，但 `cancelled` 标志只在一个层级检查。如果组件在 `templates.loadTemplates()` 完成前卸载，`cancelled` 变为 `true`，但 `enums()` 可能仍在执行并最终调用 `dispatch`。 | 同上，可能导致 "Can't perform a React state update on an unmounted component" 警告。 |
| 30 | P2 | 交互缺陷 | `components/canvas/GraphCanvas.tsx` | `onUp` 中拖入协作组判定（第 197-210 行） | 拖入协作组的判定仅检查节点是否为 `parent`/`agent` 且 `groupId` 为 `null`。但未检查目标节点是否已在其他组内，也未检查目标组容量（8 人上限）是否已满。虽有后续 `addNodeToGroup` 中的容量检查，但拖拽判定时缺少视觉反馈。 | 用户拖拽角色节点到已满的协作组时，节点仍会移动过去但随后被拒绝，体验不一致。 |
| 31 | P2 | 错误处理 | `src/client/hooks/useRunPolling.ts` | L27-L29 | 轮询中 `catch` 捕获错误后**完全静默**（`// 轮询偶发失败下一轮重试`），未做任何日志上报或降级处理。若后端持续返回 500，用户会看到节点状态卡在"运行中"永不更新。 | 故障静默，用户无法感知轮询失败，误以为流程仍在执行。 |
| 32 | P2 | 逻辑Bug（级联删除状态残留） | `src/client/studio/Studio.tsx` | `removeNodeNow` | 删除主节点并级联删除虚拟节点后，未清除 `selection` 中可能指向已删除虚拟节点的引用 | 用户删除节点后，右侧属性栏可能短暂残留旧数据（直到下次点击） |
| 33 | P3 | 命名规范 | `src/client/studio/Studio.tsx` 及多处组件 | 全局使用 `t` 与 `copy` 两个别名表示 `Dict` | `Studio.tsx` 中 props 为 `t`，`LeftPanel`/`Inspector` 中 props 为 `copy`，不一致 | 增加理解成本，建议统一为 `i18n` 或 `dict` |
| 34 | P3 | 注释规范 | 多个文件 | - | 部分复杂函数缺少 JSDoc 注释，如 `connectionProblem`（graph-model.ts）、`layoutNodes`（graph-model.ts）、`editorDataOf`（studio-state.ts）等，其内部算法逻辑（拓扑排序、连接校验等）未说明"为什么"这么实现。 | 架构文档 §13.3 要求"关键时序/协议处注释必须说明'为什么'"，当前注释偏少，影响后续维护。 |
| 35 | P3 | 类型安全 | `src/client/lib/remote.ts` | `remoteCall()` 返回值，L18-28 | `remoteCall` 的返回值类型为 `Promise<unknown>`，调用方均使用 `as` 断言强制转换为期望类型（如 `as WorkflowDocument[]`），未使用类型守卫或运行时校验，可能掩盖后端数据结构变更。 | 当后端接口变更时，前端不会在编译期感知，可能引发运行时静默错误。 |
| 36 | P3 | 代码质量 | `hooks/useRemote.ts` | 整个文件（7 行） | `useRemote` hook 仅包装 `remoteCall` 纯函数，未提供任何额外功能（如请求去重、缓存、错误重试等）。 | 此 hook 存在意义不大，可直接在组件中导入 `remoteCall` 使用，减少一层抽象。 |
| 37 | P3 | 性能建议 | `studio/Studio.tsx` | `modeName` 回调（第 224-236 行） | `modeName` 在每次渲染时遍历 `state.presets` 和 `state.combos` 查找匹配项，未使用 `useMemo` 缓存。 | 在属性面板中频繁调用时产生不必要的查找开销。 |
| 38 | P3 | 最佳实践 | `hooks/useGraphHistory.ts` | `remember` 中的依赖项（第 17 行） | `useCallback` 的依赖项包含 `state` 对象，每次 `state` 变化都会重新创建 `remember` 函数。 | 由于 `state` 是 reducer 状态，每次 dispatch 都会产生新对象，导致 `remember` 频繁重建，可能引起子组件不必要的重渲染。建议使用 `useRef` + 最新值模式，或拆分依赖为具体字段。 |
| 39 | P3 | 代码风格 | `src/client/lib/graph-model.ts` | L90-L98 | `templateToNodeData` 返回 `Record<string, unknown> | null`，但调用方 `Studio.tsx` L353 中 `const data = templateToNodeData(kind, template) ?? {}`，若返回 `null` 则使用空对象，**丢失了模板的 name 字段**（空对象导致节点 label 为空）。 | 虽不会导致崩溃，但节点名称为空，用户需手动填写。 |
| 40 | P3 | 类型定义 | `src/client/types.d.ts` | L5-L17 | `*.module.css` 和 `*.css` 声明了空模块，但项目实际使用 `styles.ts` 中的 CSS-in-JS（模板字符串）和 `entry.css` 全局 CSS，并未使用 CSS Modules。`types.d.ts` 中的声明是死代码，仅保留以备未来使用。 | 死代码增加混淆，建议移除或注释说明。 |

## 冲突声明表

| 序号 | 风险等级 | 问题类型 | 代码文件 | 位置 | 问题描述 | 影响/未对齐点 |
|------|----------|----------|----------|-----------|----------|---------------|
| 1 | P1 | 逻辑 Bug | `src/client/studio/Studio.tsx` | `removeSelected()` 函数，L1240-1270 | 删除主节点时弹窗提示虚拟引用数量，但确认回调 `removeNodeNow()` 中未实现虚拟节点级联删除（仅执行 `dispatch({ type: 'NODE_REMOVED', id })`），所有关联虚拟节点未被删除，画布残留孤儿节点。 | 违反需求文档 §4.2.3.2 规则 5："删除主节点时如有其对应的虚拟节点存在，提前弹窗提示……确认后级联删除所有关联虚拟节点。" |
| 2 | P2 | 逻辑Bug（级联删除状态残留） | `src/client/studio/Studio.tsx` | `removeNodeNow` | 删除主节点并级联删除虚拟节点后，未清除 `selection` 中可能指向已删除虚拟节点的引用 | 用户删除节点后，右侧属性栏可能短暂残留旧数据（直到下次点击） |

**冲突点**：条目 1 声称 `removeNodeNow` 中**未实现**虚拟节点级联删除，导致孤儿节点残留；条目 2 则基于“级联删除虚拟节点后”的假设，指出未清除 `selection` 引用。两者对同一函数是否已实现级联删除的描述相互矛盾。

| 序号 | 风险等级 | 问题类型 | 代码文件 | 位置 | 问题描述 | 影响/未对齐点 |
|------|----------|----------|----------|-----------|----------|---------------|
| 3 | P1 | 逻辑 Bug | `src/client/components/canvas/GraphCanvas.tsx` | `beginNodeDrag()` 的 onUp 回调，L348-370 | 已属于某协作组的角色节点（`data.groupId` 非空）拖拽到另一个组卡片时，因条件判断 `!((node.data.groupId as string | null | undefined) ?? null)` 而被阻止入组，无法实现"将角色从一个组移到另一个组"的操作。 | 需求文档 §4.2.5.2 规则 1："将角色节点拖入协作组后，形成协作组合，支持拖入多个角色"——未明确禁止移动，但实际场景中用户期望可调整组成员，当前实现限制了灵活性。 |
| 4 | P2 | 交互缺陷 | `components/canvas/GraphCanvas.tsx` | `onUp` 中拖入协作组判定（第 197-210 行） | 拖入协作组的判定仅检查节点是否为 `parent`/`agent` 且 `groupId` 为 `null`。但未检查目标节点是否已在其他组内，也未检查目标组容量（8 人上限）是否已满。虽有后续 `addNodeToGroup` 中的容量检查，但拖拽判定时缺少视觉反馈。 | 用户拖拽角色节点到已满的协作组时，节点仍会移动过去但随后被拒绝，体验不一致。 |

**冲突点**：条目 3 声称已属于协作组的节点拖拽到其他组时**被条件判断阻止**，无法移动；条目 4 声称拖入判定**未检查节点是否已在其他组内**，意味着可能允许移动（或至少未做限制）。两者对同一拖拽逻辑是否限制已属组节点移动的描述相反。


