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

## 2026.08.30

- git版本：[6e4ee78] [v0.1.0] [00:30]（docs：运行复盘与改进清单）
  - 新增 `docs/运行复盘与改进清单.md`：自包含复盘（术语/当次运行时间线/自助取证路径/已修复项防回退/P0-P2 共 7 项待跟进问题），供无上下文的下一个 AI 直接接手。
  - 待跟进核心：待命成员被误判终态导致组卡片提前 ok；快照 endedAt 冻结而 output 覆盖（记录自相矛盾）；节点续跑=复用旧对话并整段重复汇报；协作类错误文案弱指向；组内失败退化为父代理桥接；childForNode O(n)；attempts 无终止原因。

- git版本：[19243c3] [v0.1.0] [00:14]（fix：wf_ask_agent 组内通信支持节点 id 寻址并唤醒停止节点）
  - 【排查背景】协作组运行中开发工程师多次 wf_ask_agent ask 报「目标 agent-xxx 不是当前运行的节点子代理」（WF_ASK_TARGET_UNKNOWN），审查交接被阻断，需编排器桥接。
  - 【根因】ask 目标校验仅按运行期随机 childId（UUID）键控 childIndex；而协作成员清单块只向成员告知节点 id（memberIds），成员无从得知彼此的运行期会话 id，无论目标在线/离线都必投 WF_ASK_TARGET_UNKNOWN。
  - 【修复】① runtime-comm：ask 目标支持「子代理会话 id」与「节点 id」双寻址（节点 id 经 childIndex 反查本 run 子代理会话 id），reply 同样接受发起者两种 id；② 冷态可达确认：childIndex 仅随 run 生命周期清理、节点结束不注销，投递缝本就支持离线目标 followup 冷恢复唤醒——修复后「目标已停止也可被唤醒」真正可达；③ 工具 description/参数说明、协作块文案（targetChildId 直接填成员 id）、ask 消息回复指引（改用发起者节点 id）同步；④ 架构文档 5.3 同步寻址与唤醒语义。
  - 【新增测试】wf-ask-agent.test.ts +8：节点 id 寻址在线投递、冷态按节点 id followup 唤醒、未知 id/未启动节点/自投拒绝、会话 id 兼容等价。
  - 【回归验证】pnpm typecheck 4 program 通过；全量 vitest 45 文件 647 例全通过。

## 2026.08.29

- git版本：[47862ba] [v0.1.0] [23:49]（功能与优化批注：画布换向/连接点配色/工作流名称角标 + 协作组模板全局共享）
  - 【任务：功能与优化批注实现】按《功能与优化批注.png》完成四项功能：
    - ① 卡片右上角「交换左右连接点」按钮：默认左入右出；点击后两侧连接点交换（左出右入：左侧上下文出/流程出，右侧数据库入/上下文入/流程入），再次点击恢复；状态随节点 swapPorts 持久化（节点 JSON 即事实源）。FlowNode 渲染左右接点；geometry.edgeGeometry 按交换状态换向端点（源出点在左缘/目标入点在右缘），避免画布布线交叉。协作组卡片不提供该按钮。
    - ② 连接点按「入口/出口」区分颜色：入口=蓝（--wf-port-in）、出口=橙（--wf-port-out）；左侧/右侧位置由交换状态动态决定（原 --target/--source 左右定位保留给协作组接点）。
    - ③ 画布左上角工作流名称角标：显示方式「实例: 名称」「模板: 名称」，固定不随缩放平移（pointer-events:none）。
    - ④ 协作组模板全局共享：host flow-store 新增 groups/ 目录与 group TemplateKind CRUD（listTemplates/saveTemplate/deleteTemplate/getTemplate/templateToNode→GroupNode），api-templates 端点允许 kind=group；client 扩展模板管线（useTemplates/studio-types/actions/initial/editor/LeftPanel/Inspector 新增协作组模板增删改查）。协作组标题右侧＋号新增模板；点击模板在右侧属性栏显示内容并可保存/删除；拖入画布按模板生成协作组节点（placeGroupFromTemplate）。
  - 【契约与存储】host 复用既有 templates 端点（listTemplates/putTemplate/deleteTemplate），新增 kind=group；flow-store 目录 +groups/；未改动 shared/protocol.ts / shared/types.ts / shared/graph-model.ts（GroupTemplate 类型已预定义于 types.ts）。
  - 【回测试】新增 edgeGeometry 换向、flow-store 协作组模板 CRUD/templateToNode（GroupNode）用例；修正 studio-state 初始 templates（补 group）、Studio 远程桩（补协作组模板）；graph-canvas 测试补 onSwapPorts。typecheck 4 program 通过；build + client bundle 通过；全量 vitest 641/642，唯一失败为 tests/host/service-manager.test.ts「status 内存存活」——沙箱 child_process.spawn 受 EPERM 限制（隔离复跑为 worker spawn EPERM），未触碰相关代码，属环境限制非改动引入；此前 atomic.test 高并发文件锁 EPERM 亦为同类环境抖动（全量复跑已通过）。