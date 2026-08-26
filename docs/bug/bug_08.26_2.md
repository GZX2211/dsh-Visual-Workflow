# BUG 清单（全仓库通审）

## 精准 Bug 表

| 序号 | 风险等级 | 问题类型 | 代码文件 | 位置 | 问题描述 | 影响/未对齐点 |
|------|----------|----------|----------|-----------|----------|---------------|
| 1 | P0 | 安全 | `remote/api.ts` | `runStatus` / `runStop` / `runResume` | 仅接受 runId，无 sessionId 归属校验 | 任意会话可查询/停止/恢复其他会话运行 |
| 2 | P0 | 安全 | `remote/api.ts` | `serviceStart` / `serviceStop` / `serviceStatus` | 仅接受 serviceId，无 sessionId 归属校验 | 任意会话可启动/停止/查看其他会话服务 |
| 3 | P0 | 并发安全/分布式锁缺失 | `src/host/orchestrator/runtime.ts` | L73-L77（`runs` Map）、L161-L187（`startRun` 运行锁检查） | 多用户/多会话并发对同一 `flowId` 调用 `startRun`：`flowLockInfo` 遍历 `runs` Map（内存 Map）查锁；`runs` Map 无并发锁（`Map` 操作在 Node.js 中非原子）。两个请求同时 `flowLockInfo` 均返回 `null`，随后均创建 `RunEntry` 并写入 `runs` Map，产生同工作流双运行竞争。 | 双运行导致状态机混乱、磁盘记录冲突、父代理编排指令互相覆盖；P0 级数据不一致。 |
| 4 | P0 | 逻辑 Bug | `studio-state.ts` | `graphSnapshotOf()` 函数（第 299-301 行） | `graphSnapshotOf` 直接返回 `{ nodes: state.canvas.nodes, edges: state.canvas.edges }`，未对数组进行深拷贝，导致历史栈（past/future）中存储的是当前 canvas 对象的**引用**而非快照副本。后续修改 canvas 会直接修改历史记录中的内容，undo/redo 失效。 | **撤销重做功能完全不可用**：`UNDO` 从 past 中取出的是同一个对象引用，恢复后 canvas 仍指向同一对象，无法回退到历史状态。违反架构文档 §10（Client 半区设计：撤销重做）与需求文档 §4.5.3（画布控制栏：撤销/重做）。 |
| 5 | P1 | 代码质量 | `src/client/studio/Studio.tsx` | 全文（约 550 行） | Studio.tsx 集成了初始化、画布操作、运行控制、服务控制、模式切换、导入导出、键盘事件、拖拽逻辑、UI 渲染等全部职责，函数超过 30 个，内部状态依赖复杂。 | 违反架构文档 §10 "studio.js 拆分：Studio.tsx（布局）+ studio-state.ts（useReducer 状态机）+ hooks/ 目录 13 个 hooks"，实际 Studio.tsx 远超出"布局"范畴，严重违反单一职责原则，测试难以覆盖，维护成本高。 |
| 6 | P1 | 架构未对齐 | `src/client/studio/studio-state.ts` | L112-L115 | `combos: ToolCombo[]`、`presets: unknown[]`、`tools: unknown[]`、`models: unknown[]` 使用了 `unknown[]` 类型，而架构文档 §6.3 定义了明确的 `ToolCombo` 接口。`models` 本应有 `{ provider: string; model: string; efforts?: Array<{ id: string; name: string }> }` 结构，但类型声明为 `unknown[]`，导致 `forms.tsx` 中 `RoleForm` 的 `models` 参数无类型约束。 | 违反架构文档 §6.3 数据模型定义，类型安全完全丧失。 |
| 7 | P1 | 类型安全 | `src/client/hooks/useTemplates.ts` | L35-L37 | `...({ _draft: true } as object)` 将 `_draft` 标记强制断言为 `object`，然后 `as unknown as RoleTemplate` 逃逸了两次类型检查。模板对象在保存时 `_draft` 字段会被传递给后端，但后端契约中无此字段，可能导致后端接收未知字段而忽略或报错。 | 类型逃逸掩盖了数据模型不一致；`_draft` 是前端 UI 状态，不应混入持久化数据。 |
| 8 | P1 | 并发安全/乐观锁冲突 | `src/host/storage/flow-store.ts` | L152-L169（`saveWorkflow`） | `withJsonLock` 保证同文件串行，但 `nextFlowRevision` 使用 `expectedRevision` 校验。前端 `saveWorkflow` 传入的 `flow.revision` 是内存中的旧值，保存成功后 `dispatch WORKFLOW_UPDATED` 更新为服务端返回的新 revision。若 `dispatch` 前前端再次触发保存（如双击保存按钮），则第二次保存携带的 `revision` 仍是旧值，引发 `FlowRevisionConflictError`。 | 乐观锁正确工作，但前端未对并发保存做防抖/节流，用户快速双击保存按钮会导致第二次保存失败（用户体验差）。 |
| 9 | P1 | 死锁 | `orchestrator/runtime.ts` | `wfRunNode` wait L465-L485 | childIndex 晚于 `startContinuable` 设置，极快子代理完成时 `subagent/end` 错过，waiter 永久挂起 | 模式二 wait:true 死锁 |
| 10 | P1 | 并发竞态 | `service/sessions-map.ts` | `ensure` L50-L56 | 不同 userId 并发 resolve 时映射互相覆盖 | 会话映射丢失，用户上下文断裂 |

---

| 11 | P1 | 并发竞态 | `service/manager.ts` | `start` L140-L160 | `children.has` 与 `children.set` 之间多个 await | 并发启动产生孤儿进程 + 端口泄漏 |
| 12 | P1 | 稳定性 | `service/manager.ts` | `start` L198-L199 | persistRuntime 失败后子进程已启动但状态未更新 | 用户看到启动失败但进程存活 |
| 13 | P1 | 并发 | `storage/atomic.ts` | `cleanupStaleTemp` L336-L355 | 无差别删除 .tmp 前缀文件 | 并发写不同文件时误删他人临时文件 |
| 14 | P1 | 安全 | `flow-store.ts` | `listRuns` L280-L293 | 仅按 flowId 过滤，无 sessionId | 跨会话运行历史泄露 |
| 15 | P1 | 数据丢失 | `graph/validate.ts` | `normalizeFlow` file 分支 | 丢失 files 多选字段 | 保存后多选文件数据丢失 |
| 16 | P1 | 数据完整性 | `remote/transfer.ts` | `exportWorkflowBundle` L62-L84 | 导出 bundle 缺 roles/files/databases | 导入后模板库缺失，违反架构文档 §6.4 |
| 17 | P2 | 逻辑 Bug | `src/client/studio/studio-state.ts` | `UNDO`/`REDO` 处理，L295-314 | `UNDO` 和 `REDO` 操作后将 `dirty` 硬编码为 `true`，即使用户连续撤销回到初始保存状态，`dirty` 仍为 `true`，关闭/切换工作流时会误弹"未保存修改"确认框。 | 需求文档 §4.5.9 未保存守卫："切换工作流/切换模式/关闭前存在未保存修改时弹确认框"——已保存状态被误判为未保存，用户体验差。 |
| 18 | P2 | 性能问题 | `src/client/studio/Studio.tsx` | L66-L68 | `highlightedNodeIds` 的 `useMemo` 计算后始终返回 `[]`，但仍保留完整依赖与计算逻辑 | 无意义计算，浪费渲染性能；代码表明该功能未完成（原本应高亮与左侧选中模板同源的节点） |
| 19 | P2 | 引擎逻辑 | `orchestrator/runtime.ts` | `handleSubagentEnd` L544 | max-tokens 视为成功 | 截断输出被标记 ok |
| 20 | P2 | 引擎逻辑 | `orchestrator/runtime.ts` | `currentResolvedFlow` L705-L711 | mode2 依赖隐式回退 | flowId 冲突时读错文档 |
| 21 | P2 | 断点恢复 | `orchestrator/resume.ts` | L66-L72 | interrupted 恢复无 resumeFromNodeId | 恢复起点不明确 |
| 22 | P2 | 稳定性 | `service/openai-api.ts` | `runChat` L181-L196 | 无限轮询无 5 分钟超时 | 违反需求 §5 SSE 超时 |
| 23 | P2 | 稳定性 | `service/openai-api.ts` | `streamResponse` L223-L243 | 未监听客户端断开 | 恶意客户端耗尽并发槽 |
| 24 | P2 | 安全 | `tools/data-tools.ts` | `sanitizeReadOnlySql` L66-L75 | LIMIT 无上限 | 大表可被全扫 |
| 25 | P3 | 可维护性 | `src/client/studio/Studio.tsx` | L1075-L1104 | `flowLayout` 纯函数内联在 `Studio.tsx` 底部，但 `lib/graph-model.ts` 中已有 `layoutNodes` 和 `layoutGraph` 函数，此处重新实现了一份布局逻辑（与 `layoutNodes` 高度重复但更简化）。 | 代码重复，布局算法有两份实现，未来维护需同步修改。 |
| 26 | P3 | 代码质量 | `flow-store.ts` | `templateToNode` | 丢失 systemPromptSource；fileName 取 basename | 模板字段丢失 |
| 27 | P3 | 引擎逻辑 | `validate.ts` | - | 幽灵组员未报错 | 节点声明 groupId 但组不存在 |

## 非重复 Bug 表

| 序号 | 风险等级 | 问题类型 | 代码文件 | 位置 | 问题描述 | 影响/未对齐点 |
|------|----------|----------|----------|-----------|----------|---------------|
| 1 | P0 | 需求未对齐 | `src/client/studio/Studio.tsx` | L177-L179 | `templates.loadTemplates()` 仅在 `state.sessionId` 存在时执行（L163 条件包裹）。若用户在无会话（新 DSH 窗口未发送消息）时打开工作台，`sessionId` 为空，`templates.loadTemplates()` 被跳过，导致**内置父代理模板永远无法创建**（L182-L194 的创建逻辑依赖 L177 的 load 完成）。需求 §4.2.3.1 要求"父代理模板在角色 Tab 置顶固定显示"，无会话时用户仍应能看到模板库。 | 违反需求 §4.2.3.1（父代理模板应始终可用），导致新用户首次打开工作台时角色 Tab 为空。 |
| 2 | P0 | 编译阻塞 | `src/client/styles.ts` | - | 文件内容为 CSS 注释，无 `export const styles` 导出。`entry.ts` 中 `import { styles } from './styles.js'` 将因找不到导出而编译失败 | 前端构建失败 |
| 3 | P0 | 契约冲突 | `Studio.tsx` `copyToProxy` + `studio-state.ts` `flowToCanvas` + `useWorkflows.ts` `serializeWorkflow` | - | 虚拟节点 `proxySourceId` 在创建时正确置于顶层，但 `flowToCanvas` 投影和序列化均只复制 `id/kind/position/data`，导致打开工作流后 `proxySourceId` 静默丢失，保存后后端 `validateFlow` 报 `proxySourceMissing` | 虚拟节点功能全链路不可用 |
| 4 | P0 | 契约冲突 | `ServiceConsole.tsx` | `sendDebug` L75-L88 | SSE 解析字段路径错误：后端 `sseChunk` 返回 `choices[0].delta.content`，前端解析 `parsed.delta?.content` | 调试台流式输出永远为空 |
| 5 | P1 | 逻辑 Bug | `src/client/studio/Studio.tsx` | `removeSelected()` 函数，L1240-1270 | 删除主节点时弹窗提示虚拟引用数量，但确认回调 `removeNodeNow()` 中未实现虚拟节点级联删除（仅执行 `dispatch({ type: 'NODE_REMOVED', id })`），所有关联虚拟节点未被删除，画布残留孤儿节点。 | 违反需求文档 §4.2.3.2 规则 5："删除主节点时如有其对应的虚拟节点存在，提前弹窗提示……确认后级联删除所有关联虚拟节点。" |
| 6 | P1 | 需求未对齐 | `src/client/studio/Studio.tsx` | 初始化 effect，L192-260 | 初始化逻辑中 `templates.loadTemplates()` 与 `remote.call(EP_LIST_TEMPLATES)` 叠加调用，且内置父代理模板创建后再次调用 `loadTemplates()`，若创建过程中出现网络错误，状态可能部分更新（TEMPLATE_ADDED 已执行但 TEMPLATES_LOADED 覆盖），导致模板列表不一致。 | 需求文档 §4.2.3.1："父代理节点在"角色"Tab 的左侧栏置顶固定显示"；当前实现可能因竞态导致父代理模板重复创建或缺失。架构文档 §4.6 remote/ 端点约定"POST /visual-workflow/<endpoint>，响应 { ok, value / error }"，未规定幂等行为，前端应避免连续调用。 |
| 7 | P1 | 逻辑 Bug | `src/client/studio/studio-state.ts` | `SELECT_EDITOR` / `SELECT_LIB` 处理，L254-258 | 父代理模板点击时，`selectLibraryCard` 中调用了 `selection.selectLib('parentTemplate', id)` 后又调用 `selection.selectEditor(null)`，导致 `state.selection.lib` 被设置为 `{kind:'parentTemplate', id}` 但 `state.editor` 为 `null`，状态不一致。 | 需求文档 §4.2.3.1："父代理模板不可删除（点击无属性显示）"——右侧无显示是符合需求的，但左侧高亮状态与编辑状态未同步可能引发后续操作误判（如保存/删除按钮仍不可用但用户以为已选中）。 |
| 8 | P1 | 逻辑 Bug | `src/client/hooks/usePanelLayout.ts` | `beginResize()` 中的 pointer 事件，L88-130 | 拖拽面板宽度时若鼠标移出浏览器窗口，`pointermove` 事件不再触发，但 `pointerup` 在外部松开鼠标时可能不触发（取决于操作系统），导致 `body.style.cursor` 永久变为 `col-resize`，用户交互异常。 | 交互体验严重受损，用户无法恢复鼠标指针，必须刷新页面。架构文档 §10 要求"面板几何 localStorage 持久化"，未对异常松开场景做兜底处理。 |
| 9 | P1 | 逻辑 Bug | `src/client/components/canvas/GraphCanvas.tsx` | `beginNodeDrag()` 的 onUp 回调，L348-370 | 已属于某协作组的角色节点（`data.groupId` 非空）拖拽到另一个组卡片时，因条件判断 `!((node.data.groupId as string | null | undefined) ?? null)` 而被阻止入组，无法实现"将角色从一个组移到另一个组"的操作。 | 需求文档 §4.2.5.2 规则 1："将角色节点拖入协作组后，形成协作组合，支持拖入多个角色"——未明确禁止移动，但实际场景中用户期望可调整组成员，当前实现限制了灵活性。 |
| 10 | P1 | 状态管理缺陷 | `studio-state.ts` | `UNDO` / `REDO` case（第 221-238 行） | `UNDO`/`REDO` 恢复 canvas 后，`selection`、`editor` 未被清理或验证，可能指向已删除/不存在的节点 ID。 | 选中状态与实际 canvas 不一致，导致键盘删除操作（Delete/Backspace）可能尝试删除不存在的节点，或 `Inspector` 渲染空数据。 |
| 11 | P1 | 需求未对齐 | `hooks/useTemplates.ts` | `loadTemplates()` 函数（第 48-59 行） | 使用 `Promise.all` 并行加载三种模板，任一模板加载失败导致整个 `loadTemplates` 失败，其他类型模板也无法加载。 | 应使用 `Promise.allSettled` 或分别 try-catch，使某类模板加载失败不影响其他类型。违反鲁棒性设计要求。 |
| 12 | P1 | 竞态条件 | `hooks/useRunPolling.ts` | `useEffect` 轮询逻辑（第 19-44 行） | `poll()` 是异步函数，在 `setInterval` 回调中执行 `void poll()`。若组件在 `poll()` 的 `remote.call` 等待期间卸载，`cancelled` 标志被设置为 `true`，但 `poll()` 内部的检查在 `await` 之后，若远程调用恰好在卸载瞬间完成，仍会执行 `dispatch`。 | React 警告 "Can't perform a React state update on an unmounted component"，虽不崩溃但表明存在内存泄漏风险。 |
| 13 | P1 | 空值安全 | `hooks/useTemplates.ts` | `saveTemplate()` 函数（第 70-74 行） | `remote.call` 返回 `saved` 后直接 `dispatch({ type: 'TEMPLATE_UPDATED', kind, template: saved })`，若后端返回 `null` 或非模板对象，`studio-state.ts` 中的 reducer 会尝试用 `null` 替换数组中的模板条目。 | 编辑器数据可能被置为 `null`，导致右侧属性栏崩溃或显示空白。需要增加 `if (!saved) return` 守卫。 |
| 14 | P1 | 内存泄漏 | `src/client/components/canvas/GraphCanvas.tsx` | L168-L176 | `beginConnection` 中的 `onMove`/`onUp` 监听器在组件卸载时未清理（`useEffect` 返回清理函数仅清理了内部闭包，但 `window.addEventListener` 在 `useEffect` 外部注册）。若用户在拖拽连线过程中卸载组件（如快速切换工作流），监听器残留。 | 内存泄漏 + 可能导致状态更新在已卸载组件上执行（React 警告）。 |
| 15 | P1 | 需求未对齐 | `src/client/studio/Studio.tsx` | L786-L798 | `switchMode` 在切换模式时调用 `dispatch({ type: 'CLEAR_CANVAS' })` 清空画布，且仅调用 `workflows.loadWorkflows()` 或 `serviceControl.loadServices()`，但**未清空 `state.editor` 和 `state.selection`**。用户从模式一切换到模式二后，右侧属性栏可能仍显示上一个模式选中对象的编辑器引用，导致点击保存时操作错误的对象。 | 违反需求 §4.1.1 验收标准 1（"画布区域重置为空白画布"且无残留选中状态）。 |
| 16 | P1 | 错误处理 | `src/client/studio/Studio.tsx` | L358-L360 | `stageTemplateKinds(state.mode)` 中 `labels.find()` 可能返回 `undefined`，若 `kind` 不在数组中，`label` 变量为 `undefined`，节点 data.label 被设为 `undefined`。虽然后端校验可能拦截，但前端未做防御。 | 节点展示时 label 为 `undefined`，界面出现"未定义"文本。 |
| 17 | P1 | 逻辑Bug | `src/client/hooks/usePanelLayout.ts` | `onUp` 中宽度处理 | 当 `lastWidth < PANEL_COLLAPSE_THRESHOLD` 时，`finalOpen = false`，但 `lastWidth` 被强制设为 `Math.max(PANEL_COLLAPSE_THRESHOLD, startWidth || remembered || fallback)`，导致面板**关闭但宽度记忆值 ≥ 90px**。下次打开时宽度跳变 | 用户感知：面板关闭后重新打开，宽度非预期的 0 而是 90+ px，体验怪异 |
| 18 | P1 | 数据污染（浅拷贝） | `src/client/hooks/useWorkflows.ts` | L52-L60（`serializeWorkflow`） | 前端画布数据 → `serializeWorkflow` 直接引用 `nodes`/`edges` 数组 → 后端 `saveWorkflow` 接收后 `stripClientMeta` 浅拷贝 → 磁盘写入 JSON。因未深拷贝，前端后续修改 `nodes` 会污染已序列化对象（虽不直接写盘，但 `saveWorkflow` 的 `serialized` 对象与前端 `state.canvas.nodes` 共享引用），导致异常行为。 | `stripClientMeta` 是浅拷贝，`nodes` 数组内部的节点对象未被克隆；`saveWorkflow` 在 `withJsonLock` 中 `atomicWriteJson` 时若引用被前端修改，写入内容可能处于不一致状态。 |
| 19 | P1 | 数据一致性/脏数据 | `src/host/orchestrator/runtime.ts` | L598-L602（`wfFinish` 幂等判定） | `wfFinish` 收尾时，内存 `runs` 表删除终态条目后，`activeRunForSession` 查询不到任何运行，但磁盘仍有该 run 的 `paused` 记录；用户后续点击「恢复」时，`findResumableRun` 可能读到磁盘历史并成功恢复，导致同一 run 被恢复两次（一次收尾、一次续跑）。 | 终态 run 从内存释放后，磁盘状态未同步更新为 `completed`/`failed`；恢复逻辑依赖磁盘状态，可能回滚已收尾的运行。 |
| 20 | P1 | 契约不一致/错误码映射 | `src/client/lib/remote.ts` + `src/host/remote/api.ts` | 前端 L28-L30、后端 L206-L209 | 后端 `HttpError` 的 `code` 字段（如 `FLOW_REVISION_CONFLICT`、`WF_LOCKED`）在响应中序列化为 `{ ok: false, error: { message, code } }`，但前端 `remoteCall` 仅抛出 `Error(message)`，丢弃了 `code` 字段。前端无法根据错误码做分支（如 409 冲突时自动刷新，而非仅 Toast 提示）。 | 前端错误处理退化：所有后端错误均显示为通用错误消息，无法针对性引导用户（如 revision 冲突时自动重新加载）。 |
| 21 | P1 | 逻辑Bug（状态不一致） | `src/client/hooks/useWorkflows.ts` | L75-L85 (`saveWorkflow`) | 前端在 `createWorkflowDraft` 中创建带 `_draft: true` 标记的草稿 → `saveWorkflow` 将 `serialized`（含 `_draft`）发送至后端 → 后端 `api.ts` `putWorkflow` 调用 `stripClientMeta` 移除 `_draft` → 保存成功，返回的 `saved` 对象无 `_draft` 标记 → 前端用 `saved` 更新 `state.workflows`，但 `saved` 可能**缺少原草稿的某些前端临时字段**（如 `_clientMeta`）。 | 草稿保存后，前端状态中的工作流对象被替换为后端返回的“干净”对象，可能丢失前端专属的标记或元数据，导致后续操作（如再次保存、删除）行为异常。 |
| 22 | P1 | 数据污染 | `useServiceControl.ts` | `startService`/`stopService` L62-L74 | 后端 `manager.start()` 返回 `{serviceId,status,port,pid}`，前端 cast 为 `ServiceState` 后 `SERVICE_UPDATED` 整体替换列表项 | 服务列表项被残缺对象污染，nodes/lines/revision 丢失 |
| 23 | P1 | 资源泄漏 | `orchestrator/runtime.ts` | `handleSubagentEnd` L530-L558 | childIndex 永不清理 | 内存增长 + 已结束子代理仍可被 ask 目标 |
| 24 | P1 | 安全 | `shared/types.ts` + `flow-store.ts` | - | 数据库密码明文落盘 | 敏感凭证明文存储 |
| 25 | P1 | 资源泄漏 | `agent/runner.ts` | `ensureNodeChild` L370-L384 | 子代理重建旧 childId 未清理 | 内存泄漏 + 孤儿子代理累积 |
| 26 | P1 | 架构未对齐 | `agent/runner.ts` | `resolveAgentTools` | 白名单未验证 ⊆ 父代理工具集 | 子代理可获得父代理工具集之外工具 |
| 27 | P1 | 架构未对齐 | `agent/runner.ts` | `ensureNodeChild` L350-L368 | 空白名单不传 toolFilter 导致继承全部工具 | 子代理可获 wf_run_node/wf_finish |
| 28 | P1 | 契约冲突 | `lib/graph-model.ts` + `FlowNode.tsx` | `nodeHandles` | start/end 的 ctx 连接点在两处被裁剪，与后端 `NODE_HANDLES` 冲突 | 模式二下无法创建输入→下游 ctx 连线、父代理→输出 ctx 连线 |
| 29 | P1 | 状态丢失 | `useRunPolling.ts` | L31-L35 | 终态后 `RUN_CLEARED` 清除 snapshot，画布高亮与节点状态徽标消失 | 违反需求 §4.5 规则 8“运行状态实时回显” |
| 30 | P2 | 需求未对齐 | `src/client/studio/Studio.tsx` + `src/client/components/panels/inspector/Inspector.tsx` | `testDbConnection` 调用链 | 数据库“测试连接”按钮仅在编辑器来源为 `node` 时可用；模板编辑时（`source: 'template'`）按钮存在但点击无响应 | 需求文档 §4.2.4.2 要求数据库节点的“测试连接”功能在**右侧属性栏中**可用，未限定仅画布节点。模板编辑时也应能测试连接 |
| 31 | P2 | 错误处理 | `src/client/studio/Studio.tsx` | `resolveImportConflict` L748-L760 | 未检查 `state.confirm` 是否为 `null`，直接访问 `confirm.kind` | 理论上 `confirm` 可能为 `null`（虽 UI 条件渲染避免），但类型守卫不完整，存在潜在运行时错误 |
| 32 | P2 | 交互缺陷 | `src/client/studio/Studio.tsx` | `onKeyDown` Escape 处理 L862-L866 | 按下 Escape 键时，若存在 `state.confirm` 则关闭它；若不存在则清除画布选中。但用户在确认框中可能期望按 Esc 取消，但取消后选中也被清除 | 轻微交互混乱：确认框取消后，画布选中也被清除，用户需重新点击节点进行编辑 |
| 33 | P2 | 性能 | `src/client/components/canvas/FlowNode.tsx` | 组件定义，L68 | `FlowNode` 未使用 `React.memo` 包裹，且父组件 `GraphCanvas` 每次重渲染时重新计算 `renderedNodes` 和 `edgeViews`，导致所有节点卡片及连线 SVG 路径全部重新生成。 | 画布节点数 > 50 时，每次状态变更（如移动一个节点）都会触发全部节点重绘，首屏加载和交互响应显著变慢。 |
| 34 | P2 | 代码质量 | `src/client/lib/graph-model.ts` | `templateToNodeData()` 函数，L150-185 | `templateToNodeData` 对于角色模板返回的 `data` 对象中，`groupId` 和 `proxySourceId` 被设为 `null`，但调用方（`placeTemplateNode`/`placeParentNode`）未正确处理这些字段，可能导致节点数据中包含多余的 `null` 字段被序列化到工作流 JSON 中。 | 工作流 JSON 存在冗余字段（虽不影响运行），但长期积累可能污染数据模型。 |
| 35 | P2 | 重复代码 | `src/client/studio/studio-state.ts` | `flowToCanvas()` / `serviceToCanvas()`，L190-220 | 工作流与服务在 client 侧画布投影逻辑完全相同（节点和连线的字段结构一致），但写成了两个独立函数，代码高度重复。 | 违反 DRY 原则，后续若增加字段需同时修改两处，易引入遗漏。 |
| 36 | P2 | 性能/内存 | `src/client/hooks/useRunPolling.ts` | `useEffect`，L30-52 | 轮询定时器在 `runId` 变化时重新创建，但 `poll()` 函数在每次 effect 执行时重新定义，未用 `useCallback` 缓存。若 `runId` 频繁变化（如连续快速启动/停止运行），可能导致旧定时器未被正确清理（`setInterval` 的清理依赖 `clearInterval(timer)` 在 cleanup 中执行，但若 effect 快速重新执行，`timer` 变量可能被覆盖）。 | 潜在内存泄漏风险，极端情况下可能叠加多个轮询定时器。 |
| 37 | P2 | 交互缺失 | `src/client/studio/Studio.tsx` | 各异步操作按钮，L400-600 | 运行、保存、导入、导出等异步操作按钮在操作进行中未设置 `disabled` 状态，用户可重复点击导致多次请求并发。 | 需求文档 §4.5.3 未明确要求禁用状态，但用户体验受损（如导入过程中再次点击导入会触发多个文件选择器）。 |
| 38 | P2 | 错误处理 | `src/client/hooks/useTemplates.ts` | `saveTemplate()` / `deleteTemplate()`，L70-80 | `saveTemplate` 和 `deleteTemplate` 远端调用失败时，已 dispatch 的 `TEMPLATE_ADDED`/`TEMPLATE_REMOVED` 状态变更无法回滚，导致本地状态与后端不一致。 | 用户看到模板列表已更新，但实际保存失败，刷新后数据丢失。 |
| 39 | P2 | 逻辑 Bug | `components/canvas/GraphCanvas.tsx` | `connectionTargetAt()` 函数（第 292-295 行） | 使用 `document.elementFromPoint(clientX, clientY)` 检测悬停目标，在画布有缩放/平移时，屏幕坐标到世界坐标的转换未考虑画布的 `transform` 矩阵，仅用于检测 DOM 元素，实际上元素位置已在 DOM 中通过 `transform` 定位，`elementFromPoint` 工作正常。但若鼠标在组卡片的成员行上悬停，可能错误识别为组节点而非成员节点（因为成员行也是 `data-wf-node-id` 元素）。 | 连线拖拽到协作组卡片时，可能错误将连线目标识别为组节点而非组内成员节点，导致连线连接到组卡片而非成员。 |
| 40 | P2 | 代码质量 | `studio/Studio.tsx` | 多处（约 30+ 处 `as` 类型断言） | 大量使用 `as` 类型断言绕过 TypeScript 检查，如 `as WorkflowDocument`、`as never`、`as CanvasNode`、`as ServiceState` 等。 | 降低类型安全性，隐藏了潜在的运行时类型不匹配问题。 |
| 41 | P2 | 逻辑 Bug | `studio/studio-state.ts` | `flowToCanvas()` 函数（第 126-142 行） | 当 `node.position` 为 `undefined` 时，使用默认 `{ x: 120, y: 80 }`。但 `GraphNode` 类型中 `position` 为必填字段，理论上不应出现 `undefined`。若后端返回的节点缺少 `position`，此兜底逻辑生效。但未处理 `node.data` 为 `undefined` 的情况（`(node as { data?: Record<string, unknown> }).data ?? {}` 已处理）。 | 逻辑正确，但依赖类型断言，可能存在未预见的数据缺失场景。 |
| 42 | P2 | 未清理的副作用 | `components/canvas/GraphCanvas.tsx` | `beginGroupResize()` 函数（第 236-251 行） | `beginGroupResize` 在 `onPointerDown` 中向 `window` 添加 `pointermove`/`pointerup` 监听器，但未在组件卸载时清理这些监听器。若用户在拖拽过程中切换页面/卸载组件，监听器会残留。 | 潜在的内存泄漏和拖拽状态残留。需要使用 `useEffect` 清理或使用 `setPointerCapture` 自动释放。 |
| 43 | P2 | 竞态条件 | `studio/Studio.tsx` | 初始化 `useEffect`（第 155-208 行） | `boot()` 函数中 `templates.loadTemplates()` 和 `enums()` 并行执行，但 `cancelled` 标志只在一个层级检查。如果组件在 `templates.loadTemplates()` 完成前卸载，`cancelled` 变为 `true`，但 `enums()` 可能仍在执行并最终调用 `dispatch`。 | 同上，可能导致 "Can't perform a React state update on an unmounted component" 警告。 |
| 44 | P2 | 交互缺陷 | `components/canvas/GraphCanvas.tsx` | `onUp` 中拖入协作组判定（第 197-210 行） | 拖入协作组的判定仅检查节点是否为 `parent`/`agent` 且 `groupId` 为 `null`。但未检查目标节点是否已在其他组内，也未检查目标组容量（8 人上限）是否已满。虽有后续 `addNodeToGroup` 中的容量检查，但拖拽判定时缺少视觉反馈。 | 用户拖拽角色节点到已满的协作组时，节点仍会移动过去但随后被拒绝，体验不一致。 |
| 45 | P2 | 错误处理 | `src/client/hooks/useRunPolling.ts` | L27-L29 | 轮询中 `catch` 捕获错误后**完全静默**（`// 轮询偶发失败下一轮重试`），未做任何日志上报或降级处理。若后端持续返回 500，用户会看到节点状态卡在"运行中"永不更新。 | 故障静默，用户无法感知轮询失败，误以为流程仍在执行。 |
| 46 | P2 | 逻辑Bug（级联删除状态残留） | `src/client/studio/Studio.tsx` | `removeNodeNow` | 删除主节点并级联删除虚拟节点后，未清除 `selection` 中可能指向已删除虚拟节点的引用 | 用户删除节点后，右侧属性栏可能短暂残留旧数据（直到下次点击） |
| 47 | P2 | 性能/无限循环风险 | `src/host/orchestrator/runtime.ts` | L395-L407（`GLOBAL_RUN_CALL_LIMIT`） | 全局调用上限 `GLOBAL_RUN_CALL_LIMIT = 500` 硬编码，未从配置读取。若工作流节点数超 500（协作组嵌套等场景），父代理达到上限后编排被强制终止，但 `wfFinish` 可能未调用，运行锁残留。 | 大工作流（>500 节点）无法完成编排；上限硬编码无法通过配置调整。 |
| 48 | P2 | 数据一致性/陈旧锁竞态 | `src/host/storage/atomic.ts` | L346-L369（`tryReapStaleLock`） | 陈旧锁回收逻辑：先 `stat` 取 mtime/size，删除前再 `stat` 比对。但两次 `stat` 之间锁文件可能被新持有者重建（极小窗口），且重建后的文件可能恰好 mtime/size 与旧锁一致（哈希碰撞级概率），导致误删新锁。 | 虽概率极低，但一旦发生会导致两个进程同时持有磁盘锁（`acquireDiskLock` 的 EEXIST 检查失效），引发数据损坏。 |
| 49 | P2 | 响应式代理污染 | `src/client/studio/Studio.tsx` | L685-L692（`renderedNodes`） | `renderedNodes` 通过 `nodes.map` 为虚拟节点 `proxy` 重新赋值 `data.label`，使用 `{ ...node, data: { ...node.data, label: ... } }`。此操作为**浅拷贝**，`node.data` 是新的对象引用，但 `node.data` 内部字段（如 `memberIds`、`files`）仍指向原对象，若后续 `NODE_DATA_PATCH` 修改 `data.memberIds`，将同时影响虚拟节点和原节点。 | 虚拟节点与原节点共享 `memberIds`/`files` 等引用字段，编辑组节点成员列表可能导致虚拟节点数据异常。 |
| 50 | P2 | 安全/会话隔离缺失 | `src/host/service/openai-api.ts` | L141-L159（`runChat`）、L214-L218（`ensureRootAgent`） | 模式二服务进程中，`ensureRootAgent` 按 `sessionId` 取/建 Agent，但未校验 `userId` 与 `sessionId` 的绑定关系（`SessionMap.resolve` 已建立映射，但 `runChat` 中未传递 `userId` 到 `ensureRootAgent` 做二次校验）。攻击者若获知他人 `sessionId`，可假冒任意用户提问。 | 多租户会话隔离依赖 `userId→sessionId` 映射，但运行时未校验请求的 `userId` 与当前 `sessionId` 是否匹配，存在越权风险。 |
| 51 | P2 | 内存泄漏风险 | `src/host/orchestrator/runtime.ts` | L496-L510（`asks` Map） | `wf_ask_agent` 的挂起通信 `asks` 在超时/裁决/运行终止后从 Map 删除，但审计日志 `audit` 保留在 `PendingAsk` 对象中，若 `ask` 超时后父代理未调用 `resolve`，`asks` 条目在运行终止时 `rejectAsks` 删除，但 `audit` 日志也随之丢失（仅内存）。 | 审计日志未持久化，无法追溯协作通信历史；运行终止时 `audit` 随 `PendingAsk` 一并释放。 |
| 52 | P2 | 并发/数据一致性 | `src/host/service/manager.ts` | L150-L180 (`start` 方法) | 服务管理器启动进程时：`this.children.set(id, managed)` → 随后 `child.once('exit', ...)` 异步监听退出事件 → 在监听器注册完成前，若进程**立即崩溃**（如端口冲突），`exit` 事件可能在 `set` 之后、监听器绑定之前触发，导致 `children` Map 无法正确清理，`status` 无法更新为 `crashed`。 | 极端情况下，服务进程快速崩溃会导致内存状态与磁盘状态不一致，`children` 中残留无效条目，影响后续 `start`/`stop` 操作。 |
| 53 | P2 | 数据一致性 | `src/host/storage/flow-store.ts` | L377-L395 (`listWorkflows` 等读方法) | 读操作 (`listWorkflows`, `getWorkflow`) 未使用 `withJsonLock`，仅 `readJson` 直接读取。虽然 `atomicWriteJson` 通过 `rename` 保证了原子性（读不到半写文件），但若**写操作正在进行中**（临时文件已写入但未 `rename`），读操作会读到旧版本；若 `rename` 刚完成，读操作读到新版本。这在单写者场景下是安全的，但**若多个写者并发**（虽然有锁，但锁仅序列化写操作），读操作仍可能读到**正在被 `rename` 覆盖的旧文件**（`rename` 在 POSIX 上是原子的，但在 Windows 上可能不是完全原子的）。 | 在极端高并发或跨进程场景下，可能读到不一致的“中间状态”，虽然概率极低，但不符合严格的数据一致性要求。 |
| 54 | P2 | 数据污染（浅拷贝） | `src/client/studio/Studio.tsx` | L136-L145 (`placeTemplateNode`) | 用户从左侧模板库拖拽角色模板到画布 → `placeTemplateNode` 调用 `templateToNodeData(kind, template)` → `templateToNodeData` 返回的 `data` 对象中，若 `template` 包含**引用类型字段**（如 `files` 数组），`templateToNodeData` 只是**浅拷贝**该数组引用 → 新生成的 `CanvasNode.data.files` 与 `template.files` 指向同一数组。若后续修改节点文件列表，会**同步污染模板对象**。 | 模板与节点数据耦合，违反 §4.2.1“节点 JSON 即事实源，拖入即深拷贝解耦”的设计原则。 |
| 55 | P2 | 安全/日志 | `src/host/service/manager.ts` | L225-L240 (`start` 方法中的横幅输出) | 服务启动时，若配置了 `apiKey`，横幅输出会显示 `Authorization: Bearer <您的 API Key>（已启用鉴权：${this.deps.config.apiKey.slice(0, 4)}****）`，**直接打印了 API Key 的前4位**。虽然仅展示前缀，但攻击者若能看到日志，可能利用该前缀进行社会工程或暴力破解。 | 敏感信息（API Key 前缀）泄露到日志/终端，违反安全最佳实践。 |
| 56 | P2 | 安全性（XSS） | `src/client/studio/Studio.tsx` | L1240-L1250 (`toast` 渲染) | 轻提示 (`toast`) 的 `text` 字段可能包含用户输入或后端返回的错误消息（如 SQL 错误详情），这些消息直接通过 `innerText` 或 React 文本节点渲染。React 默认会转义，所以**当前代码是安全的**。但需注意，如果未来某个地方使用 `dangerouslySetInnerHTML` 或非 React 渲染，可能引入 XSS。 | 当前无直接XSS漏洞，但需保持警惕。 |
| 57 | P2 | 性能/并发 | `src/host/orchestrator/runtime.ts` | L510-L520 (`currentResolvedFlow` 调用) | `wfRunNode` 每次调用都执行 `const flow = await this.currentResolvedFlow(run)` → `currentResolvedFlow` 调用 `store.getWorkflow` 读取磁盘。在一个运行中，若父代理频繁调用 `wf_run_node`（如循环启动大量节点），会**产生大量磁盘 I/O**，影响性能。 | 高并发/大规模工作流场景下，频繁磁盘读取可能成为性能瓶颈。 |
| 58 | P2 | 稳定性 | `index.ts` | `latestTurnEnd` L179-L193 | event.time 缺失时看护失效 | 父代理 error 自动终止失效 |
| 59 | P2 | 安全 | `tools/data-tools.ts` | `buildIndexForDatabase` L154-L162 | 表名插值 SQL 注入 | 恶意表名可注入 |
| 60 | P2 | 数据流断裂 | `GraphCanvas.tsx` | `renderedNodes` L370-L376 | proxy label 回退依赖已丢失的 proxySourceId | 虚拟节点画布显示空白 label |
| 61 | P2 | UI | `Toolbar.tsx` | L31-L32 | running 与 serviceStatus 语义重叠导致模式二下可重复点击启动 | 用户可重复点击启动（后端报 RUNNING 错误） |
| 62 | P2 | 数据流 | `RunHistory.tsx` | L71 | 断点恢复 onResume 签名仅 runId（在 Studio 中已补全参数，但组件接口不完整） | 单独使用组件时缺少 sessionId/flowId |
| 63 | P2 | 契约冲突 | `bundle.ts` | `isWorkflowBundle` | 仅检查 `parsed.workflow`，mode2 服务的 bundle 无 workflow 字段 | 模式二服务 bundle 无法识别导入 |
| 64 | P2 | 校验不一致 | `lib/graph-model.ts` | `connectionProblem` | 前端连线校验缺条件仅流程线、协作组边界、模式差异检查 | 前端可创建后端拒绝的连线 |
| 65 | P2 | 字段丢失 | `graph-model.ts` | `templateToNodeData` file 分支 | 未处理 files 多选字段 | 多选文件模板拖入画布丢失文件列表 |
| 66 | P2 | 样式缺陷 | `GroupCard.tsx` | 成员接点 L43-L53 | db-in/ctx-out 无定位样式，接点重叠 | 用户无法精确拖拽 |
| 67 | P2 | 并发 | `service/manager.ts` | `stop` L225-L232 | forceKill 定时器泄漏 | 快速 stop→start 时误杀新进程 |
| 68 | P2 | 数据完整性 | `remote/download.ts` | `copyIntoManagedFile` L43-L52 | 未使用 fsync 原子写 | 崩溃时文件不完整 |
| 69 | P2 | 并发 | `remote/mcp-registry.ts` | `writeRegion` L196-L210 | 无文件锁 | 并发修改 MCP 配置丢失 |
| 70 | P2 | 数据完整性 | `remote/transfer.ts` | `importWorkflowBundle` L105-L118 | 组合保存非原子 | 导入部分成功 |
| 71 | P3 | 命名规范 | `src/client/studio/Studio.tsx` 及多处组件 | 全局使用 `t` 与 `copy` 两个别名表示 `Dict` | `Studio.tsx` 中 props 为 `t`，`LeftPanel`/`Inspector` 中 props 为 `copy`，不一致 | 增加理解成本，建议统一为 `i18n` 或 `dict` |
| 72 | P3 | 注释规范 | 多个文件 | - | 部分复杂函数缺少 JSDoc 注释，如 `connectionProblem`（graph-model.ts）、`layoutNodes`（graph-model.ts）、`editorDataOf`（studio-state.ts）等，其内部算法逻辑（拓扑排序、连接校验等）未说明"为什么"这么实现。 | 架构文档 §13.3 要求"关键时序/协议处注释必须说明'为什么'"，当前注释偏少，影响后续维护。 |
| 73 | P3 | 类型安全 | `src/client/lib/remote.ts` | `remoteCall()` 返回值，L18-28 | `remoteCall` 的返回值类型为 `Promise<unknown>`，调用方均使用 `as` 断言强制转换为期望类型（如 `as WorkflowDocument[]`），未使用类型守卫或运行时校验，可能掩盖后端数据结构变更。 | 当后端接口变更时，前端不会在编译期感知，可能引发运行时静默错误。 |
| 74 | P3 | 代码质量 | `hooks/useRemote.ts` | 整个文件（7 行） | `useRemote` hook 仅包装 `remoteCall` 纯函数，未提供任何额外功能（如请求去重、缓存、错误重试等）。 | 此 hook 存在意义不大，可直接在组件中导入 `remoteCall` 使用，减少一层抽象。 |
| 75 | P3 | 性能建议 | `studio/Studio.tsx` | `modeName` 回调（第 224-236 行） | `modeName` 在每次渲染时遍历 `state.presets` 和 `state.combos` 查找匹配项，未使用 `useMemo` 缓存。 | 在属性面板中频繁调用时产生不必要的查找开销。 |
| 76 | P3 | 最佳实践 | `hooks/useGraphHistory.ts` | `remember` 中的依赖项（第 17 行） | `useCallback` 的依赖项包含 `state` 对象，每次 `state` 变化都会重新创建 `remember` 函数。 | 由于 `state` 是 reducer 状态，每次 dispatch 都会产生新对象，导致 `remember` 频繁重建，可能引起子组件不必要的重渲染。建议使用 `useRef` + 最新值模式，或拆分依赖为具体字段。 |
| 77 | P3 | 代码风格 | `src/client/lib/graph-model.ts` | L90-L98 | `templateToNodeData` 返回 `Record<string, unknown> | null`，但调用方 `Studio.tsx` L353 中 `const data = templateToNodeData(kind, template) ?? {}`，若返回 `null` 则使用空对象，**丢失了模板的 name 字段**（空对象导致节点 label 为空）。 | 虽不会导致崩溃，但节点名称为空，用户需手动填写。 |
| 78 | P3 | 类型定义 | `src/client/types.d.ts` | L5-L17 | `*.module.css` 和 `*.css` 声明了空模块，但项目实际使用 `styles.ts` 中的 CSS-in-JS（模板字符串）和 `entry.css` 全局 CSS，并未使用 CSS Modules。`types.d.ts` 中的声明是死代码，仅保留以备未来使用。 | 死代码增加混淆，建议移除或注释说明。 |
| 79 | P3 | 代码规范/可维护性 | `src/client/studio/Studio.tsx` | L1500-L1510 (`flowLayout` 函数) | `flowLayout` 函数是一个简单的拓扑排序+网格布局，但未考虑**跨层边**（如从第1层节点连到第3层节点），导致布局可能出现重叠或混乱。 | 布局算法不够健壮，复杂工作流可能呈现不佳。但“整理布局”功能非核心，且用户可手动调整。 |
| 80 | P3 | 代码健壮性 | `src/host/embedding/engine.ts` | L180-L195 (`loadLocal` 方法) | `loadLocal` 方法在加载本地模型前，通过 `existsSync` 检查 `config.json` 和 `tokenizer.json` 是否存在，若缺失则抛出错误。但**未检查 `onnx` 模型文件（如 `model.onnx`）**，该文件可能缺失但目录检查通过，导致加载时失败。 | 错误检测不完整，可能给用户造成“资产存在但加载失败”的困惑。 |
| 81 | P3 | 国际化（i18n） | `src/client/studio/Studio.tsx` | L660-L670 (`toastError` 使用) | `toastError` 直接使用 `error.message` 显示错误，**未经过 i18n 翻译**。后端返回的错误消息多为英文（如 `WF_LOCKED`），用户界面可能显示英文提示。 | 用户体验不佳，非中文用户可能看到混合语言提示。 |
| 82 | P3 | 数据隔离 | `src/client/components/combo-manager/ComboManager.tsx` | L180-L195 (`catalog` 状态) | `ComboManager` 中的 `catalog` 状态在组件卸载时不会自动清理，但组件是弹窗形式，卸载时销毁。**但 `catalog` 数据是通过 `remote.call` 获取的，若请求未完成时组件已卸载，可能触发“在未挂载组件上设置状态”的 React 警告。** | 控制台出现警告，不影响功能，但代码可优化。 |
| 83 | P3 | 死代码 | `Studio.tsx` | `highlightedNodeIds` | 始终返回 []，高亮功能未实现 | 运行中节点高亮缺失 |
| 84 | P3 | 代码质量 | `Studio.tsx` | L24 `void tools` | 无用 prop 抑制编译警告 | — |
| 85 | P3 | 代码质量 | `Studio.tsx` | `flowLayout` 与 `layoutGraph` 重复 | — | — |
| 86 | P3 | 默认值不一致 | `forms.tsx` | `RoleForm` L58 | presetId 默认 'standard' 与后端 null 语义不同 | 新建模板显示为标准预设但实际为 null |
| 87 | P3 | 代码质量 | `usePanelLayout.ts` | 重复实现 | storedNumber/storedBoolean/keepLayout 与 lib/files.ts 重复 | — |
| 88 | P3 | 契约脆弱 | `ComboManager.tsx` | `saveMcp` | args 使用 split(',')，与后端引号感知拆分不一致 | 含引号的参数被错误拆分 |
| 89 | P3 | 文档漂移 | `protocol.ts` | - | EP_FILE_UPLOAD/EP_SERVICE_DEBUG 未在架构文档登记 | — |
| 90 | P3 | 引擎逻辑 | `validate.ts` | `normalizeFlow` db 分支 | vectorSource 默认值用原始 dbType | 本地库默认无向量模式 |
| 91 | P3 | 资源管理 | `engine.ts` | dispose | 异步 dispose 未 await | 资源释放不完整 |
| 92 | P3 | 代码质量 | `model.ts` | `makeNodeId/makeLineId` | Math.random + SHA1 | 碰撞风险 |
| 93 | P3 | 代码质量 | `guards.ts` | `turn` 类型脆弱 | NaN 导致计数重置 | — |
| 94 | P3 | 代码质量 | `define-tool.ts` | `timeoutMs` 非法值静默忽略 | — | — |


## 其他问题

### 后端错误码标准化
- 后端使用 `WF_*` 前缀的错误码，但前端未做统一映射。建议前后端共同维护一份**错误码-国际化文案映射表**，前端根据错误码显示友好提示，而非直接展示 `error.message`。

### 前后端契约（API）一致性专项核验

| API 接口 | 前端调用参数 | 后端接收参数 | 前端响应解析 | 后端返回字段 | 一致性 | 说明 |
|----------|--------------|--------------|--------------|--------------|--------|------|
| `POST /visual-workflow/runStatus` | `{ runId }` | `{ runId }` | `snapshot` | RunSnapshot | ✅ | 端点无 sessionId 隔离（P0 #2） |
| `POST /visual-workflow/serviceStart` | `{ serviceId }` | `{ serviceId }` | `as ServiceState` | `{serviceId,status,port,pid}` | ❌ **严重不一致** | 前端误 cast 为 ServiceState（P0 #6） |
| `POST /visual-workflow/serviceStop` | `{ serviceId }` | `{ serviceId }` | `as ServiceState` | `{serviceId,status}` | ❌ **严重不一致** | 同上 |
| `POST /visual-workflow/serviceDebug` | `{ serviceId, sessionId, prompt }` | `{ serviceId, sessionId, prompt }` | `parsed.delta?.content` | SSE choices[0].delta.content | ❌ **字段路径错误** | 调试台输出空白（P0 #5） |


## 端到端核心流程数据链路追踪

### 场景 1：虚拟节点创建 → 保存 → 校验失败

```
用户点击"复制"按钮创建虚拟节点
  ↓
Studio.tsx copyToProxy():
  node = { id: 'proxy-x', kind: 'proxy', position, data: {}, proxySourceId: 'agent-1' }  // ✅ 正确创建（顶层字段）
  dispatch NODE_ADDED
  ↓
用户点击"保存" → saveCanvas() → serializeWorkflow(flow, nodes, edges)
  ↓
serializeWorkflow:
  nodes.map(node => ({ id, kind, position, data }))  // ❌ proxySourceId 未复制
  ↓
后端 receive → validateFlow():
  proxySourceId undefined → proxySourceMissing  // ❌ 校验失败，保存被拒绝
```

**可能原因**：前端 `CanvasNode` 接口（`studio-state.ts`）未包含 `proxySourceId` 顶层字段，导致投影和序列化全链路丢失。

### 场景 2：模式二启动服务 → Store 污染 → 画布空白

```
用户点击"启动服务"
  ↓
useServiceControl.startService('svc-abc')
  remote.call(EP_SERVICE_START, { serviceId: 'svc-abc' })
  ↓
后端 manager.start() 返回 { serviceId, status: 'running', port: 7860, pid: 12345 }
  ↓
前端：const service = result as ServiceState  // ❌ 残缺对象伪装成 ServiceState
  dispatch SERVICE_UPDATED
  ↓
reducer: state.services.map(s => s.id === action.service.id ? action.service : s)
  // ❌ 完整 ServiceState 被替换为残缺对象
  ↓
用户点击该服务 → OPEN_SERVICE → serviceToCanvas(残缺对象)
  service.nodes undefined → nodes: []
  // ❌ 画布变空白，配置的节点/连线全部消失
```

### 场景 3：模式二调试台 SSE 流式输出空白

```
用户输入调试问题 → ServiceConsole.sendDebug()
  ↓
streamCall(EP_SERVICE_DEBUG, { serviceId, sessionId, prompt })
  ↓
后端 service-debug.ts pumpServiceDebug() 原样透传上游 SSE
  ↓
浏览器收到: data: {"choices":[{"delta":{"content":"你好"}}]}
  ↓
前端解析: parsed.delta?.content   // ❌ undefined
  // 正确路径: parsed.choices[0].delta.content
  ↓
输出区永远空白
```