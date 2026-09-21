# Tools Module Rules

## 范围与职责
适用于 `src/host/tools/`。负责将 Host 能力暴露为 Agent-facing Tools，并维护 Tool 基础设施：Tool 定义、参数与输出 Schema、调用方校验、Host 能力调用、输出渲染、可见性与全局开关。

不重新实现 Workflow / Agent / Graph / Storage / Team Runtime。复杂能力应通过 Host 既有服务或能力缝实现。

## 目录与分类
- 按工具能力组织，文件夹按工具名命名：`wf-run-node/`、`wf-ask/`、`wf-db-query/`、`wf-finish/` 等。
- `infrastructure/` 放 Tool 基础设施。
- Agent 可直接调用的能力属于 Tool，如 `wf_run_node`、`wf_graph_patch`、`wf_org_catalog`。
- 非 Agent-facing 基础设施如 `define-tool.ts`、`text-render.ts`、`tool-switches.ts`、`caller.ts`，不得放入具体业务 Tool 目录。
- `caller.ts` 承载跨 Tool 共享的调用方身份派生（`callerOf`）与工具层宿主能力最小缝（`WfToolsHost`）；多个 Tool 共用同一逻辑时提升到此层，不得由某个 Tool 目录反向导出。

## Tool 文件职责
标准入口为 `tool.ts`，负责：注册、参数 Schema、description、调用方身份校验、调用 Host capability、输出结果。

不要把大型业务算法堆进 `tool.ts`。复杂 Tool 应拆分：

```text
tool.ts       Tool-facing adapter
apply.ts      纯变换 / 应用逻辑
types.ts      类型与契约
service.ts    业务服务
driver.ts     外部资源驱动
policy.ts     安全 / 规则策略
```

## 依赖方向
允许：`tools → orchestrator / graph / storage / agent / ...`

Tools 不得成为核心模块的底层依赖。禁止循环依赖：

```text
orchestrator → tools → orchestrator
```

## Tool 之间解耦
一个 Tool 不得通过另一个 Tool 的注册函数或执行函数完成业务。

错误：`runNodeTool.execute(...)`

正确：

```text
Tool A → Host capability / service ← Tool B
```

多个 Tool 共享逻辑时，应将逻辑提升到合适的 Host 模块。

## 基础设施
- `define-tool.ts`：Tool DSL、参数 / 输出 Schema 编译、Tool Definition 形成。不得加入具体业务逻辑，不得为单个 Tool 污染通用 DSL。
- `text-render.ts`：公共输出序列化。模型可见输出应稳定、紧凑、可预测。不要在业务 Tool 中重复实现 JSON 渲染。
- Tool 结果进入 Agent Context 后会影响后续请求，不得无故改变输出格式或字段顺序。

## Tool Description
优先回答：何时调用？调用前需要什么？失败时会发生什么？是否产生副作用？描述应简洁、无歧义。

## 纯函数优先
Graph transformation、Patch application、Schema compilation、Normalization、Validation 优先实现为纯函数。

纯函数不得读写磁盘、读取当前时间、产生随机值、修改全局状态。副作用应留在明确执行层。

## 持久化
Tool 不得定义第二套持久化协议。

```text
Tool → Host capability / Store → Storage
```

不得绕过 Storage 直接写 Workflow / Run / Template 数据。

## 错误处理
稳定错误使用项目已有错误体系和稳定错误码。错误信息应帮助 Agent 修正调用，明确：什么失败、哪个参数 / 状态导致失败、是否可修正后重试。不得吞掉业务错误并返回成功。

## 修改规则
修改前确认：

1. 这是哪个业务能力？
2. 这是 Agent-facing Tool 还是 Infrastructure？
3. 是否应放在现有模块而非新建模块？
4. 是否引入反向依赖？
5. 是否改变 Tool name？
6. 是否改变 Tool Schema？
7. 是否改变权限边界？
8. 是否改变运行时语义？

纯目录重构不得顺便修改 Tool 行为。

## 验证
至少运行：

```text
pnpm typecheck
pnpm test
pnpm build
```

同时确认：Tool 注册数量一致、Tool name 一致、Schema 一致、Host 注册入口正确、无循环依赖、无旧路径残留、无重复实现。

## 核心原则
Host 能力经 Tool 暴露；Tool 只做适配；基础设施稳定通用；共享逻辑上移 Host；依赖单向；契约优先；纯函数优先；持久化走 Storage；错误可诊断。