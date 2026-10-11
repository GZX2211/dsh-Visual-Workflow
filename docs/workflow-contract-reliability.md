# PR #11：交接合同与编排提示的最小修订

基于已合并 PR #10 的 main（0116d07），分支 `codex-workflow-contract-reliability`。插件仍为 0.11.0，没有新增依赖或环境配置修改。

## 修改及边界

- `task-blocks.ts`：只在明确 auto、存在合法的唯一无条件直接 Agent 消费者时补齐原有默认文本合同。使用 graph 公共查询与原有 DAG 环检测，不修改图、快照、调度或实际交接。ctx、明确绑定、声明 ctx 输入、多上游、条件、组、环及终端都不新增 auto 默认合同；proxy 使用原主节点映射。
- `node-task.ts`：仅对 auto 中已声明 outputFiles 的节点说明真实写入和最终路径。未声明文件的节点无文件要求。outputSchema 优先，原显式 ctx 合同及 explicit 任务字节保持原样；不强制 JSON 或四字段解析。
- `orchestration.ts`：在已有约束常量内提示父代理核对真实结算、产物、任务要求与 retryLimit，有新依据才重试；证据明确时采取工具动作，达到限制且无法合法继续时 failed 收尾，工具失败不声称锁已释放。恢复提示复用同一收尾说明。
- `run-sales-live.mjs`：五节点职责与输入/输出合同、统计事实和断言同步补齐。文本/JSON 示例声明自己的输出格式，避免默认交接说明干扰纯文本/JSON 示例。

Runtime 七层继承链、NodeAgentRunner、原生子代理生命周期、wf_run_node/wf_finish、WF_BUSY、NOT_RESUMABLE、runId/attempt/childId/epoch、暂停/恢复/停止、锁及 verifyNodeArtifacts 均未改动。工作流数据模型、Creator、graph validator、工具白名单、授权与 sandbox 未改动。没有新 Token 预算、结果协议或业务验证框架。

输出提示不足是本轮修复的代码问题。父代理决策提示是行为引导，不能确定性保证模型正确或减少 Token。文件存在/本次写入验证不等于业务结论正确，销售断言仅用于固定测试样例。

## 复用现有字段的示例

生成工作流应明确计算与解释的职责。以下是销售统计 Agent 的既有字段示例，不是新增数据模型：

```json
{
  "responsibility": {
    "id": "sales_stats",
    "purpose": "对有效销售记录做精确统计",
    "deliverable": "stats.json：总额、平均额、极值、每日及产品汇总"
  },
  "inputSchema": "实际读取上游 quality.json 的 valid 记录",
  "outputSchema": "写出 stats.json，包含 total、average、maximum、minimum、dailyTotals、productTotals；最终回复真实文件路径",
  "retryLimit": 2,
  "execution": {
    "requiredTools": ["read", "write"],
    "outputFiles": ["output/stats.json"]
  }
}
```

初始 CSV Agent 另声明 `execution.inputs.source.kind="file"`。用户明确上传并绑定 source；附件上传本身不构成绑定。精确计算优先使用现场已授权脚本/数据库工具（若可用），不为了示例新增权限或强制所有 Agent 使用脚本。总结节点读取真实 stats.json，区分事实和解释。报告节点实际读取 summary.md，并读取任务中明确给出的本工作区 stats.json；不假设 auto 会交付祖先所有文件。

销售样例保留原始 11 行、重复 1、缺失单元格 2、有效 9、总额 15900、平均 1766.67、最大 S001/6000、最小 S010/200。新增事实：

| 日期 | 有效销售额 |
| --- | ---: |
| 2026/10/1 | 6400 |
| 2026/10/2 | 2100 |
| 2026/10/3 | 3800 |
| 2026/10/4 | 3400 |
| 2026/10/5 | 200 |

产品总额：电脑 9000、鼠标 1200、键盘 1200、显示器 4500。统计 JSON 使用原始日期为 dailyTotals 键，产品名为 productTotals 键。两组金额分别求和均须等于 total；摘要与报告分别列出各日期、产品和金额，并拒绝固定样例中明显错误的持续增长/上升趋势表述。文本检查支持常见前置否定、千分位和整数金额的小数零，不是通用自然语言语义验证，现场仍需人工检查解释。

## #10 现场证据与 Token 分析

用户提供运行 `run-mv2kas42-poqxqe`，现场时间 2026-10-10 23:41 至 2026-10-11 00:05，约 24 分钟。界面八段 Token 为 76.2K、47.3K、93K、247K、89.7K、70.8K、76.1K、53.1K，合计约 753.2K；显示值是否重复计数未知，不能当作已去重的真实消耗。

| 节点 | 现场观察 |
| --- | --- |
| load_data | 两次启动：CSV 准备期间与上传之后 |
| quality_check | 两次启动：缺失统计错误后重试 |
| sales_stats | 一次启动，并推进到 summary_gen |
| summary_gen | 记录描述三次尝试，均有错误趋势解释 |
| report_gen | 未观察到启动 |

summary_gen 列出了正确的每日金额，却解释为上升趋势，属于明确的业务解释矛盾。父代理随后多轮讨论重试或失败结束，存在无效决策消耗。流程已推进多个节点，不能据此认定 Runtime 交接失败；两次启动也不能证明同一节点未结算时发生并发重复派发。

已知流程事实源为 `/var/lib/dsh/visual-workflow/orchestrations/run-mv2kas42-poqxqe.json`。按 FlowStore 规则推测的运行快照为 `/var/lib/dsh/visual-workflow/runs/run-mv2kas42-poqxqe.json`，尚未验证存在。两者不是同一个文件。

缺少独立父/子 input/output Token、完整会话及快照和 wf_finish 的真实返回：父模型调用次数、去重子执行次数、等待期间空转、重复大段上下文、模型思考时间、锁释放及最终状态都不能确认。没有证据认定官方上下文管理存在 BUG，本轮没有修改它。提示词改动仍保留原稳定前缀与动态尾段，在既有双位约束中替换说明，不复制业务数据或历史。

## 验证与现场命令

确定性回归覆盖输出合同边界、proxy、四种 explicit 任务的基线全文、父代理提示常量/锚点、auto/ctx 五节点真实文件处理与结算、Fake HTTP 的正确/错误统计和趋势。Fake 子代理或 HTTP 不能证明真实模型行为。完整 check/build 和生成 lib 的最终结果记录在 PR。

本轮 pnpm check 通过四个 TypeScript Program、197 个测试文件/2373 项测试、构建及 client-smoke；独立 pnpm build 通过，同步 3 个 JS 和 3 个声明。5 文件定向回归 76 项通过，task-blocks 行覆盖率 93.75%、分支 87.03%（不是全仓库覆盖率）。官方 Scope smoke 在 0.1.6-alpha.2 的 standingKeyFor 和 0.2.0-rc.2 的 acquireScope 下分别通过，均不执行模型。

真实 Docker A（文本）、B（JSON）、C（销售）：**NOT RUN**。云环境无法访问现场 DSH 模型；不要将确定性测试或官方 Scope smoke 记作模型 E2E 通过。性能改善：**NOT VERIFIED**。

在装有本分支构建产物的 DSH 容器内或共享其工作区文件系统的机器执行。provider 必须是现场准确标识，不猜测 ollama/openai，不硬编码内部地址或凭据：

```bash
export DSH_BASE_URL='填写现场 DSH Web 地址'
export DSH_TEST_PROVIDER='填写现场准确 provider 标识'
export DSH_TEST_MODEL='qwen3:30b-instruct'
# 如现场使用既有 Web 登录日志，设置 DSH_WEB_LOG；脚本不打印登录信息。
node scripts/run-sales-live.mjs --text
node scripts/run-sales-live.mjs --json
SALES_CSV='/容器可见/sales_workflow_test.csv' node scripts/run-sales-live.mjs
# 可选原 File Node + ctx 回归：
SALES_CSV='/容器可见/sales_workflow_test.csv' node scripts/run-sales-live.mjs --explicit
```

每次使用独立新工作区（缺省自动创建）；可设 DSH_TEST_WORKSPACE 为宿主可见的新目录，DSH_TEST_TIMEOUT_MS 调整现场等待上限。--prepare-only 仅建图，不执行模型。旧版本与本分支对比时都使用同一输入、provider/model、部署和相同等待上限，保留两轮证据。

脚本保存 live-flow.json、live-run.json、live-metrics.json。metrics 记录 run 请求到最后状态观察的墙钟时长、观察状态、节点 attempts/childId/尝试历史和路由；runStatus 没有独立 Token 统计，父/子 Token 明确为 NOT AVAILABLE，需从现场 DSH 的真实用量记录补充 input/output、去重方法。超时先记录观察到的状态，再停止脚本自己的测试运行；该观察状态不冒充停止后的终态。

现场另检查父代理的真实 wf_finish 返回、重复派发是否发生在有效结算之后、失败后有无无工具动作的重复分析，并对比父/子 Token、总时长和 attempts。当前只有旧运行观察，尚无 #11 模型结果，不能填写性能改善百分比。部署认证及路径暴露等 #10 已记录限制仍见 [运行输入说明](runtime-input-handoff.md#宿主认证与部署限制)，本轮未扩大访问权限或解决该独立问题。
