# 提示词模板基线

本目录是 `dsh-visual-workflow` 插件**所有提示词组装任务的唯一基线**。后续任何提示词组装必须引用本基线的构建器与
共享常量，不得各自硬编码模板正文，以保证 W-01（前缀稳定）与 W-02（关键约束双位）跨任务一致。

## 1. 文件清单

| 文件 | 作用 |
|---|---|
| `index.ts` | 统一出口：共享段落标记常量（`HEAD_MARKER` / `MID_MARKER` / `TAIL_MARKER` / `TAIL_RESTATE_MARKER` / `COLLAB_PREFIX`） + 三个构建器的 re-export |
| `orchestration.ts` | 编排指令模板构建器 `buildOrchestrationDirective(params)`（注入父代理） |
| `node-task.ts` | 节点任务块构建器 `buildNodeTaskBlock(params)`（注入节点子代理） |
| `collab.ts` | 协作 Prompt 构建器 `buildCollabPrompt(text)`（追加到组成员 System Prompt 末尾） |
| `README.md` | 本文件：§13.1 检查单落地表 + W-03 工具描述英文写作规范 |

三个构建器均为**纯函数**：不读 `Date.now`/随机源，同一 `params` 两次构建字节相同。

## 2. §13.1 检查单落地表

| 规范点（§13.1） | 本基线实现位置 | 用法 |
|---|---|---|
| **前缀稳定（KV 缓存友好）** | 三个构建器的模板字符串首段（`HEAD_MARKER` 起）、中段（`MID_MARKER` 起）为固定文本，字节稳定；动态值仅注入末段（`TAIL_MARKER` 之后） | 同一 run 内只允许改 `params` 的末段动态字段；禁止在测试/调用处拼接不稳定内容到前中段 |
| **注意力位置（关键约束双位）** | `HEAD_MARKER`（首段硬约束）+ `TAIL_MARKER`/`TAIL_RESTATE_MARKER`（末段重申） | 最重要约束（`ORCH_HARD_CONSTRAINTS` / `NODE_HARD_CONSTRAINTS` 短语）同时出现在输出首段与末段，测试断言这一点 |
| **稳定段落化（同一 run 不再变化）** | 模板集中在本目录；动态态信息以变量注入尾部（`renderDynamicState` 内部纯函数） | 后续组装任务（T-021 等）复用构建器，不在运行时重排模板字符串 |
| **协作 Prompt 追加位置** | `collab.ts` 的 `buildCollabPrompt`，以 `COLLAB_PREFIX`（`collab:`）起段 | 追加到子代理 persona/任务文本**末尾**，与 `task:` 任务段分隔（对既有前缀零失效） |
| **工具 schema 稳定性** | 本基线不注册工具；但要求工具 description 走 W-03（见 §3），输出 render 键序稳定 | T-023/T-024/T-025 注册工具时遵守 §3 与 textRender 键序稳定约定 |

## 3. W-03 工具 description 英文写作规范

（面向模型的标准英文；代码注释/文档仍用中文 W-04。单条 description 目标 ≤ 120 tokens。）

写作顺序（与官方 `packages/fs/tool-fs` 一致，范本见 `read.ts` / `write.ts` / `edit.ts`）：

1. **第一句 = 何时调用**（触发条件 + 做什么），不超过一句、直陈式。
2. **前置条件**：调用前必须满足的对象/状态（如「文件必须存在」「参数非空」）。
3. **失败语义**：超时 / 拒绝 / 护栏错误 / 未找到等失败时的结果。
4. **副作用**（如适用）：阻塞 / 插队 / 持久化 / 覆盖等影响。
5. 精炼无客户化口吻；参数 description 同样英文短句，枚举与值域内联。

**正例**（约 20 tokens）：

> `Search file contents with a ripgrep regular expression. Returns matching lines with line numbers, grouped by file. Use read on a matched file for surrounding context.`

**反例**（何时调用不明确、混入客户化口吻、缺失败语义）：

> `强大的搜索工具，帮你在项目里找东西，搜不到也会一直试。太长的结果会截断。`

反例问题：① 首句非直陈触发条件（「强大的…帮你在…」）；② 无前置条件；③ 失败语义不明确
（「一直试」未说明边界）；④ 无副作用说明；⑤ 用词非官方英文风格。
