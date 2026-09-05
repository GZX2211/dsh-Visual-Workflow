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
## 2026.09.04

- git版本：[1d64f57] [v0.9.1] [17:14]（fix：新会话预设挂载缺失 / feat：组合管理标签一键开关）
  - 【根因修复：开启新会话后工具面板只剩注册工具/MCP 工具】`CordisSessionProvider.createSession`（scheduler/session-provider.ts）只把 `agentPreset: 'standard'` 写入会话 header，但未在 `agents.create` 的 `setup` 钩子里执行 `agentPresets.mount`——新会话根 Agent 只继承全局层（宿主+插件 wf_*+MCP）工具，官方 `standard` 预设工具（bash/pwsh/fs/jobs/skill/goal/subagent/workflow/web…）全缺失。按官方 api-proxy `composeAgent` 同源修复：先 `resolve` 得 id 供 header 记录，再在 `setup` 内 `mount`；`agentPresets` 服务缺失时降级为不挂载（无预设 roster 部署容错，模式二 headless 进程无 agentPresets 时保持原行为）。
  - 【功能：组合管理标签一键开关】工具 Tab 标签栏（[全部]/[官方工具]/[MCP 服务器]）右侧新增「一键开启/一键关闭」按钮：仅作用于当前激活标签命中的工具集合（`filterToolNamesByTag` 收窄），不影响其他标签或官方工具；走新增 `toolSwitchPutMany` 批量端点（`ToolSwitchStore.setDisabledMany` 单次原子落盘 + 内存快照刷新）；官方保留传输名 run_code 静默跳过。UI 新增 i18n 键（一键开启/关闭、批量成功提示、tooltip）与 `wf-combo-tag__bulk` 样式。
  - 【新增测试】session-provider 新会话预设挂载（4）、tool-switches setDisabledMany（2）、api 批量端点（3）、ComboManager 标签一键开关 jsdom（2）；协议契约 50→51。
  - 【回归验证】pnpm verify 全绿：typecheck 4 program、全量 59 文件 796 用例、build、client-smoke 全部通过。
  - 【待跟进】组合管理「全部」标签不显示一键开关按钮（无明确批量语义）；模式二服务进程 headless 组合无 agentPresets，服务级新会话仍按全局层工具运行（如需官方工具应在 serve patch 层装配 agent-presets）。

## 2026.09.02

- git版本：[60f879b] [v0.9.0] [23:00]（feat：父代理工具白名单全局开关 / 动态MCP Tag筛选 / 启动时开启新会话+工作区 / 父代理执行者模式）
  - 【需求背景】父代理此前无工具过滤（toolFilter 是 startContinuable 子代理专用）；组合管理需为工具卡片加开/关按钮；工具列表上方需动态 Tag（官方工具 + MCP server）筛选；画布/定时任务/API服务需支持「启动时开启新会话 + 选择工作区」；父代理被流程线连接后应作为执行单元先执行自身任务再调度。
  - 【官方源码取证】① system-prompt/assemble 瀑布的 assembly.tools 是模型可见工具 Schema 权威来源（dsh-tools wireSchemas → view(scope).visible），dsh-scope scopeTarget 过滤语义：unscoped ctx 监听对所有 agent 组装生效 → 全局瀑布改写可行；② tools.restrict 需 agent-scoped ctx、只过滤继承面、只对已存在 agent 生效，不满足「不点运行也全局生效」；③ 官方 mcp-client publicToolName = mcp__<server>__<tool>（非法字符替换+哈希）；④ dsh-sandbox-policy workspaceRoot = session.header.cwd（工作区路径输入即沙箱联动闭环）；⑤ session.events 的 assistant/message 事件可回写父代理节点产出。
  - 【实现】① tool-switches.ts（tool-switches.json 原子持久化 + 全局 assemble 瀑布过滤 + 纯函数 filterToolsInAssembly）+ toolSwitches/toolSwitchPut 端点 + pluginCatalog 附带 disabledTools + resolveAgentTools 二次剔除（含 db-in 注入的 wf_db_query）；② tool-tags.ts 纯函数（全部/官方/动态 MCP，规范化反查 serverName）+ ComboManager Tag 胶囊栏与开/关按钮（置灰禁勾选、关闭自动移出组合草稿）；③ startNewSession/workspacePath 落 WorkflowDocument/WorkflowTemplate/ServiceState/ScheduledTask，mode1 startRun 经 sessionProvider 新建会话（EP_RUN 返回实际 sessionId，前端 run.sessionId 跟随轮询/停止/恢复），定时任务直传 cwd，模式二每请求新建会话（createSession 缺失回退映射）；保存端点 stat 校验目录存在；④ 父代理执行者模式：parentExecutorOf（flow-in 命中）→ prepareParentExecutor（快照 running + buildNodeBlocks 任务块注入指令尾段「你的节点任务」）→ 首次 wf_run_node/wf_finish 标记 ok（输出取 latestRootAssistantText，新增 AgentHost 缝）→ terminalize 失败语义；编排指令 parentAsNode 双层措辞。
  - 【新增测试】tool-switches（9）、tool-tags（11）、instantiate-new-session（5）、执行者模式（5）、新会话 startRun（3）、scheduler workspacePath（2）、openai-api 服务级新会话（2）、ComboManager Tag/开关 jsdom（4）；端点契约 48→50。
  - 【回归验证】pnpm verify 全绿：typecheck 4 program、全量 58 文件 786 用例、build、client-smoke 全部通过。
  - 【待跟进】新会话运行的工作流在重启工作台后不属于当前会话活跃 run（activeRuns 按会话过滤），不会自动选中实例；运行历史面板展示的是实际执行会话（run.sessionId）的历史。