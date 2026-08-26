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

## 2026.08.26


- git版本：[5a3fb5e] [v0.1.0] [22:10]（修复：组合保留名 run_code 剔除，子代理创建 tools.restrict 不再抛错）
  - 现象：运行工作流（bug 修复）调用 wf_run_node 报错 tools.restrict() cannot name reserved Code Mode presentation transport "run_code"。
  - 根因：run_code 为官方保留的 Code Mode presentation transport——官方 core/tools 在非 native 模式自动注入每个 scope（子代理本就自带，勾选无意义），且 tools.restrict 校验禁止 allow/deny 名单出现该名（@repo packages/core/tools/src/index.ts L1085）。用户在组合管理勾选了 run_code → resolveAgentTools 把它放进 toolFilter.allow → 官方 subagent applyChildComposition 对 child scope 执行 restrict → 抛错终止节点启动。
  - 修复（双保险）：①shared/protocol.ts 新增 RESERVED_TRANSPORT_TOOL 常量；②runner.ts resolveAgentTools 无条件剔除保留名（旧数据兜底）；③api.ts tools()/allToolSchemas()/toolComboPut 过滤剔除（组合管理可选列表不再展示 run_code、保存自动清理）；④ComboManager.tsx 加载组合时过滤旧数据；⑤测试增强（combo/preset 回退均断言 run_code 不进 allow）。
  - 验证：typecheck 4 program 通过；vitest 全量 538 用例全绿（atomic 并发锁测试在 workspace-write 沙箱下因 Temp 目录 EPERM 除外，danger-full-access 下通过，与本次修复无关）；git 已提交。

## 2026.08.25

- git版本：[70db60d] [v0.1.0] [18:20]（集成修复：保存/运行全链路 + 4 张标注图 BUG + 模式二服务启动反馈与自动恢复 + 3080 插件安装与 HMR）
  - 保存链路（用户主诉「保存成功但实际没保存」）：①草稿保存原经 createWorkflow 另发新 id → WORKFLOW_UPDATED 不命中列表、画布永远引用旧草稿 id，每次保存都新建副本 → 草稿统一走 putWorkflow（后端不存在即创建，id 不变）；②前端 _draft/_clientMeta 随模板/服务/工作流写盘 → 刷新后已入库对象被误判草稿（本地删除不走后端）→ 保存路径统一剥离（api.ts + flow-store 双保险）+ 清理既有数据残留（scripts/clean-client-meta.mjs）；③受管文件名消毒把中文全替换为 _（任务清单规则.md → ______.md）→ 保留 Unicode 仅过滤危险字符。
  - 标注图修复：父代理画布节点属性栏可编辑（原一律「无属性」）+ 可复制虚拟节点；角色卡元信息两行（模型/组合）；文件节点卡显示内容/文件名列表（两行省略、无「文件」前缀）；已选文件列表移至按钮下方、支持多选所有类型、显示原始文件名；虚拟节点「↻ 引用」重复徽标去重；输入/输出节点仅保留一个连接点；角色模板卡/父代理卡显示 System Prompt（20 字截断或 .md 文件名）；协作组拖拽悬停高亮「放开以入组」；组合管理 MCP「编辑」字段为空（pluginCatalog mcp 段补 command/args/url）；移除会话页「工作流」tab（批注图）。
  - 模式二服务：fork 参数修复（headless commander 不识别 app 级 flag → 服务启动即 crashed；改 patch config 传参 + 占位 task 位置参数）；启动横幅直写 dsh web 终端 stdout（服务名/端口/REST API/鉴权/curl 示例——实测 cordis logger 不落终端）；启停与端口释放（stdin EOF 优雅退出 + taskkill /T 树杀兜底）；自动恢复实测通过（重启 dsh 后 status=running 服务自动重启，无 UI 运行）。
  - 工程：dsh plugin 安装到 web profile（pnpm symlink/网络受限 → 手工登记 manifest + junction）；MCP playwright 行双重转义（16 层反斜杠）修复并启用（原 disabled）→ mcp__playwright__* 工具加载成功；HMR 挂载 3080（profiles/web/cordis.yml 声明 timer+hmr 监听 lib，新增 scripts/watch-host.mjs 与既有 watch-client.mjs 常驻）。
  - 测试：538 用例全绿（typecheck 4 program + vitest 全量）+ build + client-smoke；3081 实测：草稿 id 一致/模板剥 _draft/中文文件名、服务启停循环与端口释放、REST API 行为（400/200）、自动恢复、MCP 工具加载。


- git版本：[804d35a] [v0.1.0] [15:32]（P14-P17 收尾：服务调试台/组合管理/协作组完整化 + 标注图 BUG 修复）
  - 完成：P14-P17收尾，包括服务调试台、组合管理、协作组完整化，并修复用户验收标注图报告的BUG。
    - 背景：用户验收4张标注图（编排执行模式/后台服务模式/组合管理/UI），报告工作台按钮不工作、会话读取失败、保存后丢失、属性栏保存删除交叉、模板/工作流无法删除。
    - 根因：① entry.ts会话读取用旧项目API（list.get()）→官方v0.1.1为sessions.list.getSnapshot()，导致浮窗会话恒空→会话级操作全400；② 模板/工作流/服务草稿删除走后端→未入库404 toast；③ 运行历史恢复useCallback闭包捕获旧state，点击恢复永不生效。
    - host：EP_SERVICE_DEBUG SSE流式代理（CORS/鉴权缘由同文档）；transfer.ts支持模式二服务v2 bundle导出导入（service字段落到services/）；FileTemplate补fileName字段。
    - client：服务控制台收敛为调试区（状态/启停并入Toolbar最右侧）；组合管理加MCP启用/停用与文案裁剪；协作组完整化（左栏/画布节点拖入组、组卡片流程点、组内成员上下文/数据库迷你接点跨组连线）；组协作Prompt可从.md加载；有向线段箭头（流程/通过/不通过/内容，ctx/db无向）；阶段节点紧凑卡（168×88）；启动/结束上下文接点按模式裁剪；父代理模板首次启动内置；高级选项间距；System Prompt标签。
  - 测试：538用例全绿（typecheck 4 program + vitest全量 + build未跑（watch互斥，构建门禁由用户确认时执行））；真实浏览器E2E（playwright + 系统Edge）通过：FAB/浮窗渲染、会话绑定、模板保存、拖拽生成节点、刷新持久化、模板删除隔离、组合管理MCP显示playwright。
  - 工程：MCP挂载——官方@deepseek-ai/dsh-mcp-client标准行（serverName: playwright）写入profiles/web/cordis.patch.yml托管区，与组合管理mcp-registry输出格式一致；3081组合管理UI确认工具正常显示；@playwright/mcp为devDependencies（仅开发验证用），浏览器复用系统Edge（--executable-path）。