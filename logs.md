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

- 1. 最近两次  - 起始行号：L44 ~ L67
  - [804d35a]（P14-P17 收尾：服务调试台/组合管理/协作组完整化 + 标注图 BUG 修复）
  - [未提交]（P13 UI 重构：按需求 §4.5 + 旧项目 界面分栏设计 照搬改造）

- 2. 已压缩的早期日志（如有查证需要再读取） - L74 之后
  - [eb0d744] [2f57125] [837166f] [470d5a2] [804f266] [9b74c77] [d71d630] [a294845] [6b6e69f] [912876b] [d5d346a] [3119869] [87f4e0e]

---

## 2026.08.25

> 新的日志追加到此处

git版本：[待提交] [v0.1.0]（集成修复：保存/运行全链路 + 4 张标注图 BUG + 模式二服务启动反馈与自动恢复 + 3080 插件安装与 HMR）
   - 保存链路（用户主诉「保存成功但实际没保存」）：①草稿保存原经 createWorkflow 另发新 id → WORKFLOW_UPDATED 不命中列表、画布永远引用旧草稿 id，每次保存都新建副本 → 草稿统一走 putWorkflow（后端不存在即创建，id 不变）；②前端 _draft/_clientMeta 随模板/服务/工作流写盘 → 刷新后已入库对象被误判草稿（本地删除不走后端）→ 保存路径统一剥离（api.ts + flow-store 双保险）+ 清理既有数据残留（scripts/clean-client-meta.mjs）；③受管文件名消毒把中文全替换为 _（任务清单规则.md → ______.md）→ 保留 Unicode 仅过滤危险字符。
   - 标注图修复：父代理画布节点属性栏可编辑（原一律「无属性」）+ 可复制虚拟节点；角色卡元信息两行（模型/组合）；文件节点卡显示内容/文件名列表（两行省略、无「文件」前缀）；已选文件列表移至按钮下方、支持多选所有类型、显示原始文件名；虚拟节点「↻ 引用」重复徽标去重；输入/输出节点仅保留一个连接点；角色模板卡/父代理卡显示 System Prompt（20 字截断或 .md 文件名）；协作组拖拽悬停高亮「放开以入组」；组合管理 MCP「编辑」字段为空（pluginCatalog mcp 段补 command/args/url）；移除会话页「工作流」tab（批注图）。
   - 模式二服务：fork 参数修复（headless commander 不识别 app 级 flag → 服务启动即 crashed；改 patch config 传参 + 占位 task 位置参数）；启动横幅直写 dsh web 终端 stdout（服务名/端口/REST API/鉴权/curl 示例——实测 cordis logger 不落终端）；启停与端口释放（stdin EOF 优雅退出 + taskkill /T 树杀兜底）；自动恢复实测通过（重启 dsh 后 status=running 服务自动重启，无 UI 运行）。
   - 工程：dsh plugin 安装到 web profile（pnpm symlink/网络受限 → 手工登记 manifest + junction）；MCP playwright 行双重转义（16 层反斜杠）修复并启用（原 disabled）→ mcp__playwright__* 工具加载成功；HMR 挂载 3080（profiles/web/cordis.yml 声明 timer+hmr 监听 lib，新增 scripts/watch-host.mjs 与既有 watch-client.mjs 常驻）。
   - 测试：538 用例全绿（typecheck 4 program + vitest 全量）+ build + client-smoke；3081 实测：草稿 id 一致/模板剥 _draft/中文文件名、服务启停循环与端口释放、REST API 行为（400/200）、自动恢复、MCP 工具加载。

## 2026.08.25

> 新的日志追加到此处

git版本：[804d35a] [v0.1.0]（P14-P17 收尾：服务调试台/组合管理/协作组完整化 + 标注图 BUG 修复）
   - 完成：P14-P17收尾，包括服务调试台、组合管理、协作组完整化，并修复用户验收标注图报告的BUG。
     - 背景：用户验收4张标注图（编排执行模式/后台服务模式/组合管理/UI），报告工作台按钮不工作、会话读取失败、保存后丢失、属性栏保存删除交叉、模板/工作流无法删除。
     - 根因：① entry.ts会话读取用旧项目API（list.get()）→官方v0.1.1为sessions.list.getSnapshot()，导致浮窗会话恒空→会话级操作全400；② 模板/工作流/服务草稿删除走后端→未入库404 toast；③ 运行历史恢复useCallback闭包捕获旧state，点击恢复永不生效。
     - host：EP_SERVICE_DEBUG SSE流式代理（CORS/鉴权缘由同文档）；transfer.ts支持模式二服务v2 bundle导出导入（service字段落到services/）；FileTemplate补fileName字段。
     - client：服务控制台收敛为调试区（状态/启停并入Toolbar最右侧）；组合管理加MCP启用/停用与文案裁剪；协作组完整化（左栏/画布节点拖入组、组卡片流程点、组内成员上下文/数据库迷你接点跨组连线）；组协作Prompt可从.md加载；有向线段箭头（流程/通过/不通过/内容，ctx/db无向）；阶段节点紧凑卡（168×88）；启动/结束上下文接点按模式裁剪；父代理模板首次启动内置；高级选项间距；System Prompt标签。
   - 测试：538用例全绿（typecheck 4 program + vitest全量 + build未跑（watch互斥，构建门禁由用户确认时执行））；真实浏览器E2E（playwright + 系统Edge）通过：FAB/浮窗渲染、会话绑定、模板保存、拖拽生成节点、刷新持久化、模板删除隔离、组合管理MCP显示playwright。
   - 工程：MCP挂载——官方@deepseek-ai/dsh-mcp-client标准行（serverName: playwright）写入profiles/web/cordis.patch.yml托管区，与组合管理mcp-registry输出格式一致；3081组合管理UI确认工具正常显示；@playwright/mcp为devDependencies（仅开发验证用），浏览器复用系统Edge（--executable-path）。

## 2026.08.24

git版本：[未提交] [v0.1.0]（P13 UI 重构：按需求 §4.5 + 旧项目 界面分栏设计 照搬改造）
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




---
> 下述日志已压缩（AI自动维护，根据每次最新读取时间，超时2天自动压缩过期日志，以此为界限，作为记录）
> 压缩状态：已压缩（压缩完成后更新）
> 压缩时间：2026.08.25


git版本：[eb0d744] [v0.1.0]（P13 完成，与P12/P14/P15批次提交）  
  - 完成：P13 属性栏 + 控制栏 + 运行历史（T-045～T-047）。  
  - T-045：Inspector 按对象分发表单（工作流/角色节点/模板/文件/数据库/协作组/连线/阶段/虚拟节点），底部保存/删除作用于当前选中；状态机扩展 NODE_PATCHED / EDGE_PATCHED / WORKFLOW_PATCHED。  
  - T-046：画布控制栏（撤销/重做/清空二次确认可撤销、整理布局、保存/运行/停止、模式切换带未保存守卫）。  
  - T-047：运行历史弹层（列表+详情，可恢复徽标及恢复按钮，resumedFromRunId 继承链）。  
  - 工程：i18n 新增键、样式、client watch 构建（tsdown --watch + HMR）。  
  - 测试：新增 38 用例，全量 577 全绿；变更标注：开发期以 dsh --profile web --patch 起调试实例，不落盘。

git版本：[未提交] [v0.1.0]（P12 完成）  
  - 完成：P12 画布 + 左侧栏（T-043～T-044）。  
  - T-043：SVG 无限画布（平移/缩放/点阵网格/fitView）、节点按 kind 样式（父代理金色、阶段只读、虚拟节点虚线+引用角标、协作组卡片）、贝塞尔连线（三通道配色+条件标签+拖线草稿）、拖拽连线校验（client 独立实现，语义与 host validate 一致）、运行高亮（徽标）、节点拖拽/组拉伸/Delete 删除。  
  - T-044：左侧栏五 Tab（含 other），角色 Tab 父代理置顶，other 内置阶段/协作组；拖拽模板到画布（5px 阈值、坐标换算、深拷贝断引用）；新建模板/工作流，点击模板选中编辑，工作流切换带未保存守卫。  
  - 状态机扩展：LibTab + 'other'、GROUP_RESIZED、虚拟节点投影；i18n/样式新增。  
  - 测试：新增 56 用例，全量 512 全绿。

git版本：[2f57125] [v0.1.0]（P11 里程碑5 Client 入口与 Studio 状态机）  
  - 完成：T-041 浮窗入口（右下 FAB → 独立窗口型页面，可拖动/缩放/几何 localStorage 记忆） + T-042 Studio/状态机/hooks 拆分。  
  - studio-state.ts：纯 reducer（列表/画布/选中/dirty/撤销栈/运行快照等）；13 个 hooks（useWorkflows/useTemplates/useGraphHistory/useUnsavedGuard/useRunControl 等）；Studio.tsx 骨架（三栏+状态条），会话绑定跟随当前会话，运行先保存。  
  - i18n/样式适配；remote.ts 端点引用 EP_* 常量。  
  - 工程：tsconfig.test.client.json、typecheck 扩四 program、rootDir 扩 src、.gitignore 锚定 /lib/、build超时 120s。  
  - 测试：新增 41 用例，全量 490 全绿；变更标注：入口改版同步需求/架构文档。

git版本：[837166f] [v0.1.0]（P10 模式二服务全链路）  
  - 完成：T-031 服务管理（启动/停止/恢复/端口池）、T-032 服务进程入口（service-runner + OpenAI 兼容 API，SSE/非流式，鉴权，并发429，断点续跑）、T-033 userId 会话映射（内存+磁盘持久化）。  
  - 工程：flow-store 增服务查询接口，serve.patch 渲染收敛。  
  - 测试：新增 67 用例，全量 449 全绿；变更标注：模式二与主进程共享数据层，skipReconcile 防破坏。

git版本：[470d5a2] [v0.1.0]（P09 GUI API层与断点续跑）  
  - 完成：T-027 resume.ts（buildResumedSnapshot、findResumableRun、resumeRun 复用校验链） + T-026 remote/四文件（API 白名单 39 端点、download/MCP/transfer、bundle 导入导出 v2）。  
  - 工程：flow-store 加 getTemplate/listTemplates，乐观锁。  
  - 测试：新增 28 用例，全量 382 全绿；变更标注：deleteTemplatePreview 返回 affectedNodes=0+detached。

git版本：[804f266] [v0.1.0]（P08 Agent间通信）  
  - 完成：wf_ask_agent 三态协议（ask/reply/resolve），插队投递，强校验（运行锁/childIndex/会话归属），超时处理，终止释放挂起 ask，同发起者重复拒绝 WF_BUSY。  
  - 编排指令补充硬约束第8条；测试新增 24 用例，全量 354 全绿；注释规范清理。

git版本：[9b74c77] [v0.1.0]（BUG排查修复）  
  - 修复 B1（buildNodeBlocks 增加 snapshot 参数）、B2（handleSubagentEnd 标记组 ok）、B3（terminateRun 终态释放 runs 表）。F1~F4 查证为未开发功能不修复。  
  - 测试新增 5 用例，全量 330 全绿；变更标注：终态释放后 wf_run_node 返回 WF_NO_ACTIVE_RUN。

git版本：[d71d630] [v0.1.0]（P07 工具注册与数据工具）  
  - 完成：T-023 工具注册（wf_run_node/wf_finish/wf_ask） + T-025 embedding 与数据工具（chunker、EmbeddingService（外部>本地bge-small>BM25）、VectorIndex 双模式、wf_db_query 三模式 + SQL 只读白名单，SqliteDriver/ServerDriver）。  
  - 工程：package.json 增 mysql2/pg optional；测试新增 75 用例，全量 325 全绿；注释移除文档章节引用。

git版本：[a294845] [v0.1.0]（P06 子代理管理与护栏）  
  - 完成：agent/runner.ts（ensureNodeChild/startNodeTask/interruptChild/consumeReactCapped/childVisibilityContribution + resolveAgentTools 白名单）、guards.ts（ReAct软截停）、model-selection.ts（双瀑布+身份匹配）。  
  - 装配三项 registerContinuableSetup；编排器联动 consumeReactCapped/handleSubagentEnd。  
  - 测试新增 34 用例，全量 249 全绿；官方取证写入文件头，真实 harness 由 T-063 验证。

git版本：[6b6e69f] [v0.1.0]（P05 编排核心）  
  - 完成：orchestrator/snapshot.ts、runtime.ts（运行锁/startRun/wfRunNode/wfFinish幂等/subagent-end回写/护栏500+重试上限/WF_*错误码/双向同步/terminate/stop/dispose）、watchdog.ts（空闲看护/父代理回合/重启 reconcileStaleRuns）。  
  - DI 缝：NodeRunner接口+占位，AgentHost适配；编排指令/任务块装配。  
  - 测试 orchestrator 54 用例，全量 214 全绿；snapshot 无 stopped，pause门持久化，虚拟节点解析为主节点记账。

git版本：[912876b] [v0.1.0]（P04 FlowStore数据层+Host装配）  
  - 完成：T-012 flow-store 全 CRUD（workflows/services/sessionId隔离/全局/runs/combos/userId映射/orchestrations事实源）+ revision乐观锁+templateToNode深拷贝（17用例） + T-015 index.ts装配FlowStore+subagent/end+agent/error观察+ctx.effect dispose骨架（4用例）。  
  - 工程：新增 tsconfig.test.json；typecheck三program；测试全量 160 全绿。

git版本：[d5d346a] [v0.1.0]（P03 原子存储+图模型校验+共享契约）  
  - 完成：T-011 atomic.ts 八 API（open('wx')、磁盘锁+陈旧回收、锁序固定，19用例） + T-013 graph/model.ts（9类节点+工厂+拓扑助手）+ validate.ts（自环/重复/通道配对/主虚互斥/协作组边界/阶段唯一/父代理唯一/模式差异/归一化，41用例） + T-014 shared 三文件纯类型零运行时（29用例）。  
  - 变更标注：FileNode/DatabaseNode补label必填；主代理完成T-013后不再分发；全量 139 全绿。

git版本：[3119869] [v0.1.0]（P02 挂载层+构建链路+模型资产+提示词基线）  
  - 完成：T-002 cordis.patch.yml + src/host/index.ts官方入口（z来自@deepseek-ai/schemastery） + T-003 tsdown客户端构建（__ModuleLoader__/style/purity/sourcemap/声明发射+smoke） + T-004 embedding-model.mjs幂等资产（bge-small-zh-v1.5 onnx） + T-005 prompts基线三构建器（编排指令/节点任务块/协作Prompt），markers.ts消除循环import。  
  - 测试 50 全绿；变更标注：@deepseek-ai/schemastery进peer；vitest --pool=threads；dsh plugin add需pnpm-workspace.yaml allowBuilds=false。

git版本：[87f4e0e] [v0.1.0]（P01 项目骨架与包配置）  
  - 完成：T-001 package.json（exports/files/dsh.bundle/dsh.client，零@deepseek-ai/*运行时）、tsconfig双program、scripts/build.mjs、cordis/serve占位、目录骨架；tests/host/package-contract.test.ts（18用例）断言契约与W-05；vitest --pool=threads。  
  - 变更标注：@huggingface/transformers@^4.2.0唯一运行时依赖；pnpm-workspace.yaml allowBuilds=false抑制onnxruntime构建脚本。