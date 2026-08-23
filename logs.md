# logs.md — Visual Workflow 开发日志（总览）

> 标准示例，AI 据此填写，每次任务作为项目上下文注入

**版本号通用规则**

- 版本（X.Y.Z）。含义如下：
  - 主版本号 (X)：做不兼容 API 修改时递增。注意： 主版本号为 0（如 0.x.x）代表项目处于开发初始阶段，接口随时可能改变，不算稳定版。此项目处于该阶段。
  - 次版本号 (Y)：向下兼容的功能性新增时递增。
  - 修订号 (Z)：向下兼容的 Bug 修复时递增。

## 2026.08.24

1. git版本：[d71d630] [v0.1.0]
   - 完成：P07 工具注册与数据工具（T-023/T-025，主代理本人实现）——T-022 的出口：三个父代理编排工具 + 本地嵌入/数据访问全链路。
   - T-023 交付：src/host/tools/ 三文件——define-tool.ts（官方 defineTool DSL 语义的本地等价实现：parameters 隐式开放根 + 属性内联 required 编译为 JSON Schema required 数组；零官方包运行时依赖 W-05）；text-render.ts（递归按键排序的稳定序列化，键序稳定 W-01）；wf-tools.ts（registerWfTools 注册 wf_run_node/wf_finish/wf_ask + callerOf 身份派生——子代理会话 header 的 origin/parentSession 判据；wf_run_node 扩展 wait/thinking/iterationLimit/retryLimit 参数透传 + 暂停门并入；wf_ask 借用官方 userQuestions.ask（agent=父 root 精确存活身份），提问期间 touchRun 防空闲看护误停；description 官方标准英文 W-03 ≤120 tokens）。runtime.ts 增 touchRun；index.ts 装配（agents 提为 public 属性 + ctx.effect 注册）。
   - T-025 交付：src/host/embedding/ 三文件——chunker.ts（384 字符/步长 128 重叠窗口分块纯函数 + 空白归一化）；engine.ts（EmbeddingService：外部 OpenAI 兼容端点 > 本地 bge-small-zh-v1.5（transformers.js pipeline feature-extraction，pooling cls + normalize，512 维，随包资产路径定位，真机加载验证通过）> BM25 降级，惰性加载重依赖）；indexer.ts（VectorIndex 单文件原子持久化 + 逐记录分块 + embedding 余弦 Top-K / BM25 倒排打分双模式，降级标注 source='bm25'）。data-tools.ts：wf_db_query 单工具三模式（search/query/schema）+ SQL 只读白名单（仅单 SELECT/强制 LIMIT/拒绝写 DDL 多语句/字面量剥离防误伤）+ SqliteDriver（node:sqlite readOnly 物理防写）+ ServerDriver（mysql2/pg 可选依赖惰性 import）+ buildIndexForDatabase/testDatabaseConnection + 归属校验（运行中 run + db-in 连线，无连线 WF_DB_NO_LINE）。
   - 工程变更：package.json 增 optionalDependencies mysql2/pg（W-05 折中：dependencies 仍仅 transformers，服务器驱动可选安装、惰性加载；契约测试断言记录）；@types/pg 进 devDependencies；cordis-patch 旧测试更新（移除 T-015 残留断言，改为装配行为断言）。
   - 测试：新增 75 用例（wf-tools 30 + embedding 21 + data-tools 24）；全量 325 用例全绿（17 文件），typecheck 三 program + build + client-smoke 通过；EmbeddingService 真机加载验证（source=local 512 维归一化）。
   - 变更标注：注释规范调整——自本阶段起代码注释移除对文件/文档章节的引用（遵循最新注释规范）；wait 阻塞测试揭示启动竞态（subagent/end 需在 childIndex 登记后派发，测试用 vi.waitFor 等待）。

1. git版本：[a294845] [v0.1.0]
   - 完成：P06 子代理管理与护栏（T-022，主代理本人实现）——T-021 的执行引擎。
   - 交付：src/host/agent/ 三文件——runner.ts（NodeAgentRunner：ensureNodeChild（startContinuable 创建/childKey 复用/签名 person+provider+model+reasoning+presetId+tools 变化即重建）/startNodeTask（followup 派发，coordinator/relay source）/interruptChild/consumeReactCapped/childVisibilityContribution（tools.restrict deny wf_run_node/wf_finish 双保险）+ resolveAgentTools 白名单（combo∩可见+MCP 前缀；官方 preset 经 standingKeyFor 解析、服务缺失回退可见；wf_db_query 仅 db-in 连线注入；wf_run_node/wf_finish 无条件剔除）+ CordisToolsView（全局层∪存活 agent scope∪preset standing scope 并集，scope key 必须是 agent 对象——旧项目历史坑注释保留））；guards.ts（ReAct 软截停：agent/pre-step 计步→替换本步消息为强制收尾指令 + tools.guard 拒绝双保险，V-01 官方无 turn 预算取证）；model-selection.ts（installModelSelection 双瀑布零依赖移植 + WeakMap 身份匹配 attach——思考强度经 registerContinuableSetup 注入，V-02）。
   - index.ts 装配：三项 registerContinuableSetup 贡献（可见性/软截停/模型选择）归 ctx.effect；NodeAgentRunner 替代占位 runner；host.dispose 清理子代理表。
   - 编排器联动：NodeRunner 增 consumeReactCapped；handleSubagentEnd 标记 react-capped（非失败正常产出，wait 语义仍 ok）；snapshot.setNodeStatus 对 react-capped 同等回写 output。
   - 与旧项目行为差异（PRD §4.4.2 规则 7 定稿）：删除自动追加 wf_ask（无强制追加）；minimal/ptc 硬编码正则被真实 preset 解析取代；wf_run_node/wf_finish 白名单无条件剔除。
   - 测试：新增 34 用例（agent-runner 19 + guards 8 + model-selection 7）+ orchestrator 增 react-capped 用例；全量 249 用例全绿（14 文件），typecheck 三 program + build 通过。
   - 变更标注：官方取证写入文件头（§8 #1/#4/#5/#6/#7/#10/#21/#22——startContinuable/installModelSelection/agent-pre-step/tools.guard 语义逐条对照）；真实 harness 行为由 T-063 集成测试验证。

2. git版本：[6b6e69f] [v0.1.0]
   - 完成：P05 编排核心（T-021，主代理本人实现）——里程碑 1「host 侧跑得起来」。
   - 交付：src/host/orchestrator/ 三文件——snapshot.ts（快照纯函数：创建/节点状态更新/终态化/截断/lastAssistantText）、runtime.ts（OrchestratorRuntime：运行锁（runs 内存表单一事实源，running/paused 均保留锁）/startRun（校验→锁→事实源文件→编排指令 followup 注入→开始即落盘）/wfRunNode（异步默认/wait:true 阻塞/pause 门三路径）/wfFinish 幂等收尾/subagent-end 观察回写/护栏（全局 500 次上限+单节点重试上限+WF_* 稳定错误码）/currentResolvedFlow 双向同步/terminate/stop/dispose）、watchdog.ts（空闲看护/父代理回合终态/宿主重启 reconcileStaleRuns→interrupted 可恢复）。
   - DI 缝：NodeRunner（T-022 节点执行引擎接口+占位实现，真实 startContinuable 引擎待 T-022 装配）、AgentHost（CordisAgentHost：agents 服务结构适配）；官方取证 §8 #1/#21/#22（SubagentRunEndInfo/agent-error payload/startContinuable 契约）写入文件头注释。
   - 编排指令/节点任务块装配：facts（节点清单/协作组/暂停节点动态态仅入末段）满足 W-01/W-02（双位断言在单测中逐条验证）；注入消息带 id+source（旧项目父回合 UNKNOWN 失败根因）。
   - 事件声明收窄：events.d.ts 按官方取证改 unknown 可选形状；index.ts 装配 watchdog ctx.effect + reconcileStaleRuns + agent/error 快速路径。
   - 测试：orchestrator.test.ts 54 用例（状态机全覆盖：三路径/暂停门锁保留/幂等收尾/看护/对账/dispose）；全量 214 用例全绿（11 文件），typecheck 三 program + build 通过。
   - 变更标注：snapshot 节点状态词表无 stopped——被终止运行以 run 级状态区分、running 收敛 fail（续跑重试）；pause 门 run=paused+resumeFromNodeId 持久化+锁保留；虚拟节点 wf_run_node 解析为主节点 key（快照/attempts/waitKey 均按主节点记账）。

2. git版本：[912876b] [v0.1.0]
   - 完成：P04 FlowStore 数据层+Host 装配（T-012/T-015，主代理本人实现）。
   - T-012：flow-store.ts 全 CRUD（workflows/services 按 sessionId 隔离、roles/data 模板全局共享、runs 单文件、combos、userId 映射、orchestrations 事实源）+ revision 乐观锁（显式 expectedRevision，文档 revision 不隐式成为期望——比旧项目语义更收敛）+ templateToNode 深拷贝解耦；17 用例（并发写无垃圾/无撕裂/隔离/冲突）。
   - T-015：index.ts 装配 FlowStore+subagent/end+agent/error 观察（events.d.ts 本地增强——先 import 真实模块再 declare module，避免覆盖 exports-map 解析，已验证的陷阱）+ ctx.effect dispose 幂等骨架；真实 cordis Context 单测 4 用例（启动/目录结构/同名 service 冲突/dataDir 缺失失败/卸载清理）。
   - 工程变更：新增 tsconfig.test.json（host 测试进类型检查，不污染 lib/ 产物）；typecheck 扩展为三 program；graph 工厂返回精确节点类型；拓扑助手放宽 Partial 入参。
   - 测试：160 用例全绿（10 文件）。

3. git版本：[d5d346a] [v0.1.0]
   - 完成：P03 原子存储+图模型校验+共享契约（T-011/T-013/T-014）。
   - T-011：storage/atomic.ts 八 API（atomicWriteJson/readJson/withFileLock/acquireDiskLock/releaseDiskLock/withJsonLock/atomicReplaceFile/cleanupStaleTemp）——open('wx') 跨平台 no-clobber、磁盘锁+陈旧回收（mtime+死 pid 双条件）、锁序固定防死锁、CorruptJsonError 不静默；19 用例全绿；@types/node 入 devDeps、tsconfig.host.json types:["node"]。
   - T-013：graph/model.ts（9 类节点连接点矩阵/工厂/拓扑助手）+ validate.ts（自环/重复/通道配对/条件仅流程线/主虚互斥/协作组边界/阶段唯一/父代理唯一/模式差异/归一化/missingStageNodes）；41 用例全绿。
   - T-014：shared 三文件（graph-model/types/protocol）纯类型零运行时 import + 29 用例（端点 39 个逐字比对/工具可见性/纯度门）。
   - 变更标注：FileNode/DatabaseNode 按需求卡片设计补 label（数据库另有 description）必填字段（主代理在 T-014 基线上扩展）；主代理本人完成 T-013（此后不再分发子代理，后续任务由主代理直接实现）。
   - 测试：139 用例全绿（8 文件）。

4. git版本：[3119869] [v0.1.0]
   - 完成：P02 挂载层+构建链路+模型资产+提示词基线（T-002/T-003/T-004/T-005）。
   - T-002：cordis.patch.yml 13 键（§2.2 实际为 13 键，文档"14 键"为笔误）+ src/host/index.ts 官方 Service 形态入口（z 取自 @deepseek-ai/schemastery，进 peerDependencies；清理用 ctx.effect 而非 ctx.on('dispose')）；真实 Loader 验证：工作区内临时 DSH_HOME + `dsh plugin add file:` + `--dump-config` 出现 visual-workflow 层且入口可 import。
   - T-003：tsdown 0.22.14 客户端构建（__ModuleLoader__ 包装/style[data-plugin]/purity gate/sourcemap/host-client 产物并存）+ client 声明发射 + client-smoke 冒烟；check/verify 脚本扩展；lightningcss 显式 devDep。
   - T-004：embedding-model.mjs 幂等资产脚本；assets/models/bge-small-zh-v1.5 齐备（tokenizer/配置 + onnx/model_quantized.onnx 24MB，Xenova 社区仓库经 hf-mirror 镜像获取——本机 huggingface.co 不可达且 BAAI 官方仓库无 onnx 目录；transformers.js v4 固定 onnx/ 子目录，真机加载验证通过）；manifest 含 sha256。
   - T-005：prompts 基线三构建器（编排指令/节点任务块/协作 Prompt），W-01 前缀稳定 + W-02 约束双位 + 动态值仅入尾段；段落标记下沉 markers.ts 消除循环 import（主代理收口时重构）。
   - 测试：50 用例全绿（新增 cordis-patch 9 + build-artifacts 5 + embedding-assets 6 + prompts-baseline 12）。
   - 变更标注：@deepseek-ai/schemastery 进 peer（共享运行时，非运行时依赖）；vitest --pool=threads（沙箱 pipe EPERM 规避）；`dsh plugin add` 需 profile 的 pnpm-workspace.yaml 设 allowBuilds=false 才能 reconcile bundles（T-064 注意）。

5. git版本：[87f4e0e] [v0.1.0]
   - 完成：P01 项目骨架与包配置（T-001）——package.json 插件契约（exports/files/dsh.bundle/dsh.client，零 @deepseek-ai/* 运行时依赖）、tsconfig.host/client 双 program、scripts/build.mjs（host tsc 双发射：JS→lib/ + 声明→lib/types/）、cordis/serve patch 占位、目录骨架、.gitignore/.gitattributes。
   - 完成：tests/host/package-contract.test.ts（18 用例）断言包契约与 W-05；vitest 使用 --pool=threads（沙箱下 forks 池 pipe EPERM 规避）。
   - 变更标注：@huggingface/transformers@^4.2.0 声明为唯一运行时依赖；其 onnxruntime 硬依赖的构建脚本经 pnpm-workspace.yaml allowBuilds=false 抑制，T-004/T-025 时再评估。

## 2026.08.17

1. git版本：[12a61b9] [v0.1.0]
   - 完成：三栏布局、DSH token、深浅色适配、节点配色、点阵背景、发光贝塞尔连线、圆形 handles、缩放控件、空画布引导。
   - ...

2. git版本：[版本前7位哈希] [插件版本号]
   - （完成的任务/修复的 bug/实现的功能）
   - （功能性重大变更请标注）

## 2026.08.16（日期倒序，最新的在最前）

3. git版本：[]
   - ...

---
> 下述日志已压缩（AI自动维护，根据每次最新读取时间，超时2天自动压缩过期日志，以此为界限，作为记录）
> 压缩状态：未压缩（压缩完成后更新）
> 压缩时间：2026.08.14

## 2026.08.12

4. git版本：[]
   - ...