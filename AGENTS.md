# Root AGENTS.md

## 项目定位

`dsh-Visual-Workflow` 是 DeepSeek Harness 生态中的可视化多 Agent Workflow 编排插件。

核心方向：

- 可视化 Workflow / DAG 编排
- Parent Agent 自主编排与运行时治理
- Workflow 动态结构调整
- API 服务模式
- 面向未来的元编排（Meta-Orchestration）

项目基于 DeepSeek Harness 扩展，不替代或修改 dsh 核心框架。

---

## 仓库治理体系（权威来源）

`AGENTS.md` 分三层。每层只写自己管辖的规则，同一规则不在各层重复。

| 层级 | 文件 | 管辖范围 | 内容职责 |
|---|---|---|---|
| 仓库层 | `AGENTS.md` | 全仓库 | 全仓库通用规范 |
| Host/Client 层 | `src/host/AGENTS.md`、`src/client/AGENTS.md` | 前/后端 | 前/后端公共规则 |
| 模块层 | `src/host/<module>/AGENTS.md` | 单个模块 | 仅本模块专属规则 |

`tests/AGENTS.md` 与模块层平行

---

## 项目导航

```
dsh-visual-workflow/
├── src/
│   ├── host/                     # Host 插件
│   │   ├── shared/               # 前后端共享纯类型契约
│   │   ├── storage/              # 持久化存储
│   │   ├── orchestrator/         # 运行锁、断点状态机、双向同步
│   │   ├── agent/                # 子代理执行引擎、护栏、提示词注入
│   │   ├── tools/                # wf_* 工具注册
│   │   ├── api/                  # GUI HTTP API 边界
│   │   ├── mcp/                  # Host 侧 MCP 配置注册表
│   │   ├── transfer/             # 导入导出
│   │   ├── service/              # 模式二服务
│   │   ├── sessions/             # 会话提供者
│   │   ├── embedding/            # 本地向量嵌入与索引
│   │   ├── scheduler/            # 定时任务
│   │   ├── graph/                # 图模型校检
│   │   ├── commands/             # / 命令注册
│   │   └── prompts/              # 编排提示词模板
│   └── client/                   # WebUI 源码
│       ├── sidebar/              # 右侧 Sidebar 标签页 / 侧边栏入口 / 常驻容器
│       ├── studio/               # 主状态机
│       ├── components/           # 组件
│       ├── hooks/                # 职责单一 hooks
│       └── lib/                  # 纯逻辑（remote/graph-model/bundle/storage）
├── tests/                        # 测试文件（client / host / contract / integration）
├── scripts/                      # 构建与 watch 脚本
├── cordis.patch.yml              # Web profile 挂载层
├── docs/                         # 文档统一存放
└── package.json
```

---

## 核心架构约束

以下规则属于硬性约束，除非明确进行架构变更，否则不得违反。

### DeepSeek Harness

* 不得修改 dsh 底层核心框架。
* 优先使用 patch、事件观察、`ctx` service 等非侵入式扩展机制。
* `@deepseek-ai/*` 不作为运行时直接依赖（不写入 `dependencies`）；通过运行时能力获取机制使用。
* `@huggingface/transformers` 是允许的第三方运行时依赖。

### Runtime / Agent 职责边界

Runtime 负责确定性事实，例如：

* 生命周期
* 完成 / 失败 / 超时
* 权限错误
* 状态持久化
* 消息投递
* Workflow 结构合法性

Agent / Prompt 负责不确定性的判断，例如：

* 是否需要重新规划
* 是否存在设计风险
* 是否需要向 Parent 汇报
* 是否需要改变执行策略

原则：

> Runtime 管确定性事实，Agent 处理不确定性判断，Parent 负责高层编排与治理。

---

## 依赖与隔离

* Host 与 Client 使用独立 TypeScript Program。
* `src/host/shared/` 只允许放 Host / Client 共享的纯类型或无运行时依赖契约。
* Client 不得引入 Host 运行时模块。
* Host 不得依赖 Client 实现。

---

## 代码规范

* TypeScript strict 模式。
* 类型导入使用 `import type`。
* React 使用函数组件与 hooks。
* Client 状态通过既定的单向状态流转机制管理。
* 核心逻辑优先使用纯函数。
* 运行时能力通过最小接口进行依赖注入。

---

## 编码规范

- 命名：文件使用 `kebab-case`；变量、函数和参数使用 `camelCase`；类型、接口、类和组件使用 `PascalCase`。命名应描述职责，而不是描述实现方式。
- 类型：公共函数必须显式声明参数和返回值类型；内部函数优先使用 TypeScript 类型推导。
- 模块：每个文件承担一个明确职责，并尽量只有一个主要变更原因；不同职责应拆分为独立模块。
- 依赖：优先保持单向依赖，避免循环依赖；共享逻辑应放入职责明确的模块，不创建无明确职责的 `utils.ts`、`helpers.ts` 等聚合文件。
- 字符串：统一使用双引号 `"`，并遵循项目 formatter / linter 配置。
- 注释：只解释非显而易见的设计原因、约束和副作用；避免重复代码本身已经表达的信息。
- 公共 API：修改公共接口、Tool Schema、数据结构或运行时契约时，必须同步检查调用方、测试和相关架构文档。
- 重构：纯重构应保持运行时行为不变；不得以“重构”为名顺便修改业务逻辑。

---

## 修改代码前

进行非 trivial 修改前，先明确：

1. 修改属于哪个模块？
2. 该模块负责什么？
3. 当前问题是什么？
4. 为什么应该修改这里？
5. 是否存在相关的其他模块？
6. 是否改变公共接口？
7. 是否改变运行时行为或状态机？

不要因为某个问题表现于某个文件，就默认该文件是正确的修改位置。

---

## 改动类型与最小验证

按改动内容选择最小验证集，不确定时一律跑 `pnpm check`：

| 改动内容 | 至少执行 |
|---|---|
| 纯文档（`docs/`、`*.md`） | 无需 |
| 任意 `src/` 代码 | `pnpm typecheck` + `pnpm test` |
| Client 文案（`src/client/i18n.ts`）、样式（`src/client/styles/**`）、组件文案或类名 | `pnpm check`（含客户端漂移门禁） |
| 共享契约（`src/host/shared/**`）、端点名 / 工具名 / 错误码 | `pnpm check` |
| `package.json`、构建脚本、`lib/` 产物 | `pnpm check` |

客户端漂移门禁（`tests/contract/client-*.test.ts`，静态断言、随 `pnpm test` 执行）机械拦截：

* 词典死键、词典字面量兜底、内联中文文案（`client-copy`）；
* 死样式类名、未定义/未使用的设计 token、样式内颜色字面量、静态内联样式、样式片段漏登记（`client-style`）；
* client 引入 Host 运行时、host 依赖 client、lib 依赖 UI、组件自建网络访问、端点字面量硬编码（`client-boundary`）。

门禁失败一律修代码或按提示更新基线条目；**禁止放宽断言**（见 `tests/AGENTS.md`）。
CI 在 push / PR 上执行同一套 `pnpm check`，见 `.github/workflows/check.yml`。

提交前快速兜底（可选，每个克隆执行一次）：

```bash
git config core.hooksPath .githooks   # 启用后 git commit 前会跑 pnpm gates（约 20 秒）
pnpm gates                            # 手动执行同一套契约门禁（只跑 tests/contract）
```

确认本次改动与门禁无关时用 `git commit --no-verify` 显式跳过。

---

## 特别注意

* 不要为了修复局部问题进行无关的大规模重构。
* 不要在没有验证的情况下宣称修改完成。
* 不要读取根目录 `prompt/` 中的文件，除非用户明确指定。
* 你无需阅读各模块的 AGENTS.md，当你进入相应模块时会自动注入到你的上下文。

---

## 工作原则

遇到冲突时，先识别冲突属于：

* 实现问题
* 架构问题
* 设计未明确
* 需求不清晰

不要通过猜测自动解决架构冲突。
遇到问题必须向用户说明并询问，再进行修改。