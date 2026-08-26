# BUG 清单（后端专项）

## 精准 Bug 表（多次核查出现的bug，重点修复）

| 序号 | 风险 | 层级 | 类型 | 位置 | 全链路问题描述 | 影响 | 修复建议 |
|---|---|---|---|---|---|---|---|
| 1 | P0 | 后端 | 安全 | `remote/api.ts` `runStatus/runStop/runResume` | 仅接受 runId，无 sessionId 归属校验 | 任意会话可查询/停止/恢复其他会话运行 | 端点增加 sessionId 参数并校验归属 |
| 2 | P0 | 后端 | 安全 | `remote/api.ts` `serviceStart/serviceStop/serviceStatus` | 仅接受 serviceId，无 sessionId 归属校验 | 任意会话可启动/停止/查看其他会话服务 | 端点增加 sessionId 参数并校验归属 |
| 3 | P1 | 后端 | 并发竞态 | `orchestrator/runtime.ts` `startRun` L385-L420 | 锁检查与 `runs.set` 之间多个 await，并发调用可穿透运行锁 | 同一工作流被并发执行两次 | 检查后同步设 pending 占位 |
| 4 | P1 | 后端 | 死锁 | `orchestrator/runtime.ts` `wfRunNode` wait L465-L485 | childIndex 晚于 `startContinuable` 设置，极快子代理完成时 `subagent/end` 错过，waiter 永久挂起 | 模式二 wait:true 死锁 | startNodeTask 内提前登记 childIndex |
| 5 | P1 | 后端 | 并发竞态 | `service/sessions-map.ts` `ensure` L50-L56 | 不同 userId 并发 resolve 时映射互相覆盖 | 会话映射丢失，用户上下文断裂 | 使用 withJsonLock 或 per-file 磁盘锁 |
| 6 | P1 | 后端 | 并发竞态 | `service/manager.ts` `start` L140-L160 | `children.has` 与 `children.set` 之间多个 await | 并发启动产生孤儿进程 + 端口泄漏 | 启动前置同步 pending 标记 |
| 7 | P1 | 后端 | 稳定性 | `service/manager.ts` `start` L198-L199 | persistRuntime 失败后子进程已启动但状态未更新 | 用户看到启动失败但进程存活 | persistRuntime 失败时立即 kill 子进程 |
| 8 | P1 | 后端 | 并发 | `storage/atomic.ts` `cleanupStaleTemp` L336-L355 | 无差别删除 .tmp 前缀文件 | 并发写不同文件时误删他人临时文件 | 按 pid 存活过滤 |
| 9 | P1 | 后端 | 安全 | `flow-store.ts` `listRuns` L280-L293 | 仅按 flowId 过滤，无 sessionId | 跨会话运行历史泄露 | 增加 sessionId 过滤 |
| 10 | P1 | 后端 | 数据丢失 | `graph/validate.ts` `normalizeFlow` file 分支 | 丢失 files 多选字段 | 保存后多选文件数据丢失 | file 分支补 files |
| 11 | P1 | 后端 | 数据完整性 | `remote/transfer.ts` `exportWorkflowBundle` L62-L84 | 导出 bundle 缺 roles/files/databases | 导入后模板库缺失，违反架构文档 §6.4 | 补全 embedded 字段 |
| 12 | P2 | 后端 | 引擎逻辑 | `orchestrator/runtime.ts` `handleSubagentEnd` L544 | max-tokens 视为成功 | 截断输出被标记 ok | 区分截断与完成 |
| 13 | P2 | 后端 | 引擎逻辑 | `orchestrator/runtime.ts` `currentResolvedFlow` L705-L711 | mode2 依赖隐式回退 | flowId 冲突时读错文档 | 按 mode 显式分派 |
| 14 | P2 | 后端 | 断点恢复 | `orchestrator/resume.ts` L66-L72 | interrupted 恢复无 resumeFromNodeId | 恢复起点不明确 | 计算首个 pending 节点 |
| 15 | P2 | 后端 | 稳定性 | `service/openai-api.ts` `runChat` L181-L196 | 无限轮询无 5 分钟超时 | 违反需求 §5 SSE 超时 | 增加可配置超时 |
| 16 | P2 | 后端 | 稳定性 | `service/openai-api.ts` `streamResponse` L223-L243 | 未监听客户端断开 | 恶意客户端耗尽并发槽 | 监听 close 并 abort |
| 17 | P2 | 后端 | 安全 | `tools/data-tools.ts` `sanitizeReadOnlySql` L66-L75 | LIMIT 无上限 | 大表可被全扫 | 限制 ≤ 1000 |
| 18 | P3 | 后端 | 代码质量 | `FlowStore.templateToNode` | 丢失 systemPromptSource；fileName 取 basename | 模板字段丢失 | 补字段 |
| 19 | P3 | 后端 | 引擎逻辑 | `validate.ts` | 幽灵组员未报错 | 节点声明 groupId 但组不存在 | 增加组引用校验 |


## 非重复 Bug 表

| 序号 | 风险 | 层级 | 类型 | 位置 | 全链路问题描述 | 影响 | 修复建议 |
|---|---|---|---|---|---|---|---|
| 1 | P0 | 前端 | 编译阻塞 | `src/client/styles.ts` | 文件内容为 CSS 注释，无 `export const styles` 导出。`entry.ts` 中 `import { styles } from './styles.js'` 将因找不到导出而编译失败 | 前端构建失败 | 补 `export const styles: string = '...'`（CSS 变量定义或空字符串） |
| 2 | P0 | 前端 | 契约冲突 | `Studio.tsx` `copyToProxy` + `studio-state.ts` `flowToCanvas` + `useWorkflows.ts` `serializeWorkflow` | 虚拟节点 `proxySourceId` 在创建时正确置于顶层，但 `flowToCanvas` 投影和序列化均只复制 `id/kind/position/data`，导致打开工作流后 `proxySourceId` 静默丢失，保存后后端 `validateFlow` 报 `proxySourceMissing` | 虚拟节点功能全链路不可用 | `flowToCanvas`/`serviceToCanvas`/`serializeWorkflow`/`serializeFlow` 均需显式处理 `proxySourceId` 顶层字段 |
| 3 | P0 | 前端 | 契约冲突 | `ServiceConsole.tsx` `sendDebug` L75-L88 | SSE 解析字段路径错误：后端 `sseChunk` 返回 `choices[0].delta.content`，前端解析 `parsed.delta?.content` | 调试台流式输出永远为空 | 改为 `parsed.choices?.[0]?.delta?.content` |
| 4 | P1 | 前端 | 数据污染 | `useServiceControl.ts` `startService/stopService` L62-L74 | 后端 `manager.start()` 返回 `{serviceId,status,port,pid}`，前端 cast 为 `ServiceState` 后 `SERVICE_UPDATED` 整体替换列表项 | 服务列表项被残缺对象污染，nodes/lines/revision 丢失 | 启动/停止后重新 `getService` 获取完整文档再更新 |
| 5 | P1 | 后端 | 资源泄漏 | `orchestrator/runtime.ts` `handleSubagentEnd` L530-L558 | childIndex 永不清理 | 内存增长 + 已结束子代理仍可被 ask 目标 | 子代理结束时 delete；ask 增加 inflight 校验 |
| 6 | P1 | 后端 | 安全 | `shared/types.ts` + `flow-store.ts` | 数据库密码明文落盘 | 敏感凭证明文存储 | AES-GCM 加密 |
| 7 | P1 | 后端 | 资源泄漏 | `agent/runner.ts` `ensureNodeChild` L370-L384 | 子代理重建旧 childId 未清理 | 内存泄漏 + 孤儿子代理累积 | 重建前中断/清理旧 child |
| 8 | P1 | 后端 | 架构未对齐 | `agent/runner.ts` `resolveAgentTools` | 白名单未验证 ⊆ 父代理工具集 | 子代理可获得父代理工具集之外工具 | 父代理工具集为上限过滤 |
| 9 | P1 | 后端 | 架构未对齐 | `agent/runner.ts` `ensureNodeChild` L350-L368 | 空白名单不传 toolFilter 导致继承全部工具 | 子代理可获 wf_run_node/wf_finish | 传 `{allow: []}` |
| 10 | P1 | 前端 | 契约冲突 | `lib/graph-model.ts` + `FlowNode.tsx` `nodeHandles` | start/end 的 ctx 连接点在两处被裁剪，与后端 `NODE_HANDLES` 冲突 | 模式二下无法创建输入→下游 ctx 连线、父代理→输出 ctx 连线 | 恢复 start ctx-out、end ctx-in；仅 mode1 禁用 |
| 11 | P1 | 前端 | 状态丢失 | `useRunPolling.ts` L31-L35 | 终态后 `RUN_CLEARED` 清除 snapshot，画布高亮与节点状态徽标消失 | 违反需求 §4.5 规则 8“运行状态实时回显” | 保留终态 snapshot 供展示 |
| 12 | P2 | 后端 | 稳定性 | `index.ts` `latestTurnEnd` L179-L193 | event.time 缺失时看护失效 | 父代理 error 自动终止失效 | 确认字段 + 兜底 |
| 13 | P2 | 后端 | 安全 | `tools/data-tools.ts` `buildIndexForDatabase` L154-L162 | 表名插值 SQL 注入 | 恶意表名可注入 | 白名单 + 参数化 |
| 14 | P2 | 前端 | 数据流断裂 | `GraphCanvas.tsx` `renderedNodes` L370-L376 | proxy label 回退依赖已丢失的 proxySourceId | 虚拟节点画布显示空白 label | 修复 proxySourceId 丢失后自然恢复 |
| 15 | P2 | 前端 | UI | `Toolbar.tsx` L31-L32 | running 与 serviceStatus 语义重叠导致模式二下可重复点击启动 | 用户可重复点击启动（后端报 RUNNING 错误） | 统一状态源 |
| 16 | P2 | 前端 | 数据流 | `RunHistory.tsx` L71 | 断点恢复 onResume 签名仅 runId（在 Studio 中已补全参数，但组件接口不完整） | 单独使用组件时缺少 sessionId/flowId | 组件接口增加参数 |
| 17 | P2 | 前端 | 契约冲突 | `bundle.ts` `isWorkflowBundle` | 仅检查 `parsed.workflow`，mode2 服务的 bundle 无 workflow 字段 | 模式二服务 bundle 无法识别导入 | 检查 `workflow` 或 `service` |
| 18 | P2 | 前端 | 校验不一致 | `lib/graph-model.ts` `connectionProblem` | 前端连线校验缺条件仅流程线、协作组边界、模式差异检查 | 前端可创建后端拒绝的连线 | 补充校验 |
| 19 | P2 | 前端 | 字段丢失 | `graph-model.ts` `templateToNodeData` file 分支 | 未处理 files 多选字段 | 多选文件模板拖入画布丢失文件列表 | 补 files 数组 |
| 20 | P2 | 前端 | 样式缺陷 | `GroupCard.tsx` 成员接点 L43-L53 | db-in/ctx-out 无定位样式，接点重叠 | 用户无法精确拖拽 | 补定位样式 |
| 21 | P2 | 后端 | 并发 | `service/manager.ts` `stop` L225-L232 | forceKill 定时器泄漏 | 快速 stop→start 时误杀新进程 | 清理旧定时器 |
| 22 | P2 | 后端 | 数据完整性 | `remote/download.ts` `copyIntoManagedFile` L43-L52 | 未使用 fsync 原子写 | 崩溃时文件不完整 | 使用 fsync 原子写 |
| 23 | P2 | 后端 | 并发 | `remote/mcp-registry.ts` `writeRegion` L196-L210 | 无文件锁 | 并发修改 MCP 配置丢失 | 增加文件锁 |
| 24 | P2 | 后端 | 数据完整性 | `remote/transfer.ts` `importWorkflowBundle` L105-L118 | 组合保存非原子 | 导入部分成功 | 事务化或回滚 |
| 25 | P3 | 前端 | 死代码 | `Studio.tsx` `highlightedNodeIds` | 始终返回 []，高亮功能未实现 | 运行中节点高亮缺失 | 实现高亮 |
| 26 | P3 | 前端 | 代码质量 | `Studio.tsx` L24 `void tools` | 无用 prop 抑制编译警告 | — | 移除或使用 |
| 27 | P3 | 前端 | 代码质量 | `Studio.tsx` `flowLayout` 与 `layoutGraph` 重复 | — | — | 复用 lib/graph-model.ts |
| 28 | P3 | 前端 | 默认值不一致 | `forms.tsx` `RoleForm` L58 | presetId 默认 'standard' 与后端 null 语义不同 | 新建模板显示为标准预设但实际为 null | 统一默认值 |
| 29 | P3 | 前端 | 代码质量 | `usePanelLayout.ts` 重复实现 | storedNumber/storedBoolean/keepLayout 与 lib/files.ts 重复 | — | 从 lib/files.ts 导入 |
| 30 | P3 | 前端 | 契约脆弱 | `ComboManager.tsx` `saveMcp` | args 使用 split(',')，与后端引号感知拆分不一致 | 含引号的参数被错误拆分 | 前端直接传数组 |
| 31 | P3 | 后端 | 文档漂移 | `protocol.ts` | EP_FILE_UPLOAD/EP_SERVICE_DEBUG 未在架构文档登记 | — | 更新文档 |
| 32 | P3 | 后端 | 引擎逻辑 | `validate.ts` `normalizeFlow` db 分支 | vectorSource 默认值用原始 dbType | 本地库默认无向量模式 | 先归一化再默认 |
| 33 | P3 | 后端 | 资源管理 | `engine.ts` dispose | 异步 dispose 未 await | 资源释放不完整 | 改为 async |
| 34 | P3 | 后端 | 代码质量 | `model.ts` `makeNodeId/makeLineId` | Math.random + SHA1 | 碰撞风险 | 改用 randomUUID |
| 35 | P3 | 后端 | 代码质量 | `guards.ts` `turn` 类型脆弱 | NaN 导致计数重置 | — | 类型守卫 |
| 36 | P3 | 后端 | 代码质量 | `define-tool.ts` `timeoutMs` 非法值静默忽略 | — | — | 抛错或警告 |