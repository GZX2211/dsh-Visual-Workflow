# 提示词边界重新分析（按用户 2026-10-16 修正口径）

> 本文档**取代** [prompt-inventory_2026_10_15.md](./prompt-inventory_2026_10_15.md) 的 §5–§8（归类判定与待定案问题）；
> 该文档的 §1–§4（提示词清单与逐字正文）仍然有效，本文不再重复誊写。
> 本轮仍**未修改任何 `src/` 代码**。

---

## 0. 修正后的判定口径（用户定案）

| 概念 | 定义 | 呈现位置（硬约束） | 判定方法 |
|---|---|---|---|
| **职责提示词** | 角色的 system prompt：父代理＝其编排提示词；子代理＝其岗位提示词 | **只能存在于 system prompt**（当前注入机制即 `visual-workflow:prompt` 段，`bindParent` / `childSetup`） | 跨角色差异、跨任务稳定；应版本化、入库、用户可调 |
| **任务提示词** | 父代理进入实际流程、执行到某一节点时，**经 Send Message 工具向子代理发送的任务指令** | 可经 followup 用户消息 / 消息投递（**不得**出现在 system prompt） | 随项目与状态即时生成；含执行路径 / 交付内容 / 执行方式 / 验收标准；自包含 |
| **规则提示词** | 插件自身功能所定义的专属规则事实 | 经**工具调用注入**为主（或 followup） | **把这段提示词删除，是否影响插件运行？是→规则；否→不是规则** |

两条必须同时遵守的补充口径：

1. **工具常驻可见文本（description / parameters / output.schema）不属于规则提示词**——它们另有治理体系
   （[model-facing-surface-rules.md](./model-facing-surface-rules.md)）。规则提示词是"通过调用工具**注入**"的内容（例如
   `wf_org_catalog` 返回的 `rules.*`），不是常驻面。
2. 三类提示词**不要求**在代码里做成三个模块/三套存储；组装方式自由，**只有"边界"与"呈现位置"是约束**。

---

## 1. 现状与目标形态的结构性差距（本轮核心结论）

### 结论 1：父代理的职责提示词目前走的是 followup 用户消息（位置违规）

`src/host/prompts/orchestration.ts` 组装的编排指令（情况1/2）与 `executor.ts`（情况3）整份经
`runtime-launch.ts` 的 `followupRoot` 注入**用户消息**，其中包含明确属于"职责"的内容：
身份行「你是…编排父代理」、「仅编排 / 执行+编排」、「绝不静默跳过失败节点；可重试一次，若仍失败则询问用户；
若编排失控或确认无法继续，即终止运行」。

按新口径：**职责提示词只能存在于 system prompt**。父代理当前确实有一个 system prompt 通道
（parent 节点的 `systemPrompt` → `bindParentConfig` → `visual-workflow:prompt` 段），但它承载的是
parent 节点上的用户文本（默认仅 [i18n.ts:25](../src/client/i18n.ts#L25) 播种的一句），与运行时真正生效的
编排职责文案（在 followup 里）**是两份东西**。

### 结论 2：任务提示词目前没有"父代理生成"的生产者

用户口径：任务提示词＝父代理执行到某节点时经 Send Message 下发的指令。

代码事实：

- `wf_run_node` / `wf_run_node_wait` 的参数只有 `nodeId / thinking / iterationLimit / retryLimit`——
  **没有任务文本参数**，父代理无法在启动时传入任务；
- 节点收到的"任务"完全由 [task-blocks.ts](../src/host/orchestrator/task-blocks.ts) 的 `buildNodeBlocks`
  从**图配置 + 运行快照**机械组装（`runtime-execute.ts:154`），再经 `startNodeTask` 投递：
  首轮作为创建 prompt（[runner.ts:775](../src/host/agent/runner.ts#L775)），复用轮经
  `deliverReuse` → 官方 `sendMessage`（[runner.ts:646](../src/host/agent/runner.ts#L646)），
  Team 成员路径同源（[member-launcher.ts:197](../src/host/agent/member-launcher.ts#L197) /
  [:222](../src/host/agent/member-launcher.ts#L222)）；
- 父代理**没有**可直接使用的"向子代理发任务"通道：`wf_ask_agent` 明确只允许子代理发起
  （`WF_NOT_CHILD`，[runtime-comm.ts:116](../src/host/orchestrator/runtime-comm.ts#L116)）；
  官方 `send_message` 仅在官方 Agent Team 可用（official 通道）时才在父代理工具面上，
  且当前流程不要求父代理使用它（每次 `wf_run_node` 都自动投递图投影文本）。

⇒ 即：**同一条 `blocks` 既是"父代理启动节点的投递物"，也是"用户在图上编辑的节点说明投影"**，
它既不是父代理生成的任务，也不承载"执行路径 / 交付内容 / 执行方式 / 验收标准"四要素。
这正是你说的"当前代码中组装的任务提示词是用于用户在图中进行编辑的，而不是针对父代理生成的"。

### 结论 3：节点上的输入/输出契约与"交接契约"归属未定

`inputSchema` / `outputSchema`（节点配置，用户在图里编辑）目前注入在**任务消息**中
（`buildNodeTaskBlock` 的「输入契约 / 输出契约」小节）。而按你的职责五维定义，"交接契约（主体之间需要交换的
结果、信息与协作约定，含插件本身的输入输出契约）"是**职责提示词**的第五维。
⇒ 现状位置与目标归属冲突，需你定案（见 §4 问题 5）。

### 结论 4：职责提示词的书写规范目前完全缺失

- 节点 `systemPrompt` 在 UI 上是自由文本（[role-form.tsx](../src/client/components/panels/inspector/role-form.tsx)），
  新建子代理默认值为空串（[useTemplates.ts:30](../src/client/hooks/useTemplates.ts#L30)）；
- 父代理经 `wf_graph_patch` 写角色节点数据时，`ROLE_NODE_DATA_CONTRACT` 只要求
  `systemPrompt (required, the complete role and task description for that child agent - not a one-line title)`——
  **没有任何"五维"或"职责 / 任务分离"的约束**；
- 也就是说：五维规范现在既没有写进任何提示词，也没有作为校验存在（与你说的一致）。

### 结论 5：规则段里混着"删除后不影响插件运行"的内容

按"删除后是否影响插件运行"这一条尺子，以下内容**不是规则提示词**，却位于规则注入位置
（`wf_org_catalog` 的 `rules` 段 / 规划提示词硬约束段）：

- `ORG_SOP_DESIGN_METHOD`（交付物→落盘路径→并行判定→节点配置）整段：删除后图仍能写出；
- `ORG_SOP_L1_GRAPH_SEMANTICS` 第四节「Team 与虚拟节点的选择判据」：设计选择方法论；
- `ORG_SOP_L1_GRAPH_SEMANTICS` 第一节第 5 条里「既是调度中枢也是执行单元…通常执行规划型任务」：职责描述；
- `org-plan.ts` 的 `PRE_SUBMIT_CHECKLIST`（提交前自检）：规划产出的质量清单；
- `A2` 系统语言规则（见 §2 判定表，需你定案）。

---

## 2. 逐条重新判定（按"删除是否影响插件运行"）

图例：**规则**＝删除后影响插件运行；**职责**＝角色 system prompt 内容；**任务**＝父代理下发的阶段任务；
**事实**＝运行态数据（非提示词类别）；**结构**＝注入形态约定；"—"＝按新标准不构成提示词。

| # | 条目（位置） | 删除后的后果 | 判定 | 现呈现位置 | 位置是否合规 |
|---|---|---|---|---|---|
| 1 | 段落锚点 `markers.ts` | 组装契约失效（测试/缓存前提） | 结构 | 构建器 | ✅（非内容） |
| 2 | 系统语言规则 `prompt-rules.ts` | 插件仍正常运行；仅语言不符用户设置 | **存疑** | 各构建器首/末段 | ⚠️ 见问题 2 |
| 3 | 身份行「你是…编排父代理」`orchestration.ts` | 不影响运行 | **职责** | followup 用户消息 | ❌ 应入 system prompt |
| 4 | `dispatchOnly` / `executorRole`（仅编排 / 执行+编排） | 不影响运行 | **职责** | followup 用户消息 | ❌ 应入 system prompt |
| 5 | `failureSemantics`（不静默跳过失败、重试一次、失败询问用户、失控终止） | 不影响运行 | **职责**（行为规范 + 决策权限 + 升级链路） | followup 用户消息 | ❌ 应入 system prompt；且升级链路需对齐"先报批父代理、父代理无法决策再升级用户"的新规范 |
| 6 | `nodeSettledSignal`（只有结算通知才算节点完成） | 父代理无法判定节点完成、无法推进下游 | **规则** | followup 首段 | ✅ |
| 7 | `finishIdempotent`（wf_finish 一次、幂等、释放锁） | run 无法进入终态、运行锁不释放 | **规则** | followup 首段 + 末段 | ✅ |
| 8 | `conditionSemantics`（条件分支语义判断） | 条件线无法正确推进 | **规则** | followup 首段 | ✅ |
| 9 | 拓扑召回入口（`wf_org_catalog` 的 instance 通道） | 父代理无从获取拓扑，无法调度 | **规则** | followup 中段 | ✅ |
| 10 | 工作流目标 `{workflowGoal}` | 不影响运行 | 事实 | followup 中段 | ✅ |
| 11 | Team 段（official/legacy 启动方式、官方任务板用法） | Team 成员无法正确启动/协作 | **规则** | followup 中段 | ✅ |
| 12 | 断点/暂停状态、用户问题 | 不影响（是状态事实） | 事实 | followup 末段 | ✅ |
| 13 | `runParamsText`（模式一 `wf_run_node` / 模式二 `wf_run_node_wait`） | 用错启动工具（模式二不可用） | **规则** | followup 末段 | ✅ |
| 14 | 组织预算段 `org-budget.ts` | 改图超限被拒、行为与护栏不一致 | **规则** | followup / 规划末段 | ✅ |
| 15 | `parentTaskBlock`（情况2 父代理自执行任务） | 不影响运行 | **任务** | followup 末段 | ✅（任务允许 followup） |
| 16 | `EXECUTOR_FINISH_RULE`（情况3 收尾） | 情况3 无终态、锁不释放 | **规则** | followup 首段 + 末段 | ✅ |
| 17 | `executor.ts` 身份行 +「严格按照规范执行本节点」 | 不影响运行（后者无指代） | **职责** + 无效文本 | followup 首段 | ❌ 应上移 / 删除空话 |
| 18 | `buildParentTaskSpec` 上下文（上游产出 / 文件索引 / db 说明 / 运行上下文） | 不影响运行（缺失则任务信息不全） | **任务** + 事实 + 规则(db) | followup 末段 | ✅ |
| 19 | 节点任务块身份行「你正在执行节点 X」 | 不影响运行 | **职责**（岗位定位） | 子代理首条用户消息 | ❌ 应入 system prompt（但内容极薄） |
| 20 | 节点任务块 协作通道约束（legacy） | 成员不会用 `wf_ask_agent`，协作失败 | **规则** | 子代理任务消息 | ✅ |
| 21 | 节点任务块 上游产出 / 文件路径 / db 说明 | 任务缺上下文 / 不会查库 | 事实 + **规则**(db) | 子代理任务消息 | ✅ |
| 22 | 节点任务块 输入/输出契约 | 不影响插件运行 | **交接契约（职责第五维）** 或任务 | 子代理任务消息 | ⚠️ 归属待定（问题 5） |
| 23 | 协作块 `collab.ts`（成员清单 + 寻址 + 通道） | 成员不知道协作对象与寻址方式 | **规则** | 任务消息末尾 | ✅（official 分支无调用方） |
| 24 | `org-plan.ts` 身份行（组织规划师） | 不影响运行 | **职责** | followup 用户消息 | ❌ 应入 system prompt |
| 25 | `org-plan.ts` grammar（create / update 语法） | 工具报错自纠可恢复 | **规则**（偏"怎么调用"契约） | followup 首段 | ✅（与工具常驻面互有重复） |
| 26 | `templateOnly`（规划不投产，D-11） | 工具层无此护栏；父代理不会自行投产（无该能力） | **规则**（流程语义） | followup 首段 | ✅ |
| 27 | `surveyFirst`（先取规则再动手） | 父代理按通用直觉编排（拿不到自定义语义） | **规则** | followup 首段（与中段重复） | ✅（重复待收敛） |
| 28 | `toolsMayBeClosed`（工具被关闭时提示用户开启） | 父代理干脆不用工具，流程无法进行 | **规则** | followup 首段 | ✅ |
| 29 | `ORG_RULES_SOURCE_NOTE`（中段规则来源） | 同 #27 | **规则** | followup 中段 | ✅（与 #27 重复） |
| 30 | `PRE_SUBMIT_CHECKLIST`（提交前自检） | 不影响运行 | **方法论 / 任务** | followup 末段 | ⚠️ 非规则内容在规则位置 |
| 31 | `dynamic.userSop` | 无调用方 | 任务输入（用户可调） | followup 末段 | ⚠️ 未落地 |
| 32 | L1 图语义：节点 kind / 连线语义 / 连接点矩阵 / 硬规则 / 提交前自检 | 写不出合法图，整批补丁失败 | **规则** | `wf_org_catalog.rules.graphSemantics` | ✅ |
| 33 | L1 第四节 Team / proxy 选择判据 | 设计质量下降，图仍可写 | **非规则**（方法论） | 同上（混在规则段） | ⚠️ 应移出 |
| 34 | L1 第一节 parent 条「通常执行规划型任务」 | 不影响运行 | **职责**（混入规则段） | 同上 | ⚠️ 应移出 |
| 35 | `ORG_SOP_DESIGN_METHOD` 整段 | 不影响运行 | **非规则**（方法论） | `rules.designMethod` | ⚠️ 应移出（问题 3） |
| 36 | 图设计方法里的「节点配置：label / systemPrompt / presetId」 | 空 presetId 会产出零工具无效节点 | **规则**（其中 presetId 部分） | 同上 | ⚠️ 需拆分：规则部分留、方法论移出 |
| 37 | 编排变更通知 `orchestration-change.ts` | 父代理用过期拓扑继续调度 | **规则** | followup / steer | ✅ |
| 38 | `patchContract`（`graph-op-contract.ts`） | 无法正确调用 `wf_graph_patch` | **规则** | `wf_org_catalog` 返回（工具注入） | ✅ |
| 39 | `dbToolHint`（三模式 + dataId） | 子代理无法查询数据库 | **规则** | 任务消息中段（工具注入路径） | ✅ |
| 40 | `ask-protocol` 协作消息文本（askId / 回复指令 / 回执） | 成员无法回复，协作断链 | **规则** | 消息投递 | ✅ |
| 41 | `guards.ts` 软截停指令 + 拒绝原因 | 到迭代上限后仍尝试调用工具（guard 仍在，收尾质量下降） | **规则** | pre-step 替换消息 / guard | ✅ |
| 42 | `runner.ts` `fallbackPrompt` | 不影响运行（正常路径不触发） | **任务**（兜底） | 子代理首条消息 | ⚠️ 硬编码兜底 |
| 43 | `i18n.ts` `builtinParentPrompt`（播种） | 不影响运行 | **职责** | system prompt（入库播种初值） | ✅ 位置正确；⚠️ 硬编码 + 无五维 |
| 44 | 11 个 `wf_*` 工具的 description / parameters / output.schema | — | **不属于规则提示词**（常驻可见面，另行治理） | 常驻 | — |
| 45 | 经验评价锚点表（`anchor-definitions.ts`，渲染进 feedback 的 description） | — | **不属于规则提示词**（常驻面）；若按"影响运行"尺子则删除后评分退化 | 常驻 | — 需你确认口径适用（问题 8） |
| 46 | 经验生成提示词 `experience-seeds.ts` | — | **排除项** | 工具按需返回 | — |

---

## 3. 与最新架构不一致 / 待核实（沿用上轮结论，逐条复核）

| # | 位置 | 问题 | 状态 |
|---|---|---|---|
| 1 | [prompts/README.md](../src/host/prompts/README.md) | 仍称「三个构建器」（实际 8 个文件）；检查单未覆盖 executor / org-plan 变体 | 待更新 |
| 2 | [node-task.ts](../src/host/prompts/node-task.ts) 头注释 | 称「中段＝系统语言规则 + 过程性信息」，实现中语言规则在**首段** | 注释漂移 |
| 3 | [graph-op-contract.ts:62](../src/host/tools/infrastructure/graph-op-contract.ts#L62) vs [wf-graph-patch/tool.ts:157](../src/host/tools/wf-graph-patch/tool.ts#L157) | `200 ops` 规则文本与实现常量 `PATCH_OPS_HARD_LIMIT = 200` 不同源 | 待同源化 |
| 4 | `wf_run_node` / `wf_run_node_wait` / `wf_db_query` 的 `nodeId` 描述 | 仍写 "from the flow definition file (nodes[].id)"，与"拓扑只能经 `wf_org_catalog` 召回、不得读文件"矛盾 | 待改写（注：属常驻面治理） |
| 5 | `ORCH_HARD_CONSTRAINTS.nodeSettledSignal` | 依赖官方结算通知字面文案「Background subagent … finished …」 | 待实测取证（asar 归档，本轮未取证） |
| 6 | `org-plan.ts` `dynamic.userSop` | 无调用方（L3 用户 SOP 注入点未落地） | 技术债 |
| 7 | `collab.ts` official 分支 | 无调用方（备用模板） | 死分支 |
| 8 | [tool-context-review-backlog.md §2.1](./tool-context-review-backlog.md) | 「graphSemantics 提到组员之间用 wf_ask_agent 已过时」一条：现行 L1 已无该工具名 | backlog 自身滞后 |
| 9 | `PRE_SUBMIT_CHECKLIST` vs `ORG_SOP_DESIGN_METHOD` | 交付物 / 落盘路径与消费方 / 节点配置三点双份维护 | 待收敛（本轮归属改造会一并处理） |
| 10 | 语言口径 | 同一次 Catalog 索引返回中 `graphSemantics` 中文、`patchContract` 英文；提示词正文中文 | 待定案（问题 7） |

---

## 4. 待你定案的问题（执行任务的输入）

1. **父代理职责提示词的承载**：「父代理＝其编排提示词」是指 **parent 节点的 `systemPrompt`**（用户可编辑、随模板/资产版本化），还是插件注册的固定职责段？
   若为前者，现有编排提示词里的职责条款（#3/#4/#5）应**迁入 parent 节点 systemPrompt**，followup 只留规则 + 任务——是否按此定案？
2. **系统语言规则是否为规则提示词**：按"删除后不影响插件运行"它不算；但它是插件治理要求（跟随 DSH 用户设置）。算 / 不算？
3. **非规则内容移出**：#33（Team/proxy 判据）、#35（设计方法）、#30（规划自检）确认"不是规则提示词"并从规则注入位置移出吗？移出后由谁承载（父代理任务侧 / 方法论提示词）？`rules.designMethod` 字段是否保留？
4. **任务提示词的落地路径**：需要为父代理建立"下发任务"的通道吗？可选方案：
   （a）`wf_run_node` 增加任务参数（父代理在启动时给出任务文本）；
   （b）父代理用官方 `send_message` 在启动后补发任务（仅 official 通道可用）；
   （c）降级通道新增父代理侧投递工具（当前 `wf_ask_agent` 仅子代理可用）。
   目标形态是哪一种（或组合）？
5. **`inputSchema` / `outputSchema`（#22）归属**：按职责五维算"交接契约"（进 system prompt），还是随任务下发的任务组成？
6. **五维规范的落地方式**：写进父代理职责提示词（作为其改角色提示词时的约束）、写进 `wf_graph_patch` 返回的规则段（硬约束）、还是 UI 校验？
7. **规则提示词语言**：规则段统一中文、统一英文，还是维持现状（提示词中文 / 工具契约英文）？
8. **常驻面边界确认**：工具 description / schema（含经验评价锚点表）一律**不**纳入规则提示词改造范围，只按 `model-facing-surface-rules.md` 治理——确认吗？
9. **现有图投影任务块（`buildNodeBlocks`）的去留**：降级为"任务上下文 + 交接契约"，由父代理生成真正的任务指令？还是保留现有行为、只做边界标注？
10. **既有不一致（§3 的 1/2/3/5/6/7/9）**：本轮一并修，还是只改边界、缺陷另排期？
