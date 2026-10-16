# 提示词统一化方案（维护性改造 · 设计稿）

> 目标：解决"提示词散落各处 + 过分组装化 + 只能靠实际运行才能看到全貌"三个问题。
> 本文档只给方案与决策点，**未修改任何 `src/` 代码**。

---

## 1. 现状为什么难维护（根因拆解）

### 根因 A：正文与组装逻辑交错

以父代理编排提示词为例，同一份文本被切成 4 个部分、分散在 3 个文件、经 6 个函数拼装：

| 文本部分 | 定义位置 | 拼装位置 |
|---|---|---|
| 首段（身份 + 5 条约束） | `orchestration.ts` 的 `buildHeadSection` + `ORCH_HARD_CONSTRAINTS` | `buildOrchestratorPrompt` / `buildHybridPrompt` |
| 中段（拓扑召回 / 目标 / Team） | 同文件 `buildMidSection`（内含 official/legacy 分支） | 同上 |
| 末段（重申 + 动态状态 + 预算 + 父任务块） | 同文件 `buildTailSection` / `renderDynamicState` | 同上 |
| 语言规则 | `prompt-rules.ts` | 三处调用 |
| 段落锚点 | `markers.ts` | 全部构建器 |
| 情况2 父代理任务块 | `executor.ts` 的 `buildParentTaskSpec` | `directive.ts` 注入末段 |

要看清"情况2 的完整提示词"，必须同时读 4 个文件的 8 个函数，并在脑中做条件分支展开（`collabGroups.length > 0`、`collabChannel === 'official'`、`isResume`、`pauseNodeIds.length`、`orgBudgetText`、`parentTaskBlock`…）。

### 根因 B：一模式不落一文件

父代理有 3 种模式（情况1 纯编排 / 情况2 编排+自执行 / 情况3 纯执行），但文本差异只体现在两个函数的参数差里（身份行 + 第 1 条约束不同），**没有任何一处能直接读到"情况2 全文"**。子代理虽只有 1 种任务块，但它的可选项（组内成员 / legacy 通道 / 契约 / 上游产出）同样靠条件拼接。

### 根因 C：正文散落在 6 个模块

| 模块 | 承载的模型可见正文 |
|---|---|
| `src/host/prompts/` | 编排 / 任务块 / 协作块 / 规划 / 图语义 / 预算 / 变更通知 / 语言规则 |
| `src/host/orchestrator/` | `graph-facts.ts` 的 DB 工具说明；`ask-protocol.ts` 的协作消息文本 |
| `src/host/agent/` | `guards.ts` 的软截停指令；`runner.ts` 的兜底任务文本 |
| `src/host/tools/` | `graph-op-contract.ts` 的写图契约；11 个工具的 description/schema |
| `src/host/experience/` | `anchor-definitions.ts` 的评价锚点表 |
| `src/client/` | `i18n.ts` 的内置父代理职责提示词（播种初值） |

没有一张"提示词地图"能回答"某条规则在哪个文件、属于哪个功能、注入给谁"。

### 根因 D：没有"全貌产物"

组装结果是运行时才出现的字符串。测试只断言锚点常量（`HEAD_MARKER` 等），无法给人工审阅提供可读的全貌，也无法 diff。

---

## 2. 方案总览（一句话）

> **把"提示词正文"从"组装逻辑"里彻底拆出来：一个注入场景 = 一个模板文件 = 一段从上到下的完整正文（占位符显式标注）；组装退化为一次占位符替换；并自动产出可读的"全貌预览"与"提示词地图"。**

四个组成部分：

1. **正文单一位置**：`src/host/prompts/texts/`（唯一维护入口）；
2. **一场景一文件**：文件名直接写明角色与模式（`parent-orchestrator` / `parent-hybrid` / `parent-executor` / `child-node-task` …）；
3. **极简渲染器**：`render.ts`——`{{var}}` 替换 + `{{#if var}}…{{/if}}` 可选块，无其它语法；渲染后残留 `{{` 即报错；
4. **全貌产物**：`docs/prompt-previews/<场景>.md`（脚本生成，可 diff、可直接审阅），加一张 `docs/prompt-map.md`（注入点 → 文件 → 触发条件 → 变量 → 呈现位置）。

---

## 3. 目录与文件设计

```
src/host/prompts/
├── texts/                          # ★ 正文唯一维护入口
│   ├── parent-orchestrator.ts      # 情况1 纯编排（全文）
│   ├── parent-hybrid.ts            # 情况2 编排 + 自执行（全文）
│   ├── parent-executor.ts          # 情况3 纯执行（全文）
│   ├── parent-planner.ts           # 规划期（或按 target 三态再拆，见 Q7）
│   ├── child-node-task.ts          # 子代理任务块（全文）
│   ├── child-collab-block.ts       # 降级通道协作块
│   ├── rule-graph-semantics.ts     # Catalog rules.graphSemantics
│   ├── rule-patch-contract.ts      # 写图契约（自 tools 迁入，见 Q5）
│   ├── rule-design-method.ts       # 设计方法（移出/保留由你定案）
│   ├── rule-db-tool.ts             # DB 三模式说明
│   ├── rule-soft-stop.ts           # ReAct 软截停指令（若迁入）
│   ├── notice-orchestration-change.ts
│   ├── notice-ask-message.ts       # 协作 ask/reply 消息文本（若迁入）
│   ├── segment-org-budget.ts       # 预算段（保留与否由你定案）
│   └── role-parent-default.ts      # 内置父代理职责（播种初值，若迁入）
├── render.ts                       # ★ 唯一渲染器（占位符 + 可选块）
├── index.ts                        # 对外入口（导出名保持不变，调用方零改动）
└── AGENTS.md / README.md           # 维护规范（重写：模板即全貌、禁止小段拼接）
```

模板文件形态（示意，正文用大段文本、变量用 `{{}}`）：

```ts
// src/host/prompts/texts/parent-hybrid.ts
//
// 适用：情况2 编排 + 自执行（父代理被流程线连接，且画布中还有其他执行主体）
// 注入位置：父代理 system prompt（职责部分） + 首条用户消息 followup（规则/任务部分）
// 变量：workflowName / parentNodeLabel / parentNodeId / workflowGoal / teamList / systemLanguage / parentTaskBlock

export const PARENT_HYBRID = `
# 硬性约束

你是工作流「{{workflowName}}」的编排父代理，同时以节点「{{parentNodeLabel}}」（id={{parentNodeId}}）的身份执行自身任务。

1. 执行+编排：你既是执行节点，也要负责调度子代理；你只执行指向自身的节点任务。
2. …
`
```

---

## 4. 渲染器设计（唯一组装点）

```ts
// src/host/prompts/render.ts
export function renderTemplate(
  template: string,
  vars: Record<string, string | undefined>,
): string
```

- `{{name}}`：有值替换，无值替换为空串；
- `{{#if name}}…{{/if}}`：可选块（**不支持嵌套**，保持可读；确实需要嵌套时拆文件，而不是堆语法）；
- 列表类内容（Team 成员、上游产出、文件索引）由调用方**先渲染成一段文本**再作为变量传入——模板里不出现循环逻辑；
- 渲染结果残留 `{{` → 抛错（开发期护栏 + 测试门禁），避免"变量名写错静默留空"。

## 5. 全貌产物：预览与地图

| 产物 | 内容 | 生成方式 | 价值 |
|---|---|---|---|
| `docs/prompt-previews/parent-orchestrator.md` 等 | 每个场景渲染后的**完整提示词**（用固定样例变量） | `pnpm prompts:preview`（脚本） | 不运行工作流即可审阅全文；改动可 diff |
| `docs/prompt-map.md` | 注入点 → 模板文件 → 触发条件 → 变量表 → **呈现位置**（system prompt / followup / 工具返回） | 从模板文件头的元信息生成 | 回答"这条规则在哪个文件、属于哪个功能" |

预览脚本建议同时打印每个模板的字符数/token 估算，便于后续按"当前任务需求"裁剪常驻内容。

---

## 6. 迁移步骤（TDD、分四阶段，每阶段全绿）

### 阶段 1：纯搬迁（零行为变化）
1. 先写"字节等价"测试：对新渲染结果与**现有构建器输出**逐字节比对（覆盖三情况 + 各条件分支组合）；
2. 建立 `texts/` 与 `render.ts`，把现有输出**逐字**搬进整段模板；
3. `index.ts` 保持导出名与签名不变（`buildOrchestratorPrompt` 等），调用方不改；
4. 跑 `pnpm typecheck` + `pnpm test` → 全绿即证明"搬迁无行为变化"。

### 阶段 2：产出全貌
5. 加 `scripts/prompt-preview.mjs` + `docs/prompt-previews/*` + `docs/prompt-map.md`；
6. 你把预览读一遍，确认"这就是你要维护的正文形态"。

### 阶段 3：内容整改（你已定案的部分）
7. 删除 `# 动态状态` 整章（含 `## 重申约束`、当前运行状态、组织预算）——**边界见 §8 待确认项**；
8. 其余边界整改（职责/规则分离、任务提示词提交约束等）在同一结构上落。

### 阶段 4：收敛散落正文
9. 逐项把 §1 根因 C 表中的正文迁入 `texts/`（或就地注明"为何不迁"）；
10. 重写 `prompts/AGENTS.md` / `README.md`（维护规范改为"模板即全貌"）。

> 建议顺序理由：先做零行为搬迁，才能用"逐字节相同"证明搬迁正确；若先删内容再搬，正确性无从验证。

---

## 7. 需要你定案的决策点

| # | 决策点 | 选项 | 建议 |
|---|---|---|---|
| Q1 | 模板承载形态 | (a) `.ts` 大段模板字符串（零构建改动，反引号需规避）／(b) `.md` + rolldown/vitest 双端 loader（需新增插件与类型声明）／(c) `.md` + codegen 生成 `.ts`（生成物入库） | **(a)**：当前 host 用 tsc 直编 TS、vitest 直跑 TS，方案 (b)(c) 都要改构建链与发布包 |
| Q2 | 是否允许模式间正文重复 | (a) 允许（可读性优先，一个模式一份完整正文）／(b) 坚持"共享措辞单一源、变体不复制模板"（现 `prompts/AGENTS.md` 原则） | **(a)**——你的痛点是组装化，(b) 正是组装化的成因；需同步废止该原则 |
| Q3 | 可选段表达 | (a) 模板内 `{{#if}}`／(b) 每个可选组合拆成独立文件（文件数翻倍） | **(a)**，且只在确有必要时使用 |
| Q4 | 预览产物是否纳入校验 | (a) 仅生成、人工审阅／(b) 生成 + 测试门禁（预览过期即失败） | **(b)**（否则很快漂移） |
| Q5 | 哪些散落正文迁入 | 勾选：DB 说明 / 协作消息文本 / 软截停指令 / 兜底任务文本 / 写图契约 / 评价锚点 / 内置父代理职责 / 编排变更通知 | 建议除"工具 description/schema（你说已内聚）"与"评价锚点（常驻面）"外**全部迁入** |
| Q6 | 规划提示词（target 三态） | (a) 1 个文件内 3 段／(b) 3 个文件 | **(b)**，与父代理三模式同构 |
| Q7 | 提示词地图产物 | (a) 由模板文件头元信息自动生成 `docs/prompt-map.md`／(b) 手工维护 | **(a)** |
| Q8 | 内置父代理职责提示词（现 `client/i18n.ts`） | (a) 迁到共享契约层（host/client 都可引用）／(b) 留在 client | (a) 更符合"正文单一位置"，但需确认 `src/host/shared/` 放字符串常量的边界（AGENTS.md 允许"无运行时依赖契约"） |

---

## 8. 附：你第 1 条整改的边界待确认（删除"动态章节"）

你已定案：删除经用户消息注入的提示词中 `# 动态状态` 整章、`## 重申约束`、当前运行状态、本次组织预算。
但该章节里还混着以下内容，删前需要你逐项确认（否则会丢功能或丢契约）：

| # | 内容 | 删掉后的后果 |
|---|---|---|
| D1 | 情况2 的 `【你的节点任务】{parentTaskBlock}` | 情况2 父代理不知道自己该执行什么（该模式的核心语义） |
| D2 | 规划提示词的「当前规划任务：用户意图 / 用户 SOP」 | 父代理不知道规划目标（`/arrange` 的核心输入） |
| D3 | 「运行参数」（模式一用 `wf_run_node`／模式二用 `wf_run_node_wait`） | 模式二可能用错启动工具（会被工具拒绝并自纠，但有失败成本） |
| D4 | 「断点继续 / 暂停节点」状态 | **断点续跑失去起点信息**（`resumeFromNodeId` 当前只在此注入） |
| D5 | 子代理任务块末段的「输出契约」 | 节点配置的交付格式丢失（与你第 3 条定案"input/output schema 保留"冲突，需移到中段） |
| D6 | `TAIL_MARKER` / `TAIL_RESTATE_MARKER` 常量 | 大量测试与 `prompts/README.md` 契约引用它们；需同步改造测试与文档 |

我的建议：D1/D2/D5 移入中段（内容保留、位置调整），D3/D4 若确实不要"动态状态章节"，需要给出替代位置（例如 D3 移入规则段、D4 移入编排任务段），D6 随测试一并改造。
