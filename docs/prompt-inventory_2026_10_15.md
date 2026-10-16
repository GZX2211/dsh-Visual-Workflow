# 提示词与模型可见规则上下文 · 现状清单与「职责 / 任务 / 规则」边界归类

> 状态：**分析稿（未改动任何代码）**。用于人工审阅「现有提示词在当前最新架构中是否仍准确」。
> 边界定义（用户定案，待固化进治理体系）：
>
> - **职责提示词**：角色稳定职责契约（跨角色差异、跨任务稳定）；应版本化、入库、用户可调整；书写五维＝角色定位 / 职责范围 / 行为规范 / 决策权限 / 交接契约。
> - **任务提示词**：当前项目与状态下为某岗位分配的阶段性任务；随项目/状态即时生成与分配；规范＝执行路径 + 交付内容 + 执行方式 + 验收标准；自包含、不与职责重复。
> - **规则提示词**：插件自身功能所定义的专属规则事实（不告诉代理就无法正常完成工作）；随插件架构变化；硬编码、不版本化、用户不可调整。
>
> **范围**：一切进入代理上下文的**文本**（提示词构建器产物、按需返回的规则段、工具常驻 description/参数/输出说明、注入通知）。
> **排除**：用户储存数据中的提示词（节点/资产的 systemPrompt 正文、Team collabPrompt 正文）、经验生成提示词（`src/host/assets/experience-seeds.ts`，已按用户要求排除）。
> 界面文案（client i18n、GUI 卡片）**不算**模型可见面，仅在与提示词播种有关时提及。

---

## 1. 清单总览

| # | 位置 | 产物 | 注入对象 / 时机 | 语言 | 现行归属（初判） |
|---|---|---|---|---|---|
| A1 | `src/host/prompts/markers.ts` | 4 个段落锚点常量 | 所有构建器的结构骨架 | 中文 | 结构（非内容） |
| A2 | `src/host/prompts/prompt-rules.ts` | 系统语言规则句 | 所有构建器 | 中文 | **规则** |
| A3 | `src/host/prompts/orchestration.ts` | 父代理编排提示词（情况1 纯编排 / 情况2 编排+自执行） | `startRun`/`resumeRun` → `followupRoot` 注入父代理 | 中文 | **规则＋职责＋任务＋事实（混合体，需拆）** |
| A4 | `src/host/prompts/executor.ts` | 情况2 末段「你的节点任务」任务块；情况3 纯执行提示词 | 同上 | 中文 | **任务＋规则（混合体）** |
| A5 | `src/host/prompts/node-task.ts` | 子代理节点任务块 | `wf_run_node` 启动/复用派发时作为子代理首条消息 | 中文 | **任务（含规则条目）** |
| A6 | `src/host/prompts/collab.ts` | 降级通道协作成员清单块 | 追加到组内成员任务块末尾 | 中文 | **规则（通道与寻址定义）＋交接契约** |
| A7 | `src/host/prompts/org-plan.ts` | 规划期父代理提示词 | `/arrange` 命令注入 | 中文 | **规则＋职责＋任务（混合体）** |
| A8 | `src/host/prompts/org-sop.ts` | 图语义 L1 ＋ 设计方法 | `wf_org_catalog` 索引返回 `rules.graphSemantics` / `rules.designMethod` | 中文 | **规则（L1）＋方法论/任务（设计方法，疑似错位）** |
| A9 | `src/host/prompts/org-budget.ts` | 本次组织预算末段 | 编排/规划提示词末段 | 中文 | **规则（预算护栏事实）＋动态事实** |
| A10 | `src/host/prompts/orchestration-change.ts` | 【编排变更】系统通知 | 运行中画布保存改变编排语义时注入父代理 | 中文 | **规则（通知协议）** |
| B1 | `src/host/tools/infrastructure/graph-op-contract.ts` | 写图契约全文（提交规则 / op 形状 / role data 契约 / 错误码语义） | `wf_org_catalog` 的 `rules.patchContract`；`wf_graph_patch` 参数层错误消息 | 英文 | **规则** ✅ |
| B2 | `src/host/orchestrator/graph-facts.ts` | 数据库工具说明（三模式）与所连数据节点清单 | 子代理/父代理任务块中段 | 中文 | **规则** ✅ |
| B3 | `src/host/orchestrator/ask-protocol.ts` | 协作消息文本 + 回复指令 + 回复回执文本 | 成员间 `wf_ask_agent` 投递消息 | 中文 | **规则（消息协议）＋交接契约** |
| B4 | `src/host/agent/guards.ts` | ReAct 软截停强制收尾指令 + 工具拒绝原因 | `agent/pre-step` 替换消息 / `tools.guard` | 英文 | **规则（插件护栏）** ✅ |
| B5 | `src/host/agent/runner.ts` | 任务块为空时的兜底 prompt | 子代理创建（防御性兜底） | 中文 | **任务**（硬编码兜底） |
| B6 | `src/client/i18n.ts` | 内置父代理角色提示词（播种初值） | 新建父代理节点时写入其 systemPrompt | 中/英 | **职责**（硬编码在 client，⚠️ 与「职责应入库、用户可调、不硬编码」有张力） |
| C | 11 个 `wf_*` 工具的 description / parameters / output.schema 说明 | 工具常驻可见面 | 每回合常驻 | 英文 | **规则**（工具契约；已按 `docs/model-facing-surface-rules.md` 逐工具复核） |
| D | `src/host/assets/experience-seeds.ts` | 两类经验生成提示词 V1 种子 | `wf_experience_learn` 空数组调用返回 | 中文 | **排除项**（用户明确不整理） |

注入通道（已核对，无遗漏文本通道）：`followupRoot`（编排指令/规划指令/编排变更）、子代理首条消息（任务块+协作块+协作说明）、`agent/pre-step`（软截停）、`system-prompt/assemble`（角色 Prompt 段 `visual-workflow:prompt`，正文来自用户数据）、工具注册（常驻 description/schema）、`wf_org_catalog` 返回（规则段）、`wf_ask_agent` 投递（协作文本）。

---

## 2. A 组正文（`src/host/prompts/`，逐字）

### A1 `markers.ts`（结构锚点，非提示词内容）

```
HEAD_MARKER          = '# 硬性约束'
MID_MARKER           = '## 流程上下文'
TAIL_MARKER          = '# 动态状态'
TAIL_RESTATE_MARKER  = '## 重申约束'
```

契约：`TAIL_MARKER` 之前为同一 run 内字节稳定的前缀；动态值只允许出现在其后。

### A2 `prompt-rules.ts`

- `systemLanguageRule(lang)` = `所有对话回复、注释、思考过程必须使用{lang}`
- `languageRuleLine(lang)` = 非空白时 `上述句 + 。`，否则空串（不注入）。

### A3 `orchestration.ts` — 父代理编排提示词（情况1 / 情况2）

情况1（`buildOrchestratorPrompt`）组装结果（`{}` 为注入值）：

```
# 硬性约束

你是工作流「{workflowName}」的编排父代理。

1. 仅编排：你负责调度子代理并协调工作，不亲自执行节点任务。
2. 节点判定：只有收到结算通知（Background subagent … finished …）才算该节点完成；收到前不得推进下游或收尾。
3. 收尾时调用 wf_finish （只调用一次，幂等，释放运行锁）。
4. 绝不静默跳过失败节点；可重新尝试激活该节点一次，若仍失败则询问用户；若编排失控或确认无法继续，即终止运行。
5. 条件分支由你依据上游节点的实际产出进行语义判断。
6. 所有对话回复、注释、思考过程必须使用{systemLanguage}。

## 流程上下文

工作流拓扑：用 wf_org_catalog（ids: ["instance"]）召回当前运行实例的骨架（节点、连线与可调度标记）；不要试图从文件系统读取编排定义。首次调度前必须召回一次；此后仅在收到【编排变更】通知或你自己用 wf_graph_patch 改过图之后复核时按需召回，无需每轮重召回。

工作流目标：{workflowGoal}                      ← 仅目标非空时

Team（官方团队）：                                ← 仅存在 Team 卡片时；official 通道
- {groupId}（{label}）：成员节点 [{memberIds}]

根据实际任务情况按需调用 wf_run_node(成员节点 id) 启动 Team 成员；
成员以 teammate 身份运行，自带 Team 工具（list_agents / send_message / team_task_*）与协作策略；分工与交接用官方任务板登记（team_task_create → claim → complete，按 revision 做 CAS 更新），不要自建任务清单。

（降级通道分支替换为）Team（降级通道）：
官方 Team 不可用：成员降级为普通子代理，逐个用 wf_run_node 启动；组内通信用 wf_ask_agent。

# 动态状态

## 重申约束
- 收尾时调用 wf_finish （只调用一次，幂等，释放运行锁）。
- 绝不静默跳过失败节点。
- 所有对话回复、注释、思考过程必须使用{systemLanguage}。

当前运行状态：
- 全新运行；无可恢复的检查点。  ／  正在恢复先前运行（resumedFromRunId：{id}）。
- 已 ok 的节点不得重跑；从节点 {resumeFromNodeId} 开始，使用检查点产出注入 ctx。
- 本工作流无暂停节点。  ／  暂停节点：[{ids}]。暂停运行并持久化检查点；之后从其 flow-out 恢复继续。
- 运行参数：{runParamsText}
- 用户问题（服务模式）：{question}                ← 仅模式二
{orgBudgetText}                                  ← 仅注入时
【你的节点任务】（以下任务由你亲自执行，不得下发）：   ← 仅情况2
{parentTaskBlock}
```

情况2（`buildHybridPrompt`）仅两处不同：身份行追加「，同时以节点「{nodeLabel}」（id={nodeId}）的身份执行自身任务」，第 1 条替换为
`执行+编排：你既是执行节点，也要负责调度子代理；你只执行指向自身的节点任务`。

情况3 / 续跑继承完成（父单元已 ok）走 A4 或退回情况1。

### A4 `executor.ts`

`buildParentTaskSpec`（情况2 末段小节，无块级标题）：

```
严格按照规范执行节点「{nodeLabel}」。
上游产出：
- {source}（id：{nodeId}）：{content}
／ 上游产出：（无）
文件路径索引（自行读取）：
- {path}
数据库工具说明：{dbToolHint}
运行上下文：{runContextText}                     ← 仅非空时
```

`buildParentExecutorPrompt`（情况3 完整提示词）：

```
# 硬性约束

你是工作流「{workflowName}」的执行节点「{nodeLabel}」。

1. 完成节点任务后，调用 wf_finish 结束本次运行（只调用一次，幂等）。
2. 严格按照规范执行本节点
3. 与组内成员的一切协作消息必须使用 wf_ask_agent（ask / reply），不得用普通文本模拟对话或绕过工具直接发送消息。   ← 仅组内成员
4. 所有对话回复、注释、思考过程必须使用{systemLanguage}。

## 流程上下文

上游产出：… ／ （无）
文件路径索引（自行读取）：
- {path}
数据库工具说明：{dbToolHint}

# 动态状态

## 重申约束
- 完成节点任务后，调用 wf_finish 结束本次运行（只调用一次，幂等）。
- 与组内成员的一切协作消息必须使用 wf_ask_agent（ask / reply）。   ← 仅组内成员
- 所有对话回复、注释、思考过程必须使用{systemLanguage}。

当前执行状态：
- 运行上下文：{runContextText} ／ （无）
```

### A5 `node-task.ts` — 子代理节点任务块

```
# 硬性约束

你正在执行节点「{nodeLabel}」。

1. 所有对话回复、注释、思考过程必须使用{systemLanguage}。
2. 与组内成员的一切协作消息必须使用 wf_ask_agent（ask / reply）。   ← 仅降级通道组内成员

## 流程上下文

上游产出：
- {source}（id：{nodeId}）：{content}
／ 上游产出：（无）
文件路径索引（自行读取）：
- {path}
输入契约（你应当收到的输入）：
{inputContract}                                  ← 仅非空
数据库工具说明：{dbToolHint}                      ← 仅非空

# 动态状态

## 重申约束                                       ← 仅存在重申条目时
- 与组内成员的一切协作消息必须使用 wf_ask_agent（ask / reply）。   ← 仅降级通道组内成员
- 输出契约（你的最终回复必须按其组织）：{outputContract}。        ← 仅非空
```

协作块／团队协作说明追加在同一消息末尾（见 A6）。

### A6 `collab.ts`

降级通道（当前唯一有调用方的分支）：

```
你是 Team 的成员。本组成员为：
- {label}（id：{id}）
与其他成员通信时，请使用 wf_ask_agent 工具，并将 targetChildId 填为对方成员 id。

组内说明：
{custom}                                         ← 仅非空
```

official 分支（**当前无调用方**，保留备用）：成员行改为 `- {label}（成员名：{target}）`，通信句改为 `与其他成员通信时，请使用 send_message 工具，target 填对方的成员名；需要 Lead 决策时 target 填 "lead"。`

### A7 `org-plan.ts` — 规划期父代理提示词

首段身份按 `target` 三态（create / template / instance）取值，其余固定：

```
# 硬性约束

你是工作流「{targetName}」（id={targetId}）的组织规划师。   ← template/instance 变体
／ 你是工作流的组织规划师：请按用户意图规划并新建一个工作流模板。  ← create

1. {grammar}
   create：新建模板：提交 scope='template' 且带 create={name, description?, mode?} 的补丁，工具返回的 targetId 即新模板 id
   template/instance：改既有目标：scope='template' 改模板、scope='instance' 改实例，且必须带 targetId 与 expectRevision
2. 只规划模板：本阶段不创建实例、不启动运行，是否投产由用户决定
3. 先取规则再动手：不传 ids 调用 wf_org_catalog 拿到编排规则与现有资产，再勘察工作区事实，最后才提交补丁
4. wf_org_catalog 与 wf_graph_patch 默认开启；任一工具不可用时，提示用户到组合管理开启后重试，不要改用其他方式改图
5. 所有对话回复、注释、思考过程必须使用{systemLanguage}。

## 流程上下文

规划目标模板：{name}（id={id}）。规划产物先落盘为模板快照，再由用户决定是否投产。
／ 规划目标实例：{name}（id={id}）。对实例的编排改写会即时同步到运行中的编排与画布回显。
／ 规划目标：新建工作流模板「{name}」（模板 id 由 wf_graph_patch 的 create 通路生成并返回）。

编排规则（图语义、设计方法与写图契约）由 wf_org_catalog 提供：不传 ids 调用它即可获得规则全文与资产索引，动笔前先取。

# 动态状态

## 重申约束
- {grammar}
- 只规划模板：本阶段不创建实例、不启动运行，是否投产由用户决定
- 所有对话回复、注释、思考过程必须使用{systemLanguage}。

提交前自检（逐条确认，任一不成立就先补齐再提交）：
- 交付物清单：每份交付物都有对应节点，且节点之间没有重复职责。
- 落盘路径与消费方：每份交付物写明写到哪个文件，以及谁会读它（上游产出会自动注入其流程下游，不需要为此建 ctx 线）。
- 读取通道：每个下游节点都知道去哪里读上游产出（自动注入的上游产出，或已写成文件且路径已在任务里说明）。
- 节点配置：每个 agent 节点都有 systemPrompt 与非空 presetId（工具组合）。

当前规划任务：
- 用户意图：{userIntent} ／ （未提供，请先与用户确认目标后再动手）
【用户 SOP】（用户可编辑注入点，优先级最高）：    ← dynamic.userSop（**当前无调用方**）
{sop}
{orgBudgetText}
```

### A8 `org-sop.ts` — `wf_org_catalog` 的 rules 段（全文）

`ORG_SOP_L1_GRAPH_SEMANTICS`：

```
组织规划图语义（L1：图模型与硬规则）：

一、节点种类（9 种，kind 字段为判据）
1. start：启动节点，模式一入口；全图仅 1 个，只允许流程出线；
2. end：结束节点，模式一出口；全图仅 1 个，只允许流程入线；
3. pause：暂停节点，运行到此落检查点并等待恢复；必须同时有流程入线与流程出线；
4. agent：子代理执行节点，承担可独立交付的任务；
5. parent：父代理节点，既是调度中枢也是执行单元；被流程线连接时父代理亲自执行该节点任务，通常执行规划型任务；
6. group：Team 卡片（包裹层），把多个成员节点包成一个团队；**卡片自身不是执行单元**，成员节点才是执行主体，可按需调度启动；
7. proxy：虚拟节点（主节点别名引用），无独立配置，只能引用角色节点（agent/parent）；
8. file：文件数据源节点——写图只产**文本型**（内容可为空，用于说明或承载文本）；受管文件只能由画布手工选择；
9. database：数据库数据源节点，必须配置路径或连接。

二、连线语义
1. flow（流程线）：执行顺序与父子调度关系；可挂 condition 条件分支（{type:'pass'} / {type:'fail'}，text 型判断用 {type:'content', label}）；
2. ctx（上下文线）：上游产出沿流程线自动注入下游，不需要连线；该通道现仅用于 file 数据源节点注入文本内容或受管文件路径索引；角色节点的 ctx-out 已停用；
3. db（数据库线）：数据库数据源 → 角色节点的数据库入点。

三、连接点矩阵（每类节点只有这些接入点；连错会被结构校验整批拦下）
1. start：无入点，出点 flow-out（模式二的输入节点另有 ctx-out）；
2. end：入点 flow-in（模式二另有 ctx-in），无出点；
3. pause：入点 flow-in，出点 flow-out——两端都必须接，否则报「暂停节点悬空」；
4. agent / parent / proxy：入点 flow-in / ctx-in / db-in，出点 flow-out / ctx-out（ctx-out 已停用，产出改由自动注入下发；ctx-in 仅供 file 数据源注入）；
5. file：无入点，出点 ctx-out（只能作上下文来源，不能作流程线或数据库线的目标）；
6. database：无入点，出点 db-out——database 之间不能互连，db 线只能指向角色节点；
7. group：入点 flow-in，出点 flow-out（Team 卡片没有 ctx/db 接入点；组内成员不连流程线）。

四、Team 卡片与虚拟节点的选择判据
- 需要多个角色**互相通信、交叉验证**（如多视角评审）→ 用 Team（group）：Team 卡片串在流程上标出团队的执行位置，成员节点逐个启动，启动顺序由父代理按实际需要决定。
- 需要**复用同一个角色实例与它已有的上下文**（同一角色在流程里再次出场）→ 用 proxy 指向该角色节点。

五、条件分支与数据节点的硬规则
- 同一源节点同一流程出上的条件线必须**成对**：有「通过」（type:'pass'）就必须有「不通过」（type:'fail'）。
- 流程必须保持无环 DAG：返工不得回指上游节点，要改成「前向 fail 分支 → 修复节点（可使用 proxy） → 在下游重新汇合」。
- 数据节点配置：写图产出的 file 节点**只有文本型**（内容可空，占位亦可——用于描述未来要产出的交付文件）；database 节点必须配本地路径或连接信息，否则规划期即阻断（运行期必然失败）。

六、提交前自检（命中即整批补丁原子失败，动手前先逐条自查）
- 全图恰好 1 个 start、1 个 end；parent 节点最多 1 个；阶段节点 label 固定为「启动 / 结束 / 暂停」，不可自定义；
- Team 成员只走 ctx/db 连线，**不得有流程线**；成员节点的 groupId 与 Team 卡片的 memberIds 必须双向一致；Team 卡片不可作为调度目标（对它调用 wf_run_node 会被拒绝）；
- 主节点与其虚拟节点不得连入**同一目标的同一连接点**（proxy 复用极易踩中：改到不同目标汇合）；
- 条件线只能 flow-out → flow-in；content 型条件必须带 label；
- 模式一：start 不用 ctx-out、end 不用 ctx-in；pause 节点仅模式一可用。
```

`ORG_SOP_DESIGN_METHOD`：

```
设计方法（按顺序想清楚三件事，再动手写补丁）：

第一步：列交付物清单。每组交付物对应一个可执行节点；一个节点只承担一件可独立验收的交付任务。
  合并判据：两件事无法分别验收、或拆开后下游拿不到额外信息，就合并成一个节点。

第二步：为每份交付物写明落盘路径与消费方。
  大产物（成稿、报告、文件等）一律要求节点写入工作区文件；节点交接只传「结论 + 产出文件路径 + 关键决策 + 未决问题」。
  上游产出会沿流程线**自动注入**它的每一个流程下游，因此不需要为交接建 ctx 连线。
  终端产出（没有任何流程下游）不必额外连线，也不要给它加评审节点。

第三步：判定并行与规模。
  只有「不同时修改同一批文件、且互不依赖」的任务才并行；否则串行。
  并行要有独立价值：拆成两个子代理的总成本 = 两次子代理开销 + 一次上下文交接，收益不明显就合并。

节点配置：每个 agent 节点至少要有 label、systemPrompt（该子代理角色定义、任务说明、执行规范）、presetId（工具组合，来自 wf_org_catalog 的 combos）。
  presetId 为空 = 这个节点运行时没有任何工具，是无效节点；provider/model 从 wf_org_catalog 的 models 里选。
```

### A9 `org-budget.ts`

```
本次组织预算：
- 可执行节点 {used}/{max}（剩余 {remaining}）              ← max=0 显示「不限」
- Team {used}/{max}（剩余 {remaining}）；组内人数上限 {membersMax}   ← groupMax=0 时第二字段为「不限」
- 单轮改图幅度上限 {patchOpsMax} op（剩余 {remaining}）
- 单列并行分支上限 {parallelBranchMax}                     ← 仅 >0 时
- 禁用拓扑：{forbiddenShapes.join(' / ')} ／ 无
- 命名约定：{namingConvention}                            ← 仅非空
```

### A10 `orchestration-change.ts`

```
【编排变更】画布已更新（系统通知），请用 wf_org_catalog（ids: ["instance"]）重新召回当前实例骨架后再继续调度。
```

---

## 3. B 组正文（prompts 目录之外的硬编码模型可见文本）

### B1 `graph-op-contract.ts`（英文，`wf_org_catalog.rules.patchContract` 唯一事实源）

```
Submission rules:
1. A patch is atomic: if any op fails nothing is persisted, and the reply lists every failure in order with its own error code - fix them all and resubmit the whole patch;
2. Ops apply in array order: create nodes first, then connect, within the same patch;
3. Node coordinates are not accepted: position is pure view data and the canvas lays out new nodes automatically;
4. One patch is limited to 200 ops; split larger changes into batches;
5. scope=template changes a workflow template (planning time), scope=instance changes an instance (run time); a scope that does not match the real target type is rejected;
6. Create a new template with create (only with scope=template); it is mutually exclusive with expectRevision; passing an existing targetId never overwrites - it is rejected;
7. expectRevision is an optimistic lock: a mismatch is rejected without retry - resubmit against the latest topology;
8. Meta parameters (the organization budget, e.g. nodeMax) are hard guards on graph editing and belong to no op; an argument such as set_meta is rejected as an unknown op.

Graph op shapes: create_node {op:'create_node', node:{kind:'agent'|'parent'|'start'|'end'|'pause'|'group'|'proxy'|'file'|'database', id?:string, data?:{...}}} (node fields must live inside node, never flattened onto the op); remove_node …; update_node_data …; connect …（端点字段名为 source/target，省略 handle 时按 flow-out -> flow-in 补全）; disconnect …; create_group …; set_group_members …（memberIds 必填）

data fields of a role node (kind='agent'|'parent'): label (required…); systemPrompt (required, the complete role and task description for that child agent - not a one-line title); presetId (required, …empty means that node runs with zero tools); provider + model (…); reasoning? / inputSchema? / outputSchema? (…downstream nodes receive the upstream output automatically, no ctx edge needed…); Canvas-owned fields (retryLimit / reactLimit / promptFilePath / injectSystemPrompt / injectToolSections / sourceAssetId) are not configurable here.

Error-code semantics:
- WF_BAD_ARGS: argument shape / value / size is wrong …
- WF_GRAPH_INVALID: graph semantics are wrong …
- 批次级取码规则：全参数层错误 → WF_BAD_ARGS；含任一语义错误 → WF_GRAPH_INVALID
- WF_PATCH_CONFLICT / WF_ORG_NOT_FOUND / WF_SCOPE_INVALID / WF_NOT_ROOT: …
```

### B2 `graph-facts.ts`

```
已连接数据库节点：{id (label); …}。只可通过 wf_db_query 访问：mode "search"（向量检索）、mode "query"（只读 SELECT，带 LIMIT）、mode "schema"（表结构）；禁止直接读取数据库文件。
```
（无 db-in 连线时整段不注入。）

### B3 `ask-protocol.ts`

`buildAskText`（投递给目标成员）：

```
[协作通信] 同工作流节点子代理「{fromNodeId}」（会话 {from}）向你发送协作消息（askId: {askId}）：
{message}

请仅当你确有明确答复时回复：调用 wf_ask_agent({ cmd: "reply", targetChildId: "{fromNodeId}", askId: "{askId}", message: "<你的回复文本>" })。
对方不会阻塞等待你的回复：回复将作为新消息投递到对方会话。
```

`buildReplyText`（回投给发起者）：

```
[协作通信回复] 节点子代理「{toNodeId}」（会话 {to}）回复了你发起且 askId 为 {askId} 的协作消息：
{reply}
```

### B4 `guards.ts`

```
REACT_CAP_MESSAGE = 'You have reached the ReAct iteration limit for this turn. Stop calling tools now and emit your final conclusion based on the progress made so far.'
REACT_CAP_DENY_REASON = 'ReAct iteration limit reached — conclude this turn with your final output now.'
```

### B5 `runner.ts`（兜底，正常路径不出现）

```
你是 Visual Workflow 工作流中的节点子代理。
节点名称：{label}
具体任务将随后续消息派发；请按收到的任务要求执行并汇报结论。
```

### B6 `client/i18n.ts`（内置父代理角色提示词，播种初值）

```
（中）你是工作流编排的父代理，仅负责调度子代理、判断流程走向，不执行节点任务。
（英）You are the parent agent of a workflow: you only schedule sub-agents and decide the flow direction, and never execute node tasks yourself.
```
写入点：`useStudioBoot.ts` 首次启动时，若库中无父代理角色模板则播种进资产库（此后以库中用户数据为准）。

---

## 4. C 组：工具常驻可见面（清单，不誊写全文）

| 工具 | description 定位 | 语言 | 复核状态（见 `docs/tool-context-review-backlog.md`） |
|---|---|---|---|
| `wf_run_node` | 异步启动 agent 节点；Team 成员走官方 teammate 路径；暂停/停止/中断运行会先恢复；暂停节点 id 触发暂停门 | 英文 | 待复核（backlog §3 顺序 5） |
| `wf_run_node_wait` | 模式二阻塞启动 | 英文 | 待复核 |
| `wf_finish` | 收尾一次；已完成运行幂等 | 英文 | 待复核 |
| `wf_ask` | 向用户提问并等待 | 英文 | 待复核 |
| `wf_ask_agent` | 降级通道成员通信（ask 不等待 / reply 反投；官方 Team 生效时改用 send_message） | 英文 | 待复核 |
| `wf_db_query` | 三模式；首次 search 建索引；父子可用性与 db-in 前提 | 英文 | ✅ 已复核修复（§4） |
| `wf_org_catalog` | 只读勘察；索引 vs 详情；`rules.patchContract` 指针；presetId 强制；骨架省略 systemPrompt | 英文 | ✅ 已复核（§2） |
| `wf_graph_patch` | 打补丁；新建模板需完整图；op 形状读契约 | 英文 | ✅ 已复核（§5） |
| `wf_experience_learn` | 提交候选 / 空数组取生成 Prompt；九字段 | 英文 | ✅ 已复核（§6） |
| `wf_experience_recall` | 两阶段召回；用后须 feedback | 英文 | ✅ 已复核（§7） |
| `wf_experience_feedback` | 四维评价；锚点表由 `experience/anchor-definitions.ts` 渲染 | 英文 | ✅ 已复核（§8） |

补充：经验评价锚点表（四维 × 五级行为定义，约 449 tokens）属**规则**性质，硬编码正确（评分唯一判据），但它是"经验体系"的用户可见契约，需你确认是否纳入本轮"提示词体系"改造范围。

---

## 5. 按新边界的归类与错位判定

| 条目 | 初判归属 | 依据 | 错位 / 风险 |
|---|---|---|---|
| A1 段落锚点 | 结构 | 与内容无关 | 无 |
| A2 语言规则 | 规则 | 插件治理边界，跨角色稳定、用户不可调 | 无 |
| A3-A 首段 2/3/5（结算通知信号、wf_finish 幂等、条件分支判断） | **规则** | 插件功能事实（完成信号、终态协议、条件线语义） | 与「职责」同段混排，边界不清 |
| A3-A 首段 1（仅编排 / 执行+编排）、4（失败处置与升级用户） | **职责** | 岗位职责与决策权限（升级链路＝先尝试重试→询问用户→终止） | **硬编码在规则文件**；且无五维结构（缺职责范围/行为规范/交接契约） |
| A3-A 中段（拓扑召回入口、Team 通道与启动方式） | **规则** | 插件功能定义（召回口径、官方/降级通道） | 无 |
| A3-A 末段动态（断点/暂停/运行参数/用户问题） | 任务/事实 | 随 run 变化 | 无（动态值位置正确） |
| A4 `buildParentTaskSpec` | **任务** | 为父代理执行单元分配本次执行内容 | 只有过程性上下文，**缺执行路径 / 交付内容 / 执行方式 / 验收标准** |
| A4 `EXECUTOR_FINISH_RULE` | **规则** | run 终态依赖 wf_finish | 无 |
| A4 首段第 2 条「严格按照规范执行本节点」 | — | 无指向、无信息量 | **疑似无效文本**（"规范"无指代对象） |
| A5 任务块 | **任务** | 每节点每 run 生成 | 结构性缺项：无「执行路径 / 交付内容 / 验收标准」字段，任务信息全靠节点 label + 上下游产出 + outputSchema 兜 |
| A5 语言规则条、协作通道条 | **规则** | 插件治理边界 | 混在任务块首段（双位重申已按设计执行） |
| A5 输入/输出契约 | 任务（交接契约） | 用户为节点配置的交接要求 | 无 |
| A6 协作块 | **规则 + 交接契约** | 通道与寻址是插件定义；成员清单是协作约定 | official 分支无调用方（备用代码） |
| A7 首段 1/2/4 | **规则** | 工具语法、D-11 不投产、工具开关降级 | 无 |
| A7 首段 3（先取规则再动手） | **规则**（流程口径） | 不调 Catalog 就拿不到图语义 | 与中段 `ORG_RULES_SOURCE_NOTE` 重复同一指引 |
| A7 身份行 | **职责** | 岗位声明（组织规划师） | 无五维结构；硬编码 |
| A7 `PRE_SUBMIT_CHECKLIST` | **任务/方法论** | 规划产出的验收标准 | 与 A8 设计方法重复维护（两处可漂移）；放在规则文件里 |
| A7 `dynamic.userSop` | 任务输入（用户可调） | 用户 SOP 注入点 | **至今无调用方**（TODO 未落地） |
| A8 L1 图语义 | **规则** ✅ | 本插件自定义语义，训练数据推不出 | 第 5 条「父代理…通常执行规划型任务」属职责/方法论混入；语言与同返回体英文契约中英混排 |
| A8 设计方法 | **方法论/任务** | 交付物→落盘→并行的设计链路 | 硬编码在规则常量里，且与 A7 自检重复（backlog §2.1 亦标为"与工具调用无关"） |
| A9 预算段 | **规则 + 动态事实** | 组织预算是图编辑硬护栏 | 无 |
| A10 变更通知 | **规则** | 通知协议 | 无 |
| B1 写图契约 | **规则** ✅ | 插件专属，模型猜不出 | 第 4 条的 `200` 与实现常量 `PATCH_OPS_HARD_LIMIT = 200` **不同源** |
| B2 DB 说明 | **规则** ✅ | 插件功能定义 | 无 |
| B3 协作消息文本 | **规则 + 交接契约** | 通道协议与回复指令 | 无 |
| B4 软截停 | **规则** ✅ | 插件护栏 | 无 |
| B5 兜底 prompt | **任务** | 分配执行内容 | 硬编码在代码（防御性，可接受但需明确归属） |
| B6 父代理内置角色提示词 | **职责** ⚠️ | 岗位声明 | 硬编码在 client 作播种初值；与「职责提示词应入库、可版本化、不硬编码、用户可调」存在张力；且只有一句话，不含五维 |
| C 工具常驻面 | **规则** ✅ | 工具契约 | `wf_run_node*` / `wf_db_query` 的 `nodeId` 描述仍写 "from the flow definition file (nodes[].id)"，**与本插件"拓扑只能经 wf_org_catalog 召回、不得读文件"的最新架构不一致** |

---

## 6. 硬编码中混入「职责 / 任务」提示词的清单（用户重点）

| # | 位置 | 混入内容 | 类型 | 说明 |
|---|---|---|---|---|
| 1 | `src/host/prompts/orchestration.ts` `ORCH_HARD_CONSTRAINTS.dispatchOnly` / `executorRole` / `failureSemantics` | 父代理岗位职责与失败处置升级链路 | 职责 | 硬编码在规则构建器；无五维结构、不可用户调整、无版本 |
| 2 | `src/host/prompts/orchestration.ts` 首段身份行 | 「你是…编排父代理」 | 职责 | 同上 |
| 3 | `src/host/prompts/executor.ts` `buildParentExecutorPrompt` 首段 | 父代理执行单元身份 +「严格按照规范执行本节点」 | 职责 + 无效占位 | 硬编码；第 2 条无信息量 |
| 4 | `src/host/prompts/executor.ts` `buildParentTaskSpec` | 父代理本次执行单元任务 | **任务** | 硬编码模板（事实注入正确，但模板本身固化在代码） |
| 5 | `src/host/prompts/org-plan.ts` 身份行 + 自检清单 | 「组织规划师」岗位 + 规划验收标准 | 职责 + 任务 | 硬编码；自检与 A8 重复 |
| 6 | `src/host/agent/runner.ts` `fallbackPrompt` | 子代理兜底任务文本 | **任务** | 硬编码兜底 |
| 7 | `src/client/i18n.ts` `builtinParentPrompt` | 父代理内置职责 | **职责** | 硬编码且播种入库；用户改后即以库为准 |
| 8 | `src/host/prompts/node-task.ts` 模板骨架（身份行「你正在执行节点「X」」+ 输入/输出契约小节标题） | 任务模板 | **任务** | 任务模板本身硬编码；内容由用户数据与图事实填充 |

> 结论：**当前不存在"职责提示词层"这一独立承载**。父代理职责分散在（编排提示词首段 + client 内置播种 + parent 节点 systemPrompt），子代理职责完全依赖用户逐节点填写的 systemPrompt（内置默认值为空串），并与其任务文本混在同一段。任务提示词也没有独立的生成器（A4/A5 是"事实装配器"，不是按四要素生成任务的生成器）。

---

## 7. 与最新架构不一致 / 待核实点

1. `src/host/prompts/README.md` 称「三个构建器」，实际已有 orchestration / executor / node-task / collab / org-plan / org-budget / prompt-rules / markers 共 8 个文件；检查单落地表未覆盖 executor 与 org-plan 变体——**文案基线文档滞后**。
2. `src/host/prompts/node-task.ts` 文件头注释写「中段 = 系统语言规则 + 过程性信息」，实现中语言规则在**首段**、中段无语言规则——**注释与实现漂移**。
3. `graph-op-contract.ts` 的 `One patch is limited to 200 ops` 与 `wf-graph-patch/tool.ts` 的 `PATCH_OPS_HARD_LIMIT = 200` 各自维护同一数值（另有元参数 `patchOpsMax`），**规则提示词与实现不同源**。
4. `wf_run_node` / `wf_run_node_wait` / `wf_db_query` 的 `nodeId` 参数描述仍以 "from the flow definition file (nodes[].id)" 表述——与「拓扑只能经 `wf_org_catalog` 的 instance 通道召回、不得读文件」的现行架构**不一致**（`wf_ask_agent`、`wf_org_catalog` 等已改为"节点 id"表述）。
5. `ORG_HARD_CONSTRAINTS.nodeSettledSignal` 引用官方结算通知字面文案「Background subagent … finished …」：规则提示词依赖外部框架文案，需实测取证当前 DSH 版本的实际文案（本轮未取证，官方包为 asar 归档）。
6. `org-plan.ts` 的 `dynamic.userSop`（L3 用户 SOP 注入点）**无任何调用方**；`prompts/index.ts` / `org-sop.ts` / backlog 均记其为未落地的技术债。
7. `collab.ts` 的 official 分支保留但无调用方（注释自述为备用模板）——属规则提示词中的死分支。
8. `docs/tool-context-review-backlog.md` §2.1 中「`graphSemantics` 提到组员之间用 wf_ask_agent 互相发消息已过时」一条：现行 L1 文本已无该工具名（只说"互相通信"），**该 backlog 条目本身已滞后**，复核时需更新。
9. 语言口径分裂：同一次 `wf_org_catalog` 索引返回中，`graphSemantics` / `designMethod` 为中文，`patchContract` 为英文；工具 description 全英文；而编排/任务提示词全中文。新边界体系需定一种口径（见 §8 问题 2）。
10. `PRE_SUBMIT_CHECKLIST`（org-plan）与 `ORG_SOP_DESIGN_METHOD`（org-sop）在"交付物 / 落盘路径与消费方 / 节点配置"三点上**双份维护**，任一处修改都会漂移。

---

## 8. 待用户定案的歧义问题

1. **交付形态**：本轮是否要我把三类提示词拆成独立物理承载（例如 `prompts/roles/`、`prompts/tasks/`、`prompts/rules/`），还是只在既有文件内做"段级边界"改造？
2. **语言口径**：规则提示词统一为中文、统一为英文，还是按"常驻可见面英文 / 注入提示词中文"维持双轨？（现行混排点见 §7.9）
3. **职责提示词入库方式**：复用既有 role-assets（版本化 + Active 指针）承载"职责提示词"，还是新建独立表（例如 `role_duty_prompts`）？父代理职责是否也纳入资产库（对应 B6 的播种逻辑要改）？
4. **五维结构的落地范围**：用户已给五维书写规范，是否要求**每个**角色的职责提示词都含五维（含内置父代理、内置子代理岗位模板）？若职责提示词由用户自行书写，规范是"父代理修改角色提示词时的约束"（提示词内约束）还是"系统校验"（结构校验）？
5. **B6 内置父代理提示词**：保留为"首次播种初值"（用户可改）还是从代码移除、改为资产库预置数据？子代理是否也需要内置岗位职责模板（现状为空串）？
6. **任务提示词生成器**：是否新增"按四要素（执行路径 / 交付内容 / 执行方式 / 验收标准）生成任务"的父代理提示词与结构（现状 A4/A5 只是事实装配器）？任务的"验收标准"来源是节点 outputSchema，还是新增字段？
7. **规则提示词的边界**：工具 description / 参数说明 / 输出 schema 说明是否纳入本轮统一治理？经验评价锚点表（anchor glossary）是否算规则提示词（保留硬编码）？
8. **A8 设计方法归属**：「交付物→落盘→并行」这条设计链路按新边界属方法论/任务侧，是否要移出 `org-sop.ts`（规则段），改由规划提示词（任务侧）承载？若移出，`wf_org_catalog` 索引返回的 `rules.designMethod` 字段是否保留？
9. **既有缺陷是否随本轮一起修**：§7 的 10 条（尤其 3/4 的不一致与 2/10 的重复维护），是"本轮一并修"还是"只作为边界改造的输入、单独排期"？
10. **验证口径**：提示词改编后，测试仍只允许断言"导出常量与段落锚点"（`prompts/AGENTS.md` 现行规则）吗？若对文本新增结构门禁（如"职责段必须含五维小节标题"），是否允许断言小节标题这一结构事实？

---

## 9. 本轮未做的事

- 未修改任何 `src/` 代码，未运行测试（纯分析稿；按 `AGENTS.md`，纯文档改动无需 typecheck/test）。
- 未整理用户数据中的提示词（节点/资产 systemPrompt、Team collabPrompt）与经验生成提示词（`experience-seeds.ts`）。
- 未实测取证官方运行时文案（`Background subagent … finished …`），该包为 asar 归档。
