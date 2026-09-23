# Tools Module Rules

## 范围与职责

适用于 `src/host/tools/`。

负责将 Host 能力暴露为 Agent-facing Tools，并维护 Tool 基础设施：Tool 定义、参数与输出 Schema、调用方校验、Host 能力调用、输出渲染、可见性与全局开关。

不重新实现 Workflow / Agent / Graph / Storage / Team Runtime。复杂能力应通过 Host 既有服务或能力缝实现。

## 目录与分类

- 按工具能力组织，文件夹按工具名命名：`wf-run-node/`、`wf-ask/`、`wf-db-query/`等。
- `infrastructure/` 放 Tool 基础设施，如 `define-tool.ts`、`text-render.ts`等。
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

## 依赖边界

- 允许经公共入口依赖 orchestrator / graph / storage / agent / ... 等模块的能力；
- Tools 不得成为核心模块的底层依赖；禁止循环依赖。

## Tool 之间解耦

一个 Tool 不得通过另一个 Tool 的注册函数或执行函数完成业务。

错误：`runNodeTool.execute(...)`

正确：

```text
Tool A → Host capability / service ← Tool B
```

多个 Tool 共享逻辑时，应将逻辑提升到合适的 Host 模块。

## Tool 契约

- 模型可见输出应稳定、紧凑、可预测；输出序列化只有一处实现，业务 Tool 不得重复实现渲染；
- Tool description 须回答：何时调用？调用前需要什么？失败时会发生什么？是否产生副作用？描述应简洁、无歧义。

## 持久化

Tool 不得定义第二套持久化协议。不得绕过 Storage 直接写 Workflow / Run / Template 数据。

## 错误处理
稳定错误使用项目已有错误体系和稳定错误码。错误信息应帮助 Agent 修正调用，明确：什么失败、哪个参数 / 状态导致失败、是否可修正后重试。不得吞掉业务错误并返回成功。

## 核心原则
Host 能力经 Tool 暴露；Tool 只做适配；基础设施稳定通用；共享逻辑上移 Host；依赖单向；契约优先；纯函数优先；持久化走 Storage；错误可诊断。