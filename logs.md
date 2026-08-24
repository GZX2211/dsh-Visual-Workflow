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
## 2026.08.24

1. git版本：[804f266] [v0.1.0]
   - 完成：P08 里程碑 2 Agent 间通信（T-024 wf_ask_agent 三态协议）。
   - 交付（src/host/tools/wf-ask-agent.ts 新建 + runtime.ts 扩展）：
     - 三态协议：ask（子代理发起并挂起阻塞等待回复）/ reply（目标回复解除阻塞，工具结果=回复文本）/ resolve（父代理对超时 ask 裁决 continue/resend/abort，仅父代理可用）。
     - 插队投递：目标在线 → agent.steer（next-step 边界插入，source={kind:'coordinator', form:'relay', senderSessionId}，官方 merge-extensible 扩展 kind）；目标冷态 → 回退官方 subagents.followup 冷恢复（父 root 授权）。
     - 强校验（越权拒绝）：运行锁 + childIndex 表内所有权（发起者与目标均须为本运行节点子代理，跨会话/陌生 childId 拒绝）+ 会话归属，全程写审计（内存审计链 + 宿主日志）。
     - 超时（默认 120s，wfAskAgentTimeoutMs 可配置）：超时详情（askId/请求参数/目标代理 id）steer 注入父代理；父代理 ask_user_question 征询用户后 resolve 三动作——continue 重启计时（A 继续挂起）/ resend 重发 / abort 让 A 以 WF_ASK_AGENT_TIMEOUT 继续。
     - 生命周期：运行终止/插件卸载时挂起 ask 全部以 WF_CANCELLED 释放（terminateRun/dispose 接入 rejectAsks）；同发起者挂起中重复 ask 拒绝 WF_BUSY；未超时 resolve 拒绝 WF_ASK_NOT_TIMED_OUT。
     - 编排指令补充硬约束第 8 条：收到超时通知用 ask_user_question 征询并 resolve。
   - 测试：新增 24 用例（wf-ask-agent.test.ts：正常链路/越权 R-04 矩阵/超时裁决三动作（fake timers）/冷态回退/终止释放/审计事件）；全量 354 用例全绿（18 文件），typecheck 三 program + build + client-smoke 通过。
   - 变更标注：注释规范持续执行——runtime.ts / orchestration.ts 全量清理文档章节与任务编号引用（本次修改文件顺手清理，其余文件留待后续修改时清理）。

2. git版本：[9b74c77] [v0.1.0]
   - 完成：BUG 排查报告逐项查证与修复（docs/bug排查.md，B1~B3 修复；F1~F4 查证为按计划未开发功能，不修复）。
   - 修复交付（src/host/orchestrator/runtime.ts）：
     - B1：buildNodeBlocks 增加 snapshot 参数，ctx-in 的 agent/parent/虚拟节点引用按快照读取最终产出（status=ok/react-capped，documentTextLimit 截断，来源标签=labelOf；fail/pending 无产出不注入）。
     - B2：handleSubagentEnd 完成后调用 markGroupOkIfComplete——成员全部 ok/react-capped 时组卡片 pending→ok（单向推进不回退，只影响回显不干预父代理调度）。
     - B3：terminateRun 成功与 wfFinish 完成路径均从 runs 表释放终态条目（running/paused 保留——续跑/锁查询需要）；wfFinish 幂等判定改查磁盘历史（listAllRunIds+getRun，收尾调用频率极低）。
   - 测试：新增 5 用例（B1×3：ok 注入+截断/来源标签、fail/pending 不注入+无连线不传、虚拟节点解析注入；B2×1：组聚合含 react-capped 成员与失败不回退；B3×1：终态释放+幂等磁盘查询+paused 保留）；全量 330 用例全绿（17 文件），typecheck/build/client-smoke 通过；并发测试（atomic/flow-store）在全量并行时曾偶发时序失败，单独/连续三次全量均稳定全绿（与本次修改无关，未改动相关代码）。
   - 变更标注：终态条目释放后，「已结束运行」再调 wf_run_node 由 WF_STOPPED 收敛为 WF_NO_ACTIVE_RUN（内存无法区分已结束/从未运行，保持高频路径零磁盘开销；wf_finish 幂等仍返回终态详情）。

2. git版本：[d71d630] [v0.1.0]
   - 完成：P07 工具注册与数据工具（T-023/T-025，主代理本人实现）——T-022 的出口：三个父代理编排工具 + 本地嵌入/数据访问全链路。
   - T-023 交付：src/host/tools/ 三文件——define-tool.ts（官方 defineTool DSL 语义的本地等价实现：parameters 隐式开放根 + 属性内联 required 编译为 JSON Schema required 数组；零官方包运行时依赖 W-05）；text-render.ts（递归按键排序的稳定序列化，键序稳定 W-01）；wf-tools.ts（registerWfTools 注册 wf_run_node/wf_finish/wf_ask + callerOf 身份派生——子代理会话 header 的 origin/parentSession 判据；wf_run_node 扩展 wait/thinking/iterationLimit/retryLimit 参数透传 + 暂停门并入；wf_ask 借用官方 userQuestions.ask（agent=父 root 精确存活身份），提问期间 touchRun 防空闲看护误停；description 官方标准英文 W-03 ≤120 tokens）。runtime.ts 增 touchRun；index.ts 装配（agents 提为 public 属性 + ctx.effect 注册）。
   - T-025 交付：src/host/embedding/ 三文件——chunker.ts（384 字符/步长 128 重叠窗口分块纯函数 + 空白归一化）；engine.ts（EmbeddingService：外部 OpenAI 兼容端点 > 本地 bge-small-zh-v1.5（transformers.js pipeline feature-extraction，pooling cls + normalize，512 维，随包资产路径定位，真机加载验证通过）> BM25 降级，惰性加载重依赖）；indexer.ts（VectorIndex 单文件原子持久化 + 逐记录分块 + embedding 余弦 Top-K / BM25 倒排打分双模式，降级标注 source='bm25'）。data-tools.ts：wf_db_query 单工具三模式（search/query/schema）+ SQL 只读白名单（仅单 SELECT/强制 LIMIT/拒绝写 DDL 多语句/字面量剥离防误伤）+ SqliteDriver（node:sqlite readOnly 物理防写）+ ServerDriver（mysql2/pg 可选依赖惰性 import）+ buildIndexForDatabase/testDatabaseConnection + 归属校验（运行中 run + db-in 连线，无连线 WF_DB_NO_LINE）。
   - 工程变更：package.json 增 optionalDependencies mysql2/pg（W-05 折中：dependencies 仍仅 transformers，服务器驱动可选安装、惰性加载；契约测试断言记录）；@types/pg 进 devDependencies；cordis-patch 旧测试更新（移除 T-015 残留断言，改为装配行为断言）。
   - 测试：新增 75 用例（wf-tools 30 + embedding 21 + data-tools 24）；全量 325 用例全绿（17 文件），typecheck 三 program + build + client-smoke 通过；EmbeddingService 真机加载验证（source=local 512 维归一化）。
   - 变更标注：注释规范调整——自本阶段起代码注释移除对文件/文档章节的引用（遵循最新注释规范）；wait 阻塞测试揭示启动竞态（subagent/end 需在 childIndex 登记后派发，测试用 vi.waitFor 等待）。

---
> 下述日志已压缩（AI自动维护，根据每次最新读取时间，超时2天自动压缩过期日志，以此为界限，作为记录）
> 压缩状态：已压缩（压缩完成后更新）
> 压缩时间：2026.08.24

1. git版本：[a294845] [v0.1.0]
   - 完成：P06 子代理管理与护栏（T-022）——执行引擎。
   - 交付：src/host/agent/ runner.ts（ensureNodeChild/startNodeTask/interruptChild/consumeReactCapped/childVisibilityContribution + resolveAgentTools白名单（wf_run_node/wf_finish剔除）+ CordisToolsView）、guards.ts（ReAct软截停：agent-pre-step计步+工具拒绝）、model-selection.ts（installModelSelection双瀑布+WeakMap身份匹配）。
   - index.ts装配三项registerContinuableSetup贡献；NodeAgentRunner替代占位；host.dispose清理。
   - 编排器联动：consumeReactCapped；handleSubagentEnd标记react-capped；snapshot.setNodeStatus回写output。
   - 与旧项目差异：删除自动追加wf_ask；minimal/ptc硬编码被preset解析取代；wf_run_node/wf_finish白名单剔除。
   - 测试：新增34用例（agent-runner 19 + guards 8 + model-selection 7）+ orchestrator增react-capped用例；全量249全绿。
   - 变更标注：官方取证写入文件头；真实harness行为由T-063验证。

2. git版本：[6b6e69f] [v0.1.0]
   - 完成：P05 编排核心（T-021）——里程碑1「host侧跑得起来」。
   - 交付：src/host/orchestrator/ snapshot.ts（快照纯函数）、runtime.ts（OrchestratorRuntime：运行锁/startRun/wfRunNode/wfFinish幂等/subagent-end回写/护栏500次上限+重试上限+WF_*错误码/currentResolvedFlow双向同步/terminate/stop/dispose）、watchdog.ts（空闲看护/父代理回合终态/重启reconcileStaleRuns）。
   - DI缝：NodeRunner接口+占位，AgentHost适配；官方取证§8 #1/#21/#22写入头注释。
   - 编排指令/节点任务块装配：facts满足W-01/W-02；注入消息带id+source。
   - 事件声明收窄；index.ts装配watchdog + reconcile + agent/error快速路径。
   - 测试：orchestrator.test.ts 54用例状态机全覆盖；全量214全绿。
   - 变更标注：snapshot词表无stopped；pause门run=paused+resumeFromNodeId持久化；虚拟节点wf_run_node解析为主节点记账。

3. git版本：[912876b] [v0.1.0]
   - 完成：P04 FlowStore数据层+Host装配（T-012/T-015）。
   - T-012：flow-store.ts全CRUD（workflows/services/sessionId隔离、roles/data全局、runs单文件、combos、userId映射、orchestrations事实源）+ revision乐观锁+templateToNode深拷贝；17用例（并发/隔离/冲突）。
   - T-015：index.ts装配FlowStore+subagent/end+agent/error观察（events.d.ts本地增强）+ ctx.effect dispose骨架；真实Context单测4用例（启动/目录/冲突/卸载）。
   - 工程：新增tsconfig.test.json；typecheck扩展三program；graph工厂返回精确类型。
   - 测试：160全绿。

4. git版本：[d5d346a] [v0.1.0]
   - 完成：P03 原子存储+图模型校验+共享契约（T-011/T-013/T-014）。
   - T-011：storage/atomic.ts八API（atomicWriteJson/readJson/withFileLock/acquireDiskLock/releaseDiskLock/withJsonLock/atomicReplaceFile/cleanupStaleTemp）——open('wx')、磁盘锁+陈旧回收、锁序固定、CorruptJsonError；19用例全绿；@types/node入devDeps。
   - T-013：graph/model.ts（9类节点+工厂+拓扑助手）+ validate.ts（自环/重复/通道配对/条件仅流程线/主虚互斥/协作组边界/阶段唯一/父代理唯一/模式差异/归一化/missingStageNodes）；41用例全绿。
   - T-014：shared三文件（graph-model/types/protocol）纯类型零运行时+29用例（端点比对/工具可见性/纯度门）。
   - 变更标注：FileNode/DatabaseNode补label必填；主代理完成T-013后不再分发。
   - 测试：139全绿。

5. git版本：[3119869] [v0.1.0]
   - 完成：P02 挂载层+构建链路+模型资产+提示词基线（T-002/T-003/T-004/T-005）。
   - T-002：cordis.patch.yml 13键 + src/host/index.ts官方Service入口（z来自@deepseek-ai/schemastery，peerDep；ctx.effect清理）；Loader验证通过。
   - T-003：tsdown 0.22.14客户端构建（__ModuleLoader__包装/style/purity gate/sourcemap）+ client声明发射+smoke冒烟；check/verify扩展。
   - T-004：embedding-model.mjs幂等资产；assets/models/bge-small-zh-v1.5齐备（onnx/model_quantized.onnx 24MB，源自Xenova社区+hf-mirror）；manifest含sha256。
   - T-005：prompts基线三构建器（编排指令/节点任务块/协作Prompt），W-01/W-02约束，动态值仅入尾段；markers.ts消除循环import。
   - 测试：50全绿（cordis-patch 9 + build-artifacts 5 + embedding-assets 6 + prompts-baseline 12）。
   - 变更标注：@deepseek-ai/schemastery进peer；vitest --pool=threads；`dsh plugin add`需profile的pnpm-workspace.yaml设allowBuilds=false。

6. git版本：[87f4e0e] [v0.1.0]
   - 完成：P01 项目骨架与包配置（T-001）——package.json插件契约（exports/files/dsh.bundle/dsh.client，零@deepseek-ai/*运行时依赖）、tsconfig.host/client双program、scripts/build.mjs（tsc双发射）、cordis/serve patch占位、目录骨架、.gitignore/.gitattributes。
   - 完成：tests/host/package-contract.test.ts（18用例）断言包契约与W-05；vitest --pool=threads。
   - 变更标注：@huggingface/transformers@^4.2.0唯一运行时依赖；pnpm-workspace.yaml allowBuilds=false抑制onnxruntime构建脚本。