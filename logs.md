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

## 2026.09.01

- git版本：[48d554a] [v0.1.0] [02:40]（fix：定时任务界面按用户批注修复日期/时间/星期选择器）
  - 【日期范围】修复"开始日期 > 结束日期"：日历点选由 end 强转旧 start 导致的错乱，改为未选时存空串（日历可先点起点再点终点）；host 校验保留"起始日期不能晚于结束日期"兜底。新增"日期不限"开关（window.unbounded）：点击后忽略日期范围，仅按有效星期+时间段执行；关闭时若日期为空自动补默认范围；非 unbounded 缺日期报错。
  - 【双月日历】左右两月各自独立翻页（每面板都有 ‹ ›，右月恒大于左月，可跨全年任意日期）；去掉选中的连续片段条带，改为选中日期圆形高亮 + 数字下方"开始/结束"标签（用户批注：不渲染连续片段）。
  - 【有效星期】"每天"按钮改为与具体星期互斥（daysOfWeek 为空时高亮，选了任一星期即自动取消"每天"）；修正周日按钮误高亮。
  - 【时间输入】新增 components/time-input/TimeInput.tsx：文本支持按位输入（1125→11:25、925→9:25），双列滑轮（时/分）两次点击后才确认（不再一点即确认）；替换全部 `<input type="time">`（时间段、触发时刻、间隔起始时刻）；非法输入失焦回退原值。
  - 【契约】shared/types.ts ScheduleWindowConfig 新增 unbounded；planner isValidDate/validateScheduledTask/normalize 支持 unbounded；api-scheduler 透传 unbounded。
  - 【测】新增 time-input.test（纯函数+组件 5 例）；date-picker 用例按新交互更新（独立翻页/开始结束标签）；planner/api 增 unbounded 用例。全量 vitest 55 文件 741 例通过；typecheck 4 program / build / client-smoke 通过。

- git版本：[b9a308c] [v0.1.0] [01:50]（feat：新增定时任务功能（host 调度引擎 + 组合管理风格 UI））
  - 【新功能：定时任务】界面入口：工作台标题栏「定时任务」按钮（模式下拉右侧、「组合」左侧；需求见 prompt/定时任务开发.md，按用户指令不改写 docs/ 既有两份文档）。
  - 【host 半区】新增 src/host/scheduler/（新文件夹，单一职责拆分）：planner.ts 纯函数（IANA 时区双向换算、定点/间隔触发点计算含跨天截断、执行窗口判定含跨天区间 22:00–06:00、nextTriggerAt/nextWindowStartAt、校验与规范化）；task-store.ts（scheduler-tasks.json 单文件，withJsonLock+atomicWriteJson 原子写，损坏 JSON 容忍）；engine.ts（tick 30s 状态机：触发=模板自动创建实例并运行、窗口end挂起、下一窗口续跑、concurrency=skip、missedTrigger=skip 不补打、用户手动接管自动失效、停用只影响未来触发）；instantiate.ts（模板→实例深拷贝+重名序号）；session-provider.ts（经 ctx.agents.create 以编程方式创建新会话+根 Agent，standard 预设+继承创建者 cwd，不可依赖用户手动激活会话）。
  - 【运行时扩展】OrchestratorRuntime 新增 suspendRun（run→paused+保留锁+不中断在执行的子代理，等待其自然完成、下一个节点由 WF_PAUSED 拦下）；stopped 加入可恢复状态集（用户裁决：界面「停止」后点「运行/恢复」应断点续跑而非从头重跑；stopped 保留终态语义，锁释放，只有显式再运行才续跑）。
  - 【API】shared/protocol.ts 新增 3 端点（schedulerTasks/schedulerTaskPut/schedulerTaskDelete）；shared/types.ts 新增 ScheduledTask/ScheduledTaskRuntime/TimeRangeConfig 等；api-scheduler.ts 挂在既有继承链末端（Runs 之后）；visual-workflow-host 装配引擎（init 启动定时器、dispose 清理）。
  - 【client 半区】新增 components/scheduler/（SchedulerManager 弹层：左侧属性编辑栏——工作流选择器（仅模式一模板）+任务名称+会话策略（新会话/当前会话）+时区+执行窗口（双月日历 DateRangePicker+星期切换+时间段 rows）+触发策略（定点时刻 rows/固定间隔）+运行时策略只读说明；右侧任务列表+运行态徽标+删除/保存）与 components/date-picker/DateRangePicker（双月并排、‹›翻月、选中范围深色条带、端点白底圆、今日圆环、前后月灰显，样式参照用户日历素材）；studio 状态机新增 schedulerOpen/SCHEDULER_OPEN；i18n 中英文案；styles.ts 新增 wf-sched-*/wf-cal-*（大部分复用 wf-combo 体系）。
  - 【单测】新增 8 个测试文件（planner 18 例、engine 10 例、task-store 5 例、orchestrator suspendRun/stopped 4 例、api 6 例、SchedulerManager 4 例、DateRangePicker 5 例、reducer 1 例）；resume/shared-contract 契约测试同步新语义（端点 45→48、stopped 可恢复）。
  - 【验证】pnpm typecheck 4 program 通过；全量 vitest 54 文件 733 例全通过；pnpm build + client-smoke 通过。
  - 【遗留】新会话模式依赖官方 agents.create（web profile 需 agent-loop 工厂）；触发失败（会话未激活/模板缺失）按策略跳过并记录 lastError 于任务运行态，可在定时任务面板查看。

## 2026.08.30

- git版本：[f08327d] [v0.1.0] [00:59]（feat：工作台改官方侧边栏入口 + 浮窗/分栏双视图）
  - 【安装修正】之前 `dsh plugin add link:$PWD` 在沙箱下写 profile（C:\Users\GZX\.dsh）被拦（EPERM/sqlite），导致插件虽被软链接却没进 `dsh.profile.bundles`，host 从不加载、前端无入口；以更高权限重跑后正确挂载（bundles 含 dsh-visual-workflow、依赖写入、dump-config 组合树出现 visual-workflow 行、GUI 能 serve /plugins/dsh-visual-workflow/client.js）。
  - 【入口改版】入口从右下角 FAB 改为官方侧边栏（注入到设置按钮上方），新增 SplitWindow/WorkbenchHost/useWorkbenchView；工作台支持浮窗与分栏两种视图模式，可切换、可拖动分栏宽度。
  - 【修复时序】`useWorkbenchView` 的注入 observer 原来挂可能为空的 sidebarCol（插件加载早于官方侧边栏渲染），导致 `place()` 提前 return、入口永不注入；改为观察必然存在的 document.body，幂等重试到锚点出现。
  - 【修复层级】官方设置按钮外包一层 display:contents 空 div，原 `anchor.parentElement` 取到空 wrapper，把入口插进 settingsArea 内部，折叠图标栏下与设置按钮同排挤压；改用 `closest('[class*="settingsArea"]')` 定位容器，使入口为 footArea(纵向) 中 settingsArea 的上方兄弟。
  - 【新增开关】入口支持「再次点击关闭」(toggleOpen)：浮窗与分栏共用 open 态，关闭即收起宿主并还原官方对话区右内边距（exitSplit）。
  - 【验证】pnpm typecheck 4 program 通过；全量 vitest 45+ 文件（host+client）678 例全通过；真实 GUI 验证：入口在设置按钮上方（展开/折叠两种状态）、点击开/关（浮窗+分栏）均正常。
  - 【遗留】入口注入基于运行时 DOM（非侵入式），官方侧边栏/设置按钮结构若变更可能需同步选择器。

- git版本：[6e4ee78] [v0.1.0] [00:30]（docs：运行复盘与改进清单）
  - 新增 `docs/运行复盘与改进清单.md`：自包含复盘（术语/当次运行时间线/自助取证路径/已修复项防回退/P0-P2 共 7 项待跟进问题），供无上下文的下一个 AI 直接接手。
  - 待跟进核心：待命成员被误判终态导致组卡片提前 ok；快照 endedAt 冻结而 output 覆盖（记录自相矛盾）；节点续跑=复用旧对话并整段重复汇报；协作类错误文案弱指向；组内失败退化为父代理桥接；childForNode O(n)；attempts 无终止原因。

- git版本：[19243c3] [v0.1.0] [00:14]（fix：wf_ask_agent 组内通信支持节点 id 寻址并唤醒停止节点）
  - 【排查背景】协作组运行中开发工程师多次 wf_ask_agent ask 报「目标 agent-xxx 不是当前运行的节点子代理」（WF_ASK_TARGET_UNKNOWN），审查交接被阻断，需编排器桥接。
  - 【根因】ask 目标校验仅按运行期随机 childId（UUID）键控 childIndex；而协作成员清单块只向成员告知节点 id（memberIds），成员无从得知彼此的运行期会话 id，无论目标在线/离线都必投 WF_ASK_TARGET_UNKNOWN。
  - 【修复】① runtime-comm：ask 目标支持「子代理会话 id」与「节点 id」双寻址（节点 id 经 childIndex 反查本 run 子代理会话 id），reply 同样接受发起者两种 id；② 冷态可达确认：childIndex 仅随 run 生命周期清理、节点结束不注销，投递缝本就支持离线目标 followup 冷恢复唤醒——修复后「目标已停止也可被唤醒」真正可达；③ 工具 description/参数说明、协作块文案（targetChildId 直接填成员 id）、ask 消息回复指引（改用发起者节点 id）同步；④ 架构文档 5.3 同步寻址与唤醒语义。
  - 【新增测试】wf-ask-agent.test.ts +8：节点 id 寻址在线投递、冷态按节点 id followup 唤醒、未知 id/未启动节点/自投拒绝、会话 id 兼容等价。
  - 【回归验证】pnpm typecheck 4 program 通过；全量 vitest 45 文件 647 例全通过。