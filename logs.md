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

## 2026.08.27

- git版本：[e27ade7] [v0.1.0] [23:33]（父代理配置注入 + 协作组交互与成员管理修复）
  - 父代理（根 Agent）配置真正生效：角色提示词改为注册自定义系统提示词段 `visual-workflow:prompt`（注入一次、每轮稳定）；移除 `request.persona` 与旧 `prompt-setup` 全量替换逻辑（不再传 persona）；`injectSystemPrompt` 开关控制官方系统提示词段注入（OFF 仅留角色段 + `tool:*` + 工具 schema）；根 Agent 亦支持服务商/模型/思考强度注入（`modelSelection.bindParent`）；会话模式下拉固定（随会话初始化锁定）。
  - 协作组交互（用户批注）：仅角色卡可入组；拖到协作组表面才入组、连接点不具入组功能；非角色卡拖入不显示悬浮提示、不能入组；画布内节点拖拽悬停高亮并入组（修复 `elementFromPoint` 命中被拖拽节点自身导致表面无法入组）；入组为**追加**而非替换；组内成员仅上下文/数据库接点、无流程接点，拖入自动断开原流程线，客户端 `connectionProblem` 拒绝组内流程连线；成员迷你卡改版（仅名称+状态）；删除单个成员仅移除该成员。
  - 测试：typecheck 4 program 通过；vitest 全量 565 用例全绿；build + client-smoke 通过。（注：`atomic.test.ts`/`service-manager.test.ts` 曾在整批并行时偶发闪失败，单独/混合跑均通过，属 Windows 文件锁/服务进程时序的环境性抖动，与本改动无关。）
  - ⚠ **重点核查对象（多次未修复）——协作组成员删除**：用户多次复现「在右侧属性栏点击某成员 ✕ 时，左侧协作组固定移出 2 个成员」——2 人组删 1 变全删（0 剩）、3 人组删 1 移动 2 个（1 剩），且与点击哪个成员无关，未找到稳定规律。已尝试修复链：①按成员自身 `groupId` 反查所属组；②`consolidateGroups` 合并重复协作组节点（memberIds 并集）；③删除前先"合并+对 memberIds 去重"再过滤目标成员，只清空该成员 `groupId`；④展示层（组合成员列表/组内迷你卡/成员计数）同步去重。删除主路径端到端单测通过（删 1 留 2），但该项仍被用户判定未修复。判定问题源疑似「加载了旧版本保存的、`memberIds` 内含重复 id 的协作组数据」，需在**干净会话/重新打开该工作流**后复核；未彻底关闭，保留为重点核查对象。

## 2026.08.26

- git版本：[5a3fb5e] [v0.1.0] [22:10]（修复：组合保留名 run_code 剔除，子代理创建 tools.restrict 不再抛错）
  - 现象：运行工作流（bug 修复）调用 wf_run_node 报错 tools.restrict() cannot name reserved Code Mode presentation transport "run_code"。
  - 根因：run_code 为官方保留的 Code Mode presentation transport——官方 core/tools 在非 native 模式自动注入每个 scope（子代理本就自带，勾选无意义），且 tools.restrict 校验禁止 allow/deny 名单出现该名（@repo packages/core/tools/src/index.ts L1085）。用户在组合管理勾选了 run_code → resolveAgentTools 把它放进 toolFilter.allow → 官方 subagent applyChildComposition 对 child scope 执行 restrict → 抛错终止节点启动。
  - 修复（双保险）：①shared/protocol.ts 新增 RESERVED_TRANSPORT_TOOL 常量；②runner.ts resolveAgentTools 无条件剔除保留名（旧数据兜底）；③api.ts tools()/allToolSchemas()/toolComboPut 过滤剔除（组合管理可选列表不再展示 run_code、保存自动清理）；④ComboManager.tsx 加载组合时过滤旧数据；⑤测试增强（combo/preset 回退均断言 run_code 不进 allow）。
  - 验证：typecheck 4 program 通过；vitest 全量 538 用例全绿（atomic 并发锁测试在 workspace-write 沙箱下因 Temp 目录 EPERM 除外，danger-full-access 下通过，与本次修复无关）；git 已提交。