# logs.md — Visual Workflow 开发日志（总览）

> 标准示例，AI 据此填写简要日志（不要太长），每次任务作为项目上下文注入

**版本号通用规则**

- 版本（X.Y.Z）。含义如下：
  - 主版本号 (X)：做不兼容 API 修改时递增。注意： 主版本号为 0（如 0.x.x）代表项目处于开发初始阶段，接口随时可能改变，不算稳定版。此项目处于该阶段。
  - 次版本号 (Y)：向下兼容的功能性新增时递增。
  - 修订号 (Z)：向下兼容的 Bug 修复时递增。

**日志书写规范**

```
## （日期倒序，最新的在最前，如：2026.08.24）

1. git版本：[12a61b9] [v0.1.0]
   - 完成：三栏布局、DSH token、深浅色适配、节点配色、点阵背景、发光贝塞尔连线、圆形 handles、缩放控件、空画布引导。
   - ...

2. git版本：[版本前7位哈希] [插件版本号]
   - （完成的任务/修复的 bug/实现的功能）
   - （功能性重大变更请标注）
```

---

## 日志索引（用 read(offset, limit) 读取最近两次日志了解项目进展，不要读取整个文件）

- 1. 最近两次  - 起始行号：L45 ~ L73
  - [未提交]（P13 UI 重构：按需求 §4.5 + 旧项目 界面分栏设计 照搬改造）
  - [eb0d744]（P13 完成，按 §3.1 每 4 阶段一次提交，与 P12/P14/P15 批次一起提交）

- 2. 2026.08.24 记录的日志  - L73 ~ L100
  - [未提交]（P12 完成）
  - [2f57125]

- 3. 已压缩的早期日志（如有查证需要再读取） - L106 之后
  - [837166f] [470d5a2] [804f266] [9b74c77] [d71d630] [a294845] [6b6e69f] [912876b] [d5d346a] [3119869] [87f4e0e]

---

## 2026.08.24

1. git版本：[未提交] [v0.1.0]（P13 UI 重构：按需求 §4.5 + 旧项目 界面分栏设计 照搬改造）
   - 背景：用户验收指出 UI 偏离旧项目、按钮重叠/布局混乱/额外标题栏/左侧 Tab 不符、窗口拖动卡顿与拉伸闪烁。
   - 处置：以旧项目 src/client 全套实现为底本 **TS/TSX 化照搬**（架构文档 §10 目录结构不变），字段适配本项目数据模型；删除自绘 TSX 组件。
   - 标题顶栏 = 窗口标题栏（需求 §4.5.1/§4.5.2）：工作流设计器 + 可视化编排徽标 + 提示语，右侧 导入/导出/模式切换（下拉）/组合，**组合右侧为关闭按钮**（浮窗与 conversation.view 并存；窗口标题栏兼作拖动把手）。
   - 画布控制栏（§4.5.3，Studio/components/toolbar/Toolbar.tsx）：撤销 / 重做 / 清空（二次确认 + 可撤销）/ 整理布局 / 保存 / 运行·停止（模式二=启动·停止服务 + 端口状态）/ 运行历史；移除会话下拉（§4.5.7 会话绑定）。
   - 左侧栏（components/sidebar/LeftPanel.tsx，§4.5.4）：4 Tab 工作流 / 角色（父代理置顶）/ 数据（文件 + 数据库分区）/ 其他（阶段 + 协作组）；分区标题右侧 ＋ 新建模板；pointer 拖拽到画布（深拷贝内联，§4.2.1）。
   - 右侧属性栏（components/panels/inspector/，§4.5.5）：所见即所操作——模板/画布节点/连线按对象编辑；角色表单（systemPrompt/.md 加载/服务商/模型/思考强度/模式/ReAct 与重试上限/输入输出结构），父代理高级项裁剪 + 父模板点击无属性；文件（文本/受管文件，新增 EP_FILE_UPLOAD 端点复制进 data/files/）；数据库（本地/服务器 + 测试连接）；协作组（成员只读列表 + 移除）；阶段/虚拟节点只读；连线（流程/通过/不通过/内容 + 内容值）；底部 保存/删除/复制（角色→虚拟节点，§4.2.3.2 规则 4）。
   - 画布（components/canvas/）：照搬旧项目 SVG 画布交互（平移/缩放/拖拽/连线/条件标签/运行高亮/空态引导），按 9 类节点与三通道连线（--wf-flow/ctx/database/pass/fail/content）适配；协作组卡片 + 右下拉伸；虚拟节点虚线 + ↻引用角标。
   - 运行与历史：startRun 校验启动/结束节点（模式二另校验父代理）→ run（断点自动续跑）；runStatus 轮询回显（节点徽标，防回环仅写视图）；运行历史弹层含 paused/interrupted 恢复按钮（EP_RUN_RESUME）+ resumedFromRunId 继承链。
   - 浮窗（studio/floating-window.tsx）：修复拖动卡顿/拉伸闪烁——拖动缩放经 ref 直写 DOM style + rAF 合并，pointerup 一次性提交持久化（不再每帧 setState 重渲染工作台）；标题栏=工作台一行 + 组合右侧关闭按钮；八方向拉伸 + 最小 480×320 + 几何 localStorage 记忆。
   - 工程：i18n.ts（照搬+新键 zh/en）、styles.ts（照搬旧项目 wf-* 设计语言 + --wf-* 颜色变量 + 窗口/组/代理/服务控制台样式）；useServiceControl 增 saveService/createServiceDraft；studio-state 增 NODE_DATA_PATCH/EDGE_PATCH/DOC_PATCH、LibTab=4、parentTemplate/stage/groupTemplate 选择、EditorData 全种类。
   - 测试：client 51 用例（studio-state 11 / graph-model 18 / Studio 4 / entry 5 / floating-window 8 / remote 5）全绿；全量 500 用例（32 文件）全绿（atomic/service-manager 既有 Windows 并行 flaky，单独跑通过）；typecheck 四 program + build + client-smoke 通过。
   - 变更标注：host 新增 fileUpload 端点（protocol EP_FILE_UPLOAD + api.fileUpload + tests/host/shared-contract 端点清单 40 项），3080 用户实例不受影响；3081 调试实例已用新 host 重启。

2. git版本：[eb0d744] [v0.1.0]（P13 完成，按 §3.1 每 4 阶段一次提交，与 P12/P14/P15 批次一起提交）
   - 完成：P13 属性栏 + 控制栏 + 运行历史（T-045 右侧属性栏 + T-046 控制栏 + T-047 运行历史）。
   - T-045 交付（src/client/components/panels/inspector/ Inspector.tsx + forms.tsx）：
     - 所见即所得：按编辑对象分发表单——工作流（名称/描述）、角色节点/模板（label/系统提示词/服务商/模型/预设/重试上限/ReAct 上限/输入输出结构，模板 name 与节点 label 兼容双写）、文件（fileKind/内容/受管路径）、数据库（类型/引擎/本地路径/服务器连接）、协作组（名称/协作 Prompt/成员只读列表）、连线（条件类型 pass/fail/content + content 自定义值，即时生效无保存按钮）、阶段（label 锁定只读）、虚拟节点（只读显示主节点名，无保存/删除按钮）。
     - 底部保存/删除作用于当前选中对象：节点=保存工作流/删除（级联删连线）、连线=删除、模板=保存/删除模板库、工作流=二次确认删除。
     - 状态机扩展：NODE_PATCHED / EDGE_PATCHED / WORKFLOW_PATCHED（增量写回 + dirty）。
   - T-046 交付（src/client/components/toolbar/ Toolbar.tsx + ConfirmDialog.tsx）：
     - 画布控制栏：撤销/重做（栈空禁用）、清空（二次确认弹层 → remember + GRAPH_REPLACED 空图，可撤销恢复）、整理布局（lib/graph-model.ts layoutNodes 拓扑分层：环内节点放最大层级+1）、保存、运行/停止（运行中切换）、运行历史入口。
     - 标题栏右上模式切换按钮（mode1/mode2）：未保存守卫拦截（保存并继续/放弃修改/取消，ConfirmDialog 三形态复用 guard）。
   - T-047 交付（src/client/components/run-history/RunHistory.tsx + hooks/useRunHistory.ts）：
     - 历史弹层：列表（状态点/流程名/时间/摘要 + 可恢复徽标）+ 详情（节点状态行 + 输出摘要）；paused/interrupted 可恢复（isResumable）→ 恢复按钮触发 runResume（EP_RUN_RESUME，runId 定向续跑）；resumedFromRunId 继承链展示；端点 runHistory({flowId})。
   - 工程：i18n 新增表单/控制栏/历史键（zh/en）；styles.ts 新增属性面板/工具栏/确认弹层/历史弹层样式；scripts/watch-client.mjs 开发期 client watch 构建（tsdown --watch 重写 lib/client.js，配合 dsh-client-hmr SSE 自动刷新）。
   - 测试：新增 38 用例（inspector 9 / toolbar 10 / run-history 9 / studio-state +4 / Studio 集成 +4（清空二次确认可撤销、模式切换守卫、历史恢复链路）+ layoutNodes 2）；typecheck 四 program + build + client-smoke 通过；全量 577 用例（37 文件）全绿（atomic/service-manager 既有 Windows 并行 flaky 单独跑均通过）。
   - 变更标注：P13 起开发期以 `dsh --profile web --patch <项目 cordis.patch.yml> --port 3081` 起调试实例（命令行 overlay 不落盘，不影响用户 3080 实例）；node_modules 链接仅供包解析与 client roster。

3. git版本：[未提交] [v0.1.0]（P12 完成）
   - 完成：P12 画布 + 左侧栏（T-043 画布组件 + T-044 左侧栏）。
   - T-043 交付（src/client/components/canvas/ GraphCanvas.tsx / FlowNode.tsx / geometry.ts + src/client/lib/graph-model.ts client 图模型）：
     - SVG 无限画布：拖空白平移、滚轮缩放（钳制 0.2~2.5、光标锚定）、点阵网格随缩放/平移变化、fitView/缩放控件（右下角）。
     - 节点按 kind 样式：父代理金色描边、阶段节点 label 锁定只读（启动/结束/暂停，模式二 输入/输出）、虚拟节点虚线边框 + 「↻ 引用」角标（meta 显示主节点名）、协作组卡片成员列表内部滚动 + 右下拉伸手柄、角色/文件/数据库卡片元信息行。
     - 连线：贝塞尔曲线 + 箭头（三通道配色 flow 冷灰/ctx 琥珀/db 天蓝，条件 pass/fail/content 翠绿/珊瑚/紫罗兰，CSS 变量 --wf-*）、条件标签（[通过]/[不通过]/[有内容] + content 自定义值）、拖线草稿虚线。
     - 拖拽连线校验 client 独立实现且与 host validate.ts 语义一致（自环/重复四元组/连接点矩阵/三通道配对/主虚互斥），host 保存时全量校验双保险；连线失败 toast 稳定错误码（i18n conn.*）。
     - 运行高亮：run.snapshot.nodes 状态 → 节点徽标（pending/running/ok/fail/skipped/react-capped），只写视图防回环；节点拖拽 NODE_MOVED、协作组拉伸 GROUP_RESIZED（撤销栈 remember 前置）；画布 Delete 键删除选中（节点级联删除连线）。
   - T-044 交付（src/client/components/sidebar/LeftPanel.tsx）：
     - 五 Tab（工作流/角色/文件/数据库/其他，LibTab 扩展 other）；角色 Tab 父代理模板置顶固定；其他 Tab 内置阶段（mode2 隐藏暂停）/协作组拖拽源。
     - pointer 拖拽模板到画布：面板自持拖拽生命周期（5px 阈值区分点击/拖拽），pointerup 事件目标判定落画布，经画布 API screenToWorld 换算世界坐标放置；模板深拷贝内联生成节点（与模板断引用、无 templateId，§4.2.1）。
     - + 新建模板（草稿本地）/新建工作流；点击模板 → 选中 + 右侧编辑；工作流列表点击 → 未保存守卫后打开。
   - 状态机/契约扩展：studio-state.ts LibTab + 'other'、GROUP_RESIZED action（协作组 data.size 回写 + dirty）、虚拟节点投影（proxySourceId 存入 CanvasNode.data，useWorkflows.serializeWorkflow 序列化还原顶层）、editorDataOf 虚拟节点只读解析主节点名；i18n 新增节点种类/状态/条件/连线错误等键（zh/en）；styles.ts 新增画布/节点/连线/侧栏样式。
   - 测试：新增 56 用例（graph-model 16 / canvas 20 / sidebar 15 / studio-state +4 / Studio 拖拽集成 +1：平移缩放钳制/网格/连线合法与非法/虚拟节点样式/协作组拉伸滚动/阶段只读/运行高亮/Tab 切换/父代理置顶/深拷贝断引用/拖放落点换算）；typecheck 四 program + build + client-smoke 通过；全量 512 用例全绿（32 文件，排除 atomic/service-manager 两个既有 Windows 并行 flaky——单独跑均通过，与本次无关）。

4. git版本：[2f57125] [v0.1.0]
   - 完成：P11 里程碑 5 Client 入口与 Studio 状态机（T-041 浮窗入口 + T-042 Studio/状态机/hooks 拆分）。
   - 入口改版（Q-UI-01，替代旧「轨迹右侧工作流 Tab」入口）：主界面**右下角圆形 FAB**（body 常驻容器 #visual-workflow-float-host，与视图环激活态解耦）→ 点击展开**独立窗口型页面**（floating-window.tsx：标题栏拖动 + 八方向缩放（四边/四角，最小 480×320）+ 视口边界钳制 + 几何 localStorage 记忆重开恢复）；conversation.view slot 保留（order 20，对话区视图环保留入口，与浮窗并存）。
   - T-042 交付：
     - studio-state.ts：纯 reducer 状态机（工作流/服务/模板三类列表、画布投影（nodes/lines 全量内联，无模板引用）、选中与编辑器、dirty、撤销重做栈（60 上限）、运行快照、轻提示、面板几何、对话框）+ 选择器（currentFlowOf/editorDataOf/isRunningOf）+ 文档投影纯函数（flowToCanvas/serviceToCanvas）。
     - hooks/ 13 个（职责单一）：useStudioState / useRemote / useToast / useWorkflows（草稿首存入库 + revision 乐观锁）/ useTemplates（三类模板草稿/保存/删除）/ useSelection / useGraphHistory / useUnsavedGuard（三选项确认）/ useRunControl / useRunPolling（600ms 轮询终态停）/ useServiceControl（对接 P10 后端）/ useModeSwitch / usePanelLayout（拖宽 + localStorage）。
     - Studio.tsx：工作台骨架（标题栏 + 三栏：左 Tab/列表只读 + 画布空态 + 右属性空态 + 状态条/toasts）；会话绑定（无下拉，跟随当前会话）；运行=先保存再 run（断点自动续跑）。
     - i18n.ts（zh/en 适配新模型：role/file/database 模板、mode1/mode2、浮窗键；注册官方 locale 服务命名空间 visualWorkflow，无服务按浏览器语言回退）；styles.ts（FAB/浮窗/骨架样式 + --wf-* 深浅色变量）；lib/remote.ts（端点名直接引用共享协议常量表 EP_*，零漂移）。
   - 工程：tsconfig.test.client.json 引入（client 测试 program，jsdom 文件头注释声明）；typecheck 扩为四 program；tsconfig.client.emit.json rootDir 扩到 src（client + shared 共享契约），转发文件改 ./client/entry；.gitignore lib/ 改根级锚定 /lib/（src/client/lib/ 是源码目录）；build-artifacts hook 超时放宽 120s（构建变重）。
   - 测试：新增 41 用例（client 5 文件：remote 6 + studio-state 18 + floating-window 6 + Studio 6 + entry 5：FAB 开关/拖动缩放/几何持久化/slot order-label/dispose 清理/状态机全路径/会话绑定）；全量 490 用例全绿（31 文件，连续两次；atomic 等并发 flaky 与本次无关），typecheck 四 program + build + client-smoke 通过（client.js 0.95KB → 66.76KB）。
   - 变更标注：入口改版已同步需求文档 §4.5（规则 1 浮窗入口）、架构文档 §10（挂载改版 + 13 hooks 清单）、任务清单 T-041 行（docs 修改留用户侧工作区，未提交）；client 共享契约引用 host/shared（protocol 常量 + 纯类型）经 rootDir 扩展纳入构建，宿主权威声明仍在 lib/types/shared/。

---
> 下述日志已压缩（AI自动维护，根据每次最新读取时间，超时2天自动压缩过期日志，以此为界限，作为记录）
> 压缩状态：已压缩（压缩完成后更新）
> 压缩时间：2026.08.24

1. git版本：[837166f] [v0.1.0]
   - 完成：P10 里程碑4 模式二服务全链路（T-031 服务管理 + T-032 服务进程入口/OpenAI 兼容 API + T-033 userId 会话映射）。
     - T-031：服务管理（manager.ts/port-pool/serve-patch）：启动链（serviceId消毒、端口分配、渲染patch.yml、fork dsh进程）、生命周期（stop/dispose/autoRecover）、错误码路由；Host init挂自动恢复。
     - T-032：服务进程入口（service-runner.ts + openai-api.ts）：解析--visual-workflow-serve/--port，装载VisualWorkflowHost；OpenAI API（/v1/chat/completions SSE/非流式，/v1/models，Bearer鉴权，userId必填，并发429，断点续跑）；runtime扩展mode2 startRun/resumeRun。
     - T-033：sessions-map（userId→sessionId内存缓存+磁盘持久化，重启恢复）。
     - 工程：flow-store增getServiceById/listServicesAll/getServiceAsFlow；serve.patch渲染收敛；测试新增67用例，全量449全绿；变更标注：模式二与主进程共享数据层，skipReconcile防破坏运行记录。

2. git版本：[470d5a2] [v0.1.0]
   - 完成：P09 里程碑3 GUI API层与断点续跑（T-026/T-027）。
     - T-027：resume.ts + runtime扩展：buildResumedSnapshot继承快照（ok/react-capped继承，其余回退pending），findResumableRun；resumeRun复用校验链，注入isResume动态，释放旧paused条目；错误码WF_NO_RESUME_POINT等。
     - T-026：remote/四文件（api/download/mcp-registry/transfer）：api白名单分发39端点，run自动续跑，runStatus终态回退磁盘，服务端点可选缝；download文件拷贝防穿越；MCP托管区读写；bundle导入导出（v2，冲突rename/overwrite）。
     - 工程：flow-store加getTemplate/listTemplates；putWorkflow/putService乐观锁；测试新增28用例，全量382全绿；变更标注：deleteTemplatePreview返回affectedNodes=0+detached（解耦语义）。

3. git版本：[804f266] [v0.1.0]
   - 完成：P08 里程碑2 Agent间通信（T-024 wf_ask_agent三态协议）。
     - 交付wf-ask-agent.ts + runtime扩展：三态（ask/reply/resolve），插队投递（在线steer/冷态回退subagents.followup），强校验（运行锁+childIndex所有权+会话归属），超时（默认120s，父代理征询用户后continue/resend/abort），终止时释放挂起ask，同发起者重复拒绝WF_BUSY。
     - 编排指令补充硬约束第8条；测试新增24用例，全量354全绿；变更标注：注释规范清理文档章节引用（runtime/orchestration顺手清理）。

4. git版本：[9b74c77] [v0.1.0]
   - 完成：BUG排查报告逐项查证与修复（docs/bug排查.md，B1~B3修复；F1~F4查证为未开发功能不修复）。
     - B1：buildNodeBlocks增加snapshot参数，ctx-in按快照读最终产出（ok/react-capped注入，fail/pending不注入）。
     - B2：handleSubagentEnd完成后调用markGroupOkIfComplete——全部成员ok/react-capped时组卡片pending→ok（单向回显）。
     - B3：terminateRun与wfFinish终态释放runs表条目（running/paused保留），wfFinish幂等改查磁盘历史。
     - 测试新增5用例，全量330全绿；变更标注：终态释放后wf_run_node返回WF_NO_ACTIVE_RUN（高频路径零磁盘开销）。

5. git版本：[d71d630] [v0.1.0]
   - 完成：P07 工具注册与数据工具（T-023/T-025，主代理本人实现）。
     - T-023：tools/三文件（define-tool/text-render/wf-tools）：registerWfTools注册wf_run_node/wf_finish/wf_ask（wf_run_node扩展wait/thinking等，wf_ask借用userQuestions.ask），touchRun防看护误停。
     - T-025：embedding/三文件（chunker/engine/indexer）+ data-tools：chunker分块；EmbeddingService外部>本地bge-small>BM25降级；VectorIndex持久化+余弦/BM25双模式；wf_db_query三模式（search/query/schema）+ SQL只读白名单（单SELECT/LIMIT/拒绝DDL）+ SqliteDriver/ServerDriver惰性加载。
     - 工程：package.json增optionalDependencies mysql2/pg；测试新增75用例，全量325全绿；变更标注：注释移除文件/文档章节引用；wait阻塞测试揭示启动竞态需vi.waitFor。

6. git版本：[a294845] [v0.1.0]
   - 完成：P06 子代理管理与护栏（T-022）——执行引擎。
     - 交付agent/runner.ts（ensureNodeChild/startNodeTask/interruptChild/consumeReactCapped/childVisibilityContribution + resolveAgentTools白名单剔除wf_run_node/wf_finish）、guards.ts（ReAct软截停）、model-selection.ts（双瀑布+WeakMap身份匹配）。
     - index.ts装配三项registerContinuableSetup；NodeAgentRunner替代占位；编排器联动consumeReactCapped/handleSubagentEnd标记react-capped/snapshot.setNodeStatus回写output。
     - 测试新增34用例，全量249全绿；变更标注：官方取证写入文件头；真实harness由T-063验证。

7. git版本：[6b6e69f] [v0.1.0]
   - 完成：P05 编排核心（T-021）——里程碑1「host侧跑得起来」。
     - 交付orchestrator/snapshot.ts、runtime.ts（运行锁/startRun/wfRunNode/wfFinish幂等/subagent-end回写/护栏500次上限+重试上限/WF_*错误码/currentResolvedFlow双向同步/terminate/stop/dispose）、watchdog.ts（空闲看护/父代理回合终态/重启reconcileStaleRuns）。
     - DI缝：NodeRunner接口+占位，AgentHost适配；编排指令/节点任务块装配；index.ts装配watchdog+reconcile+agent/error快速路径。
     - 测试orchestrator 54用例状态机全覆盖，全量214全绿；变更标注：snapshot无stopped；pause门持久化；虚拟节点解析为主节点记账。

8. git版本：[912876b] [v0.1.0]
   - 完成：P04 FlowStore数据层+Host装配（T-012/T-015）。
     - T-012：flow-store全CRUD（workflows/services/sessionId隔离、roles/data全局、runs单文件、combos、userId映射、orchestrations事实源）+ revision乐观锁+templateToNode深拷贝；17用例（并发/隔离/冲突）。
     - T-015：index.ts装配FlowStore+subagent/end+agent/error观察（events.d.ts本地增强）+ ctx.effect dispose骨架；真实Context单测4用例。
     - 工程：新增tsconfig.test.json；typecheck三program；测试全量160全绿。

9. git版本：[d5d346a] [v0.1.0]
   - 完成：P03 原子存储+图模型校验+共享契约（T-011/T-013/T-014）。
     - T-011：storage/atomic.ts八API（atomicWriteJson/readJson/withFileLock等）——open('wx')、磁盘锁+陈旧回收、锁序固定；19用例全绿。
     - T-013：graph/model.ts（9类节点+工厂+拓扑助手）+ validate.ts（自环/重复/通道配对/主虚互斥/协作组边界/阶段唯一/父代理唯一/模式差异/归一化）；41用例全绿。
     - T-014：shared三文件（graph-model/types/protocol）纯类型零运行时+29用例（端点比对/工具可见性/纯度门）。
     - 变更标注：FileNode/DatabaseNode补label必填；主代理完成T-013后不再分发；测试全量139全绿。

10. git版本：[3119869] [v0.1.0]
   - 完成：P02 挂载层+构建链路+模型资产+提示词基线（T-002/T-003/T-004/T-005）。
     - T-002：cordis.patch.yml 13键 + src/host/index.ts官方Service入口（z来自@deepseek-ai/schemastery，ctx.effect清理）；Loader验证通过。
     - T-003：tsdown 0.22.14客户端构建（__ModuleLoader__包装/style/purity gate/sourcemap）+ client声明发射+smoke冒烟。
     - T-004：embedding-model.mjs幂等资产；assets/models/bge-small-zh-v1.5齐备（onnx/model_quantized.onnx 24MB，sha256清单）。
     - T-005：prompts基线三构建器（编排指令/节点任务块/协作Prompt），W-01/W-02约束，动态值仅入尾段；markers.ts消除循环import。
     - 测试50全绿；变更标注：@deepseek-ai/schemastery进peer；vitest --pool=threads；dsh plugin add需pnpm-workspace.yaml allowBuilds=false。

11. git版本：[87f4e0e] [v0.1.0]
   - 完成：P01 项目骨架与包配置（T-001）——package.json插件契约（exports/files/dsh.bundle/dsh.client，零@deepseek-ai/*运行时依赖）、tsconfig.host/client双program、scripts/build.mjs（tsc双发射）、cordis/serve patch占位、目录骨架、.gitignore/.gitattributes。
   - 完成：tests/host/package-contract.test.ts（18用例）断言包契约与W-05；vitest --pool=threads。
   - 变更标注：@huggingface/transformers@^4.2.0唯一运行时依赖；pnpm-workspace.yaml allowBuilds=false抑制onnxruntime构建脚本。
---

## 12. git版本：[已提交] [v0.1.0]（P14-P17 收尾：服务调试台/组合管理/协作组完整化 + 标注图 BUG 修复）

1. **背景**：用户验收 4 张标注图（编排执行模式/后台服务模式/组合管理/UI），报告：工作台按钮不工作、会话读取失败、保存后丢失、属性栏保存删除交叉、模板/工作流无法删除。
2. **根因**：① entry.ts 会话读取用旧项目 API（list.get()）→ 官方 v0.1.1 为 sessions.list.getSnapshot()，导致浮窗会话恒空 → 会话级操作全 400；② 模板/工作流/服务草稿删除走后端 → 未入库 404 toast；③ 运行历史恢复 useCallback 闭包捕获旧 state，点击恢复永不生效。
3. **host**：EP_SERVICE_DEBUG SSE 流式代理（CORS/鉴权缘由同文档）；transfer.ts 支持模式二服务 v2 bundle 导出导入（service 字段落到 services/）；FileTemplate 补 fileName 字段。
4. **client**：服务控制台收敛为调试区（状态/启停并入 Toolbar 最右侧）；组合管理加 MCP 启用/停用与文案裁剪；协作组完整化（左栏/画布节点拖入组、组卡片流程点、组内成员上下文/数据库迷你接点跨组连线）；组协作 Prompt 可从 .md 加载；有向线段箭头（流程/通过/不通过/内容，ctx/db 无向）；阶段节点紧凑卡（168×88）；启动/结束上下文接点按模式裁剪；父代理模板首次启动内置；高级选项间距；System Prompt 标签。
5. **验证**：538 用例全绿（typecheck 4 program + vitest 全量 + build 未跑（watch 互斥，构建门禁由用户确认时执行））；真实浏览器 E2E（playwright + 系统 Edge）通过：FAB/浮窗渲染、会话绑定、模板保存、拖拽生成节点、刷新持久化、模板删除隔离、组合管理 MCP 显示 playwright。
6. **MCP 挂载**：官方 @deepseek-ai/dsh-mcp-client 标准行（serverName: playwright）写入 profiles/web/cordis.patch.yml 托管区，与组合管理 mcp-registry 输出格式一致；3081 组合管理 UI 确认工具正常显示；@playwright/mcp 为 devDependencies（仅开发验证用），浏览器复用系统 Edge（--executable-path）。