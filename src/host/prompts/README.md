# 提示词维护指南

本目录是**全插件提示词正文的唯一维护入口**。要改提示词，直接改 `texts/` 下的正文即可——
不需要读构建器代码，也不需要脑内拼装条件分支。

## 1. 目录结构

```
src/host/prompts/
├── texts/                          # ★ 提示词正文（唯一维护入口；一场景一文件）
│   ├── parent-orchestrator.ts      # 父代理 · 情况1 纯编排
│   ├── parent-hybrid.ts            # 父代理 · 情况2 编排 + 自执行
│   ├── parent-executor.ts          # 父代理 · 情况3 纯执行 + 情况2 末段任务块
│   ├── parent-planner.ts           # 父代理 · 规划期（/arrange）
│   ├── child-node-task.ts          # 子代理 · 任务块（含可通信对象清单）
│   ├── task-fallback.ts            # 任务 · 任务块为空时的兜底首条消息
│   ├── rule-graph-semantics.ts     # 规则 · 图语义（wf_org_catalog 返回）
│   ├── rule-design-method.ts       # 规则 · 设计方法（wf_org_catalog 返回）
│   ├── rule-patch-contract.ts      # 规则 · 写图契约（wf_org_catalog 返回 + 参数层错误引用）
│   ├── rule-db-tool.ts             # 规则 · 数据库三模式说明
│   ├── rule-soft-stop.ts           # 规则 · ReAct 软截停指令
│   ├── notice-send-message.ts      # 规则 · wf_send_message 消息投递包装
│   ├── notice-orchestration-change.ts  # 规则 · 运行期【编排变更】通知
│   └── en/                         # 英文变体（同一场景的完整正文；按运行语言整体选择）
├── render.ts                       # 唯一渲染器（{{变量}} / {{#if}}）
├── defaults.ts                     # 默认文本投影（中文规范存储 + 按语言本地化注入）
├── parents.ts / child.ts / planner.ts / rules.ts   # 事实 → 变量 → 渲染一次
└── index.ts                        # 对外唯一入口（模块外只从这里导入）
```

## 2. 模板语法（只有两种）

| 写法 | 语义 |
|---|---|
| `{{name}}` | 变量替换；缺失或空值替换为空串 |
| `{{#if name}}…{{/if}}` | 可选块；变量为空/假时整块消失（支持嵌套） |

渲染后若仍残留 `{{`，渲染器直接抛错（占位符名写错必须立刻可见）。
列表类内容（成员清单、上游产出、文件路径）由调用方先渲染成一段文本，再作为一个变量传入。

## 3. 父代理三模式与判定

| 模板文件 | 模式 | 判定条件（`orchestrator/directive.ts`） |
|---|---|---|
| `parent-orchestrator.ts` | 情况1 纯编排 | 无父代理节点，或父代理未被流程线驱动 |
| `parent-hybrid.ts` | 情况2 编排 + 自执行 | 父代理被流程线驱动，且画布中还有其他执行主体 |
| `parent-executor.ts` | 情况3 纯执行 | 父代理是唯一执行主体（无其他执行主体） |
| `parent-planner.ts` | 规划期 | `/arrange` 命令注入（无运行实例） |

## 4. 注入位置（谁能看到）

| 场景 | 通道 |
|---|---|
| 父代理三模式 / 规划提示词 / 编排变更通知 | 用户消息（`followupRoot` / `steer`） |
| 子代理任务块（含可通信对象清单） | 子代理首条用户消息 / 复用派发消息 |
| 图语义 / 设计方法 / 写图契约 | 工具调用返回（`wf_org_catalog` 索引） |
| 协作消息投递包装 | 消息投递（`wf_send_message`） |
| 软截停指令 | `agent/pre-step` 替换消息 + `tools.guard` 拒绝原因 |

## 5. 语言政策

- **运行与节点构建器按本次运行语言注入中文或英文指令**：同一场景在 `texts/` 与 `texts/en/`
  各有一份完整正文，由构建器按 `systemLanguage` 整体选择，不做逐句拼接。
- 工作台启动时把当前官方 locale（含自动浏览器/原生选择）经运行端点传入；无 GUI 的调用
  （调度器、服务、工具静默接续）使用 Host 设置。运行语言冻结进 `RunSnapshot.systemLanguage`，
  子代理任务、编排变更通知与续跑继承沿用同一份事实；旧快照回退 Host 设置。
- 工具名、工具 description 与其参数说明**保持英文**；JSON 字段名、取值、工具名与稳定错误码
  保留原样。用户自定义 Prompt、输入/输出契约与文件内容**不自动翻译**。
- **默认输出契约采用「中文规范存储 + 按语言本地化注入」**：磁盘保存
  `DEFAULT_OUTPUT_CONTRACT_TEXT`（中文规范值），英文运行注入英文默认文本；用户自定义契约
  原样透传（见 `defaults.ts`）。
- 按需返回的规则文本（图语义、设计方法、写图契约、软截停指令）当前仍为中文；它们不属于
  PR #19 的英文正文范围，后续如需英文需按 `texts/en/` 模式补齐。
- 惯用英文技术词（`System Prompt` / `allow-list` / `ReAct` / `ctx`）保留原样。
- **代码层约束不写入提示词**：只有 AI 有选择权、值得强调的软约束才进提示词。

## 6. 工具 description 英文写作规范（未变）

写作顺序（与官方 `packages/fs/tool-fs` 一致）：

1. **第一句 = 何时调用**（触发条件 + 做什么），不超过一句、直陈式。
2. **前置条件**：调用前必须满足的对象/状态。
3. **失败语义**：超时 / 拒绝 / 护栏错误 / 未找到等失败时的结果。
4. **副作用**（如适用）：阻塞 / 插队 / 持久化 / 覆盖等。
5. 精炼无客户化口吻；参数 description 同样英文短句。

> 工具 description / parameters / `output.schema` 是**常驻可见面**，另有治理体系
> （`docs/model-facing-surface-rules.md`）；它们不属于"提示词正文"，改动时走该体系。
