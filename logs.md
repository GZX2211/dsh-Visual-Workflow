# logs.md — Visual Workflow 开发日志

> 标准示例，AI 据此填写简要日志（不要太长），每次任务作为项目上下文注入

**版本号通用规则**

- 版本（X.Y.Z）。含义如下：
  - 主版本号 (X)：做不兼容 API 修改时递增。注意： 主版本号为 0（如 0.x.x）代表项目处于开发初始阶段，接口随时可能改变，不算稳定版。此项目处于该阶段。
  - 次版本号 (Y)：向下兼容的功能性新增时递增。
  - 修订号 (Z)：向下兼容的 Bug 修复时递增。

**日志书写规范**（按时间倒序书写）

```
## （日期倒序，最新的在最前，如：2026.08.24）

- git版本：[12a61b9] [v0.1.0] [18:20]
  - 完成：三栏布局、DSH token、深浅色适配...
  - ...

- git版本：[版本前7位哈希] [插件版本号] [当前时间]
  - （完成的任务/修复的 bug/实现的功能）
  - （功能性重大变更请标注）
  - ...
```

## 2026.08.29

- git版本：[0b2f067] [v0.1.0] [10:55]（安全重构：拆分 host 三大单体大文件，零功能变更）
  - 【任务：大文件拆分】按单一职责纯移动拆分（禁止重写/优化/重构业务逻辑，方法体/注释逐字保留）：
  - ① orchestrator/runtime.ts（1774 行）→ 类型层 seams（常量/WfError/依赖缝接口）、ask-types（wf_ask_agent 三态协议+消息文本纯函数）、run-types（RunEntry/入出参/OrchestratorDeps）、helpers（labelOf/buildNodeBlocks/directiveParams 等纯函数）+ 类按职责继承分层 6 文件（RuntimeBase 字段/查询/清理 → RuntimeLaunch 启动/续跑 → RuntimeExecute wf_run_node/finish → RuntimeComm 协作通信 → RuntimeObserve subagent/end 回写 → RuntimeLifecycle 终止收尾），入口 runtime.ts 收口为最终类+re-export（64 行）。
  - ② remote/api.ts（994 行）→ http.ts（HttpError/readBody/sendJson）+ api-base（ApiHost/ENDPOINTS/handle）+ 端点组继承分层 5 文件（workflows 工作流与服务、templates 模板、ecosystem 生态枚举、catalog 组合/MCP/插件目录、runs 运行/数据库/导入导出），入口 api.ts 收口（registerRoutes+SSE 代理+re-export）。
  - ③ index.ts（511 行）→ config.ts（name/inject/Config schema）、agent/agents-host.ts（CordisAgentHost+服务惰性解析）、visual-workflow-host.ts（VisualWorkflowHost Service）、index.ts 入口只剩 apply+re-export。
  - 【可见性说明】跨文件继承需把类内 private 放宽 protected（TS 编译产物不变，非公共 API）；服务层入口全部 re-export 原公共 API，外部引用路径零改动。
  - 【测试适配】cordis-patch.test.ts 对 index.ts 的文本断言随契约文件拆分改为三文件串联断言（语义不变）。
  - 【回归验证】pnpm check 全绿：typecheck 4 program / 44 文件 628 测试全通过（atomic 锁测试偶发 EPERM 与环境无关，单独复跑通过）/ build / client-smoke OK。


## 2026.08.29

- git版本：[211b173] [v0.1.0] [03:10]（安全重构：拆分单体大文件 Studio.tsx 与 studio-state.ts，零功能变更）
  - 【任务：大文件拆分】按单一职责纯移动拆分（禁止重写/优化/重构业务逻辑，useCallback 结构、deps 数组、注释语义原样保留）：
  - ① studio-state.ts（722 行）→ 拆为入口 re-export + 6 内聚子模块：studio-types（纯类型层：LibTab/CanvasNode/StudioState/EditorData 等）、studio-actions（StudioAction 判别联合）、studio-initial（HISTORY_LIMIT/defaultPanels/createInitialState 工厂）、studio-projection（flowToCanvas/serviceToCanvas 文档→画布投影）、studio-snapshot（graphSnapshotOf/graphSnapshotsEqual 图快照工具）、studio-reducer（studioReducer 主体 + 内部 openDocument/sanitizeSelectionAfterCanvas）、studio-selectors（currentFlowOf/editorDataOf 等派生选择器）。入口路径不变，20+ 外部引用方（hooks/组件/tests）零改动；useGraphHistory 依赖的 graphSnapshotOf 仍从入口导出。
  - ② Studio.tsx（1628 行）→ 主组件（装配 + 派生 + 委托渲染，228 行）+ 8 个 controller hooks（useDocumentActions 保存/打开/新建、useCanvasActions 画布编辑与节点放置、useEditorActions 编辑器 patch/保存/删除、useRunActions 运行/服务/历史、useStudioTransfer 导入导出/文件/数据库测试、useLibraryDrag 左栏拖拽与预览、useStudioBoot 初始化加载、useKeyShortcuts 键盘快捷键）+ StudioLayout.tsx 纯渲染层（JSX 组合，全部数据/回调经 props 注入）。pickInitialInstance 保留在 Studio.js 导出（Studio.test.tsx 直接引用）。
  - 【回归验证】typecheck 4 program 通过；全量 vitest 44 文件 628 测试全绿；build（tsc 发射 + tsdown client bundle）；client-smoke OK。行为零变更：saveCanvas 类型面仅按真实推断返回类型（三态并集）标注 Interface，无逻辑改动。

## 2026.08.28

- git版本：[2e47942] [v0.1.0] [23:25]（图2 交互改造——实例/模板职责二分 + 双向同步闭环 + 进入工作台自动选中实例）
  - 【本会话主代理（编排 + 授权实施）：图2 交互改造定稿落地】先产出需求确认清单征询用户 8 项裁决（q1 会话树根隔离、q2 模式二同步改造、q3 模板卡点击/拖入等价、q4 运行模板自动实例化名+序号、q5/q6 按钮动态命名（实例态=保存实例）、q7 另存为模板、q8 文件→画布轮询），全部落实。
  - ① 左侧「工作流」Tab 拆双区：上方实例列表（无 + 号，实例只能由模板「创建实例」产生；运行中实例卡右侧显示「运行中」），下方工作流模板列表（+ 号新建空白模板；模板全局共享、跨会话可见）。新增 useFlowTemplates（模板列表加载/新建/保存/删除/打开）与 flow-templates/ 目录（store CRUD，全局共享不隔离）。
  - ② 实例/模板职责二分：模板态画布上方按钮=「创建实例/创建服务」（画布内容存为实例，模板不变）；实例态=「保存实例/保存服务」；属性栏「保存/删除」作用于当前选中对象（模板→模板、实例→实例）；「另存为模板」=实例内容复制为全局共享模板。
  - ③ 运行按钮：模板态自动保存为实例（名=模板名，重名追加序号）再运行；实例态直接运行。startRun/startService 均加模板态分支。
  - ④ 导入语义变更：importWorkflow 一律落为「工作流模板」（不再直接创建实例），transfer.ts 重写 + 前端刷新模板列表。
  - ⑤ 疑点一（保存后父代理读不到新节点）根因修复：运行事实源 orchestrations/<runId>.json 为 startRun 一次性快照，画布保存只更新 workflows/ 不刷新它；新增 runtime.refreshActiveDefinitions()——putWorkflow/putService 保存成功后同步刷新活跃 run（running/paused）的事实源；orchestration.ts 编排指令新增提示「运行期间画布保存会刷新本文件，请每次调度前重新读取以文件为准」。
  - ⑥ 疑点二（实例误随代理 ID）根因修复：DSH 每个子代理对话持独立 childSessionId，工作台绑定「当前选中会话」导致子代理界面列表为空；新增 entry.rootSessionIdOf() 沿官方 sessions.list 快照 parentSessionId 上溯到会话树根，父代理与其全部后代子代理共享实例列表（实例按会话树根隔离）。
  - ⑦ 双向同步①画布→编排 = ⑤；双向同步②编排→画布 = 沿用 runStatus 轮询+节点高亮（既有）；双向同步「文件→画布」新增 useFlowFileSync——轮询检测实例文件 revision 变化，无未保存修改自动刷新、有未保存修改则 toast 提示（防回环：刷新不进撤销栈）。
  - ⑧ 进入工作台自动选中实例（本次补充需求）：浮窗关闭后重开 Studio 重新 mount → boot 运行为触发点；新增 activeRuns 端点 + runtime.activeRunsForSession（running/paused 保留锁）；boot 加载实例后自动选中——优先运行中实例（activeRuns 中 status=running 的 flowId），其次 paused，否则列表第一个；实例列表为空则保持空白画布。pickInitialInstance 纯函数（6 条单测覆盖：空列表/无活跃/优先 running/paused/flowId 不在列表回退/running 优先于 paused）。
  - ⑨ 契约与存储：protocol 新增 4 端点（listFlowTemplates/putFlowTemplate/deleteFlowTemplate/activeRuns，端点计数 41→45）；graph-model 新增 WorkflowTemplate 类型；flow-store 新增 flow-templates/ 目录与 listFlowTemplates/getFlowTemplate/saveFlowTemplate/deleteFlowTemplate（revision+乐观锁与实例同语义）；api.ts 加工作流模板端点 + putWorkflow/putService 保存后刷新事实源 + activeRuns 端点。
  - 【回测试】pickInitialInstance（6）、activeRuns 端点（running/paused/跨会话隔离/400）、工作流模板端点 CRUD（含 409 乐观锁）、flow-templates 存储 CRUD（mode 过滤/全局共享/删除不影响实例）、refreshActiveDefinitions（运行中刷新事实源 / 已结束 run 不刷新）、Studio 保存按钮语义（保存实例/创建实例动态名）、运行历史（模板态先创建实例再打开）、导入为模板、shared-contract 端点计数 45。typecheck 4 program 通过；全量 vitest 627/628（atomic.test 高并发整批并行偶发 Windows 文件锁 EPERM，单独重跑 20/20 通过，属环境抖动非改动引入——并行代理此前已多次记录同现象）；build + client-smoke 通过。