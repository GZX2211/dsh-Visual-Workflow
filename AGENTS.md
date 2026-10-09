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
│   │   ├── assets/               # SQLite 资产库与经验持久化
│   │   ├── experience/           # 经验域（校验/投影/向量/判重/召回/主体解析）
│   │   ├── orchestrator/         # 运行锁、断点状态机、双向同步
│   │   ├── agent/                # 子代理执行引擎、护栏、提示词注入
│   │   ├── tools/                # wf_* 工具注册
│   │   ├── team/                 # 官方 Agent Team 能力适配
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
│       ├── styles/               # 样式文件
│       ├── components/           # 画布、资产、历史、定时任务等 UI 组件
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

* 不得修改 dsh 底层核心框架。
* 优先使用 patch、事件观察、`ctx` service 等非侵入式扩展机制。
* `@deepseek-ai/*` 不作为运行时直接依赖（不写入 `dependencies`）；通过运行时能力获取机制使用。
* `@huggingface/transformers` 是允许的第三方运行时依赖。

---

## 依赖与隔离

* Host 与 Client 使用独立 TypeScript Program。
* `src/host/shared/` 只允许放 Host / Client 共享的纯类型或无运行时依赖契约。
* Client 不得引入 Host 运行时模块。
* Host 不得依赖 Client 实现。

---

## 开发规范

- 语言使用 TypeScript strict 模式；类型导入统一使用 `import type`。公共函数必须显式声明参数和返回值类型，内部函数优先使用类型推导。
- React 使用函数组件与 hooks；Client 状态通过既定的单向状态流转机制管理。
- 核心逻辑优先使用纯函数；运行时能力通过最小接口进行依赖注入。保持单向依赖，避免循环依赖；共享逻辑放入职责明确的模块，不创建无明确职责的 `utils.ts`、`helpers.ts` 等聚合文件。
- 文件使用 `kebab-case`；变量、函数和参数使用 `camelCase`；类型、接口、类和组件使用 `PascalCase`。命名应描述职责，而不是描述实现方式。
- 每个文件承担一个明确职责，尽量只有一个主要变更原因；不同职责拆分为独立模块。
- 修改公共接口、Tool Schema、数据结构或运行时契约时，必须同步检查调用方、测试等相关内容。

---

## 注释规范

- 原则：注释只补充代码未表达的信息，只解释 why（非显而易见的约束、绕行、决策背景、陷阱）；删掉不影响理解就不写。
- 禁止：历史叙述；行号/内部文档指针；复述代码；断言外部库行为。
- 保留：文件首行路径头注释。
- 必须：兼容与降级（分支条件、失败行为）；不变量/前置条件；业务/安全规则；无法从代码推断的设计依据。
- 书写：贴近所描述代码；公共 API 用对应文档注释格式（JSDoc/TSDoc），只写自然语言，结构标签交给工具；精炼、简洁、准确，长度以必要为限。
- 行为变更同步更新或删除注释，不能同步时删除优于保留错误注释。

---

## 改动与验证

按改动选择最小验证；不确定时跑 `pnpm check`。

| 改动内容 | 至少执行 |
|---|---|
| 纯文档（`docs/`、`*.md`） | 无需 |
| 任意 `src/` 代码 | `pnpm typecheck` + `pnpm test` |
| Client 文案（`src/client/i18n.ts`）、样式（`src/client/styles/**`）、组件文案或类名 | `pnpm check` |
| 共享契约（`src/host/shared/**`）、端点名 / 工具名 / 错误码 | `pnpm check` |
| `package.json`、构建脚本、`lib/` 产物 | `pnpm check` |

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