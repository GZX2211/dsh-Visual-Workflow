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

## 2026.08.28

- git版本：[d279a62] [v0.1.0] [13:30]（bug 清单核验修复：模式二 db-in 注入 / 软截停时序 / SQL 字面量分号 / chunker 非法参数 / 服务管理冗余与文档对齐 / groups 往返语义 / 临时文件并发安全）
  - 【子代理：bug 查验与修复专家（清单 P0-P3 共 11 项）】先验后修逐项核验：LEGIT 修复 7 项 + 非功能缺陷改文档 2 项 + 无实际影响不改 1 项 + UNCLEAR 1 项。修复：①P0 模式二 db-in 失效——hasDbInLine 固定 getWorkflow 读 workflows/，模式二服务文档在 services/ 恒 null → wf_db_query 永不注入；ResolveToolsInput/NodeStartInput 增 mode，按 mode 分派 getServiceAsFlow/getWorkflow（与 currentResolvedFlow 同源），runtime 调用点传 run.snapshot.mode；②P1 软截停时序——复用路径 setLimit 在 followup（await）之后、新回合首步 pre-step 读旧上限；setLimit 前移到任何 await 之前 + 创建路径 startContinuable resolve 后同步块内立即登记；③P2 SQL 分号误判——多语句检查在剥离字符串字面量之前，`SELECT 'a;b'` 被误拒；先剥离字面量再查分号（真实多语句仍拒绝）；④P3 chunker 资源放大——overlap≥chunkSize 旧实现步长钳 1 生成巨量块，改 fail-fast 抛 RangeError；⑤P2 manager.status 冗余三元删除；⑥P3 download/mcp-registry 临时文件仅 pid 无随机后缀，加随机后缀 + download rename 短重试（Windows 并发替换 EPERM）；⑦P1 transfer.groups 往返不一致——export 导出 groups 但 import 未重建且返回虚报 importedGroups；groups 已内联在工作流节点、store 无 group 模板类（TemplateKind 仅三类、client「其他」Tab 为静态入口），改返回实际导入数 importedTemplates + 注释/文档对齐。非功能缺陷改文档：P1 spawnChild fork 命令未传 --visual-workflow-serve/--port 实为 config 域传递（service-runner 回退 config 工作正常，测试已固化），架构文档 §4.7/§7 fork 命令描述对齐实际；P1 groups 语义架构文档 §4.6/§6.4 对齐。无实际影响不改：P3 combinedSignal 降级分支（Node 20+ 必有 AbortSignal.any，分支不可达）。UNCLEAR：P3 prompt-setup section text 函数形式——官方 API 契约无法从项目内证实，已有 try-catch 降级，既有测试以函数形式为契约，不修。
  - 【回归测试】agent-runner：模式二 db-in 注入 wf_db_query（含无连线不注入）+ 复用路径 setLimit 先于 followup（时序断言）；data-tools：字面量内分号接受、真实多语句仍拒绝；embedding：overlap≥chunkSize 抛 RangeError；新增 download.test：并发同目标写入各写独立临时文件、最终为某次完整内容、无 .tmp 残留。typecheck 4 program 通过；全量 vitest 603/603 全绿（atomic.test 曾整批并行偶发 EPERM，单独/重跑均通过，属 Windows 文件锁环境性抖动，与该改动无关）。

- git版本：[f9e72c0] [v0.1.0] [13:05]（shared 契约批次 5 项核验修复：RUN_STATUSES 去 pending、RoleNode 去冗余 proxySourceId、协作 Prompt 注释对齐、架构文档补齐）
  - 【子代理：bug 查验与修复专家（shared 契约 5 项）】先验后修逐项核验：全部 LEGIT。① RUN_STATUSES 含 'pending' 与 RunStatus/§6.1/需求 §4.7 规则 3 不一致——run 快照创建即 running、不存在「排队/待启动」持久化中间态，从协议常量移除 pending，测试断言改六态并新增编译期守卫（RUN_STATUSES 全元素须属 RunStatus）防漂移，架构文档 §4.3 状态机去 pending 并注明 pending 仅为节点级语义；② RoleNode.data.proxySourceId 冗余——虚拟节点引用已由 ProxyNode 顶层 proxySourceId 承载，删除该字段及全部默认值/复制（graph/model.ts、validate.ts、flow-store.ts、client/lib/graph-model.ts、11 个测试字面量），新增编译期回归守卫，架构文档 §4.2 同步删除并补充 ProxyNode 定义；③ GroupNode/GroupTemplate 的 collabPrompt JSDoc 误写「追加到 System Prompt 末尾」——按需求 §4.2.5.2 规则 2/架构 §13.1 第 4 条/实际实现（collab.ts buildCollabBlock 追加首条用户消息）修正注释；④ 架构文档 §4.6 端点清单补 serviceDebug/fileUpload（功能/测试早已存在，纯文档遗漏）、§3 目录补 remote/ 文件列表；⑤ 架构文档补 WorkflowDocument 接口定义（id/sessionId/mode/name/description/nodes/lines + revision/createdAt/updatedAt，与 graph-model.ts 对齐）。
  - 【回归测试】shared-contract.test：RUN_STATUSES 六态 + 类型守卫、RoleNode.data 无 proxySourceId 编译期守卫；删除 11 个测试文件角色节点 data 字面量中的 proxySourceId。typecheck 通过；全量 vitest 594/594 全绿（含 build-artifacts 客户端构建）。

- git版本：[705ff50] [v0.1.0] [02:52]（bug 清单 13-22 核验修复：错误码契约、服务启停返回完整状态、协作组拉伸/左栏拖拽监听清理）
  - 【子代理：bug 查验与修复专家（清单 13-22，10 项）】先验后修逐项核验：LEGIT 2 项并修复 + 修正定位 1 项 + NOT LEGIT 7 项（描述与现码不符）。修复：20 错误码契约（后端路由错误响应补 code 字段、前端 remoteCall/streamCall 把 code 挂到抛出的 Error，调用方可按码分支，如 FLOW_REVISION_CONFLICT 自动刷新）；22 serviceStart/serviceStop 返回「文档为基 + manager 运行时字段合并」的完整 ServiceState（原返回 {serviceId,status,port,pid} 残缺对象，SERVICE_UPDATED 按 id 键不匹配静默空操作→启停后状态永不刷新）；14 修正定位（清单指向 beginConnection 有误，实际已由 useEffect 清理；真实隐患在 beginGroupResize 与 beginLibraryDrag 直接在 callback 注册 window 监听仅 onUp 移除→卸载/pointercancel 泄漏）：前者改 state+useEffect 管理（卸载自动清理），两者均补 pointercancel/blur 兜底（Bug 7 同款）。NOT LEGIT：13 saveTemplate 无 null 路径；15 CLEAR_CANVAS 已清 selection/editor；16 已有 ?? kind 兜底；17 面板仅拖拽开合无跳变路径；18 serializeWorkflow 经 JSON 序列化断引用+reducer 不可变；19 wfFinish 先持久化终态再释放内存、findResumableRun 仅认 paused/interrupted；21 _draft 剥离为设计语义。
  - 【回归测试】api.test：serviceStart/stop 合并返回完整 ServiceState + 路由错误响应携带 code（FLOW_REVISION_CONFLICT→409+code）；remote.test：抛出 Error 携带 code；新增 graph-canvas.test.tsx：卸载/pointercancel 后监听清理（onGroupResize 不再触发）。typecheck 通过；全量 vitest 593/593 全绿（含 build-artifacts 客户端构建）。

- git版本：[90d3b30] [v0.1.0] [02:08]（bug 清单11-27 与第二批 10 项核验修复；编排/节点/协作提示词中文化；子代理标题改用节点名称）
  - 【子代理：bug 查验与修复专家（清单 11-27，16 项）】全部核验为 LEGIT 并最小改动修复+回归测试：11 manager.start 并发竞态（starting 互斥集合防并发 spawn/端口泄漏）；12 persistRuntime 失败回滚（kill+forget+抛 WF_SERVICE_START_FAILED）；13 cleanupStaleTemp 误删（tempFileOwnerPid 判活跳过）；14 listRuns 跨会话泄露（可选 sessionId 过滤，runHistory 强制 sessionId）；15 normalizeFlow 丢 files 多选；16 exportWorkflowBundle 缺模板（补 roles/files/databases + importEmbeddedTemplates）；17 UNDO/REDO dirty 硬编码（savedGraph+MARK_SAVED+graphSnapshotsEqual 精确判定）；18 highlightedNodeIds 死代码删除；19 max-tokens 视为成功（仅 stopReason==completed 算 ok）；20 currentResolvedFlow 读错文档（按 snapshot.mode 分派）；21 interrupted 恢复无起点（推断 resumeFromNodeId）；22 runChat 无限轮询（sseTimeoutMs 5 分钟 + 504）；23 streamResponse 未监听断开（AbortController+client_closed）；25 flowLayout 重复实现（统一走 lib layoutNodes）；26 templateToNode 丢字段（补 systemPromptSource/fileName）；27 幽灵组员未报错（groupGhost 校验）。typecheck/build 通过；测试仅 prompts-baseline 因「Report Summary 约束已删」的既有基线失败（非本清单项）。
  - 【子代理：bug 查验与修复专家（第二批 10 项）】7 LEGIT 已修复 + 3 UNCLEAR（项1 loadTemplates 无 session 也会执行与清单不符；项6 selectLibraryCard 顺序实际符合需求；项10 useRunPolling 已有 cancelled 检查）。修复：2 投影/序列化保留 proxySourceId；3 提取 parseSseDelta（正文取 choices[0].delta.content）；4 NODE_REMOVED 级联删除 proxy；5 loadTemplates 聚合返回+去冗余查询+创建后 cancelled 检查；7 beginResize 补 pointercancel/blur；8 UNDO/REDO 后 sanitizeSelectionAfterCanvas；9 loadTemplates 改 Promise.allSettled。新增回归测试：studio-state/service-console(parseSseDelta)/serialize-workflow/service-console.tsx。typecheck/build 通过；588/589（同上 prompts-baseline 基线）。
  - 【提示词中文化】orchestration.ts / node-task.ts / collab.ts 构建器输出正文转中文（面向模型），保留工具名 wf_run_node/wf_finish/wf_ask_agent/wf_db_query 与技术词 System Prompt/allow-list/ReAct 为英文；移除 node-task 的 report 回传结论约束（用户已删）；README.md 新增「0. 语言约定」对齐现状；动态状态字段（重试上限/ReAct 迭代上限等）同步中文化。
  - 【子代理标题】runner.ts 的 label 由 visual-workflow:<flowId>:<nodeId> 改为 node.data.label（如「bug 查验与修复专家」），空值回退旧格式。
  - 【测试同步】prompts-baseline（移除 report、断言改中文、全角冒号）、orchestrator（4 处）、resume（3 处）、service-run（2 处）、agent-runner（1 处）同步中文断言；全量 vitest 589/589 全绿；typecheck/build/client-smoke 通过。

