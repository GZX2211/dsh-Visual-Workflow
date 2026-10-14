# 工具模型可见面 · 复核与重做清单

本清单记录**逐个工具复核**时发现的、需要在后期统一优化/重做的模型可见文本。

**判定口径（用户裁决，已收敛为一条可操作标准）**：

> **常驻在代理上下文中的工具描述与相关文本，必须是影响「这个工具被调用」的内容。**
> 判断方法：**把这段文字移除后，若不影响该工具被调用 —— 它就不应该常驻。**
> 「影响被调用」= 何时调用 / 怎么调用（参数形状与取值）/ 前置条件 / 失败语义与稳定错误码 / 副作用 / 可见性规则。
> 其余一律移出描述，改由其它形式承载（按需召回的契约段、方法论提示词段、运行期说明等）。

据此的细分：

- **与工具调用有关** → 保留。
- **与工具调用无关**（写图/规划方法论、内部实现说明、本来就传不进去的字段禁令、与实现重复的规则复述）→ 进本清单，后期统一优化或重做（其中不少内容已被后续实现取代而失效）。

> 复核进度见文末「已复核工具」表；每复核一个工具就在本文件追加一节。

---

## 1. 通则（跨工具，待统一处理）

| # | 事项 | 状态 |
|---|---|---|
| G1 | **画布所有字段的禁令句**（`retryLimit / reactLimit / promptFilePath / injectSystemPrompt / injectToolSections / sourceAssetId`）：`wf_org_catalog` 描述里的那句已删除（`e48e4bb`）；`ROLE_NODE_DATA_CONTRACT` 的**后果句已删除**（`cannot be configured through the graph tool: they are ignored when passed on create and preserved on update`），**字段枚举保留**为 `… are not configurable here.`——依据：该枚举在契约其它句零提及，整句删除即信息缺口，且「这些字段不归图工具管」属「怎么调用」而非冗余复述 | ✅ 已执行（保留枚举，偏差已备案） |
| G2 | `reports/audit/VERIFY-ROUND2.md:272` 曾以「模型被明确告知不要传」为依据判定某条不构成契约漏洞；若 G1 的第二句也删掉，该依据失效（`apply.ts` 的 `PARENT_UNCONFIGURABLE_ROLE_FIELDS` 行为不变，结论实质不受影响） | 已告知 Team |
| G3 | 同一事实两个错误码：`wf_db_query` 的 `WF_BAD_CALLER`（不可达死防御）与 `WF_BAD_ARGS`（入口守卫） | ✅ 已执行：删死防御，`WF_BAD_CALLER` 唯一码（见 §4.1） |
| G4 | **错误消息清点口径**：必须按「出口」找（`WfError` 构造点 + 所有封装构造函数如 `invalid(...)`），只扫字面量会漏（本轮已漏过 experience 域，见 §6.6） | 已写入治理规则 §3 |

---

## 2. `wf_org_catalog`

### 2.1 待重做：与工具调用无关（规划 / 写图方法论）

| 条目 | 位置 | 体量（≈tokens） | 语言 | 问题 | 处置建议 |
|---|---|---|---|---|---|
| `rules.designMethod`（设计方法三段式） | `src/host/prompts/org-sop.ts` → `ORG_SOP_DESIGN_METHOD` | 142 | **中文** | **纯规划方法论**：交付物清单 → 落盘路径与消费方 → 并行/规模判定。与工具调用无关；且其中的成本模型（"两次子代理开销 + 一次上下文交接"）与当前实现是否一致未再核对 | 重做：要么删除、要么下沉为「可选的规划指引」；同时确定语言（建议与工具描述统一为英文） |
| `rules.graphSemantics` 第四节「协作组与虚拟节点的选择判据」 | `ORG_SOP_L1_GRAPH_SEMANTICS` 第 52-55 行 | ~110 | **中文** | **何时用 group / 何时用 proxy** 属选择方法论；且其中「成员之间可互发消息」「组员之间用 wf_ask_agent 互相发消息」在官方 Agent Team 通道下**已过时**（`collab.ts` 按 channel 分派：official → `send_message`） | 重做：判据部分改为与 `collab.ts` 通道语义一致的措辞（或改为按通道动态生成） |
| `rules.graphSemantics` 第一节中第 5、6 条的语义描述 | 同上 第 32-33 行 | ~40 | **中文** | 「父代理既是调度中枢也是执行单元…通常执行规划型任务」「组员之间用 wf_ask_agent 互相发消息」= 实现说明 + 过时工具名 | 重做：只保留 kind 取值与硬规则（kind 枚举本身属写图必需），删掉方法论/过时工具名 |
| `rules.graphSemantics` 整体语言 | 同上 | 496（其中 CJK 997 字） | **中文** | 与同一返回体内英文的 `patchContract`/`gateMarking`、以及英文工具描述**中英混排**；每次 `omit ids` 调用全额灌入 | 重做时统一语言（建议英文），并考虑把「写图必需」与「方法论」拆成两段（方法论可按需召回而不是每次灌入） |
| 文件头注释里的 L3 注入点 | `org-sop.ts` 第 8-9 行（`dynamic.userSop`，org-plan.ts TODO） | — | — | **未落地**：规划变体入参至今无消费方 | 与技术债一起清理或补实现 |

### 2.2 保留：写图 / 工具调用契约（复核确认无问题）

| 条目 | 位置 | 为什么保留 |
|---|---|---|
| `idConvention`（三种 id 形状） | `types.ts` → `ID_CONVENTION` | 工具调用必需（`ids` 参数取值） |
| `detailHint`（两段式调用/召回指引） | `build.ts` → `DETAIL_HINT` | 工具调用必需（何时省略 ids、何时按 id 召回） |
| `rules.patchContract` 的**提交规则 / op 字段形状 / 角色节点 data 契约 / 错误码语义** | `graph-op-contract.ts` | 写图必需，且与 `wf_graph_patch` 共用同一常量（单一事实源）。**后续变更**：`outputSchema` 说明改为「输出契约（产出沿流程线自动注入下游，无需 ctx 连线）」，空值语义为「不配置契约」 |
| `rules.gateMarking`（闸门标记语义） | `graph-op-contract.ts` | 写图必需（`mark_node` 的时机/目标/预算）。**后续变更**：里程碑闸门机制整体退役，该规则段与槽位已删除 |
| `graphSemantics` 的**节点 kind 枚举、连线语义、连接点矩阵、条件线/DAG/数据节点硬规则、提交前自检** | `org-sop.ts` | 本插件自定义语义，模型猜不出，踩中即整批补丁原子失败。**后续变更**：节点交接改为沿流程线自动注入，手动 ctx 交接退役（角色 `ctx-out` 停用），连线语义与提交前自检已同步改写 |
| description 里的 `presetId` 强制、骨架省略 systemPrompt、`flow-*`/`role-*` id 形状 | `wf-org-catalog/tool.ts` | 工具调用/写图必需 |

### 2.3 本工具已完成的改动（复核期间）

| commit | 内容 |
|---|---|
| `e48e4bb` | 删除 description 里「Never pass retryLimit / …」整句（只读召回工具 schema 根本不接受这些字段）→ 常驻 335 → 301 tokens |
| 待提交 | `ids` 形状非法报错由中文改为 `WF_BAD_ARGS: ids must be an array of strings (omit it to get the asset index only) - received …`，与其他工具口径统一 |

### 2.4 复核发现的其它小缺陷（已知，暂不改）

| # | 发现 | 备注 |
|---|---|---|
| O1 | 描述里 `Skeletons omit role systemPrompts` 与 `Supported ids` 两处都提到 `<flow-id>#<node-id>`（轻微重复） | 低优先 |
| O2 | `DETAIL_HINT` 里 `["flow-xxx"]` 等示例用了 JSON 数组写法，而参数 `ids` 是字符串数组 | 低优先（不影响理解） |

---

## 3. 后续待复核工具（按顺序）

| 顺序 | 工具 | 状态 |
|---|---|---|
| 1 | `wf_db_query` | ✅ 已复核并修复（四项：双错误码、`truncated` 语义、SQLite 表数上限、实例定位判定 → 见 §4） |
| 2 | `wf_org_catalog` | 已复核（见 §2） |
| 3 | `wf_graph_patch` | 已复核（见 §5） |
| 4 | 经验三工具 | `wf_experience_learn` 已复核并整改（§6）；`wf_experience_recall` 已复核（§7）；`wf_experience_feedback` 已复核并整改（§8） |
| 5 | `wf_ask` / `wf_run_node` / `wf_run_node_wait` / `wf_finish` / `wf_ask_agent` | 待复核 |

---

## 4. `wf_db_query` 复核发现（补齐索引）

### 4.1 错误码重复（对应通则 G3）— ✅ 已修复

- 原 `tool.ts:84`：`WF_BAD_CALLER: cannot identify the caller session`（`resolveDataQueryContext` 内）
- 原 `tool.ts:168`：`WF_BAD_ARGS: cannot identify the caller session`（`execute` 入口守卫）

**可达性取证**：`resolveDataQueryContext` 为模块私有、全仓仅一处调用且在入口守卫之后，两者读同一个 `caller` 实参 ⇒ 第 84 行**必不可达**。
**处置**：删除该死防御；入口守卫（`ToolExecLike.agent` 可选，确实可达）改用 `WF_BAD_CALLER`，与 `wf_graph_patch` / `wf_org_catalog` 同码同文案。全仓已无 `WF_BAD_ARGS: cannot identify the caller session`；测试同时断言 `code` 与 message 含码。

### 4.2 其它 — ✅ 已修复（本轮）

- **`truncated` 语义补全**：clamp 本体上移到产出层单点（`src/host/embedding/indexer.ts` 导出 `SEARCH_TOP_K_MAX`，替换原 `Math.min(50, topK||5)` 字面量），`SearchResult` 增 `truncated`；判据为「请求超上限**且** hits 达上限」（精确）；通道降级沿用既有 `source` 字段，未新造语义。
- **`schema` 表数上限**：新增 `SCHEMA_TABLE_LIMIT = 200` 单一本体，SQLite / MySQL / PG 三通道共用；driver 内以 `LIMIT 上限+1` 探针实现**精确**判定（`schemaPage()`），`schema()` 对外形状不变（恒 ≤ 上限），消费方无需改动。
- **三处 `truncated` 口径统一**：query（行数 / 单元格）、search、schema 一律「被上限**真**截断才为 true」，不再有「正好满也报」的保守误报。
- **实例定位语义**：按常驻准入标准判定**不写进 description**——模型无参数可影响实例选择，「取最新实例」不改变它传什么、调不调；定位失败已有可行动稳定错误（`WF_DB_BAD_DATA` / `WF_NO_INSTANCE`）承载，属 §1.3「内部实现说明」。
- **`topK` 的 `max 50` 保留**（参数取值域，属 §1.2 准入），但数字改为与 `SEARCH_TOP_K_MAX` **同源插值**，并以同源断言锁定防漂移。

---

## 5. `wf_graph_patch` 复核发现

### 5.1 本轮已按「判断标准」从常驻描述中删除（commit 待记）

| 删除内容 | 删除理由 |
|---|---|
| `Field shapes and submission rules are not repeated here: read rules.patchContract and rules.gateMarking from wf_org_catalog before your first patch.` | 与 `ops` 参数描述里的同一指引重复（"read rules.patchContract from wf_org_catalog (omit ids)"）——同一指针写两遍不增加可调用性；删除后 `PATCH_CONTRACT_POINTER` 常量已无生产者，连同其测试断言一并删除 |
| `Keep the graph an acyclic DAG: model "review failed" as a forward branch (condition={type:"fail"}) into a repair node that rejoins downstream — back-edges are rejected with flowCycle.` | **写图规则而非工具调用规则**（用户裁决）：它教怎么建模返工，不回答"何时/怎么调用本工具"；规则本身仍保留在 `rules.patchContract` 与 `graphSemantics`（按需召回）——见 5.2 |
| `Never pass node positions: they are view-only, re-laid out by the canvas.` | 本来就传不进去的字段禁令（`apply` 写入哨兵坐标、画布布局）；不影响调用，属冗余指令 |

常驻面：**641 → 539 tokens**（desc 932→525 字符 / 142→84 词）。

### 5.2 描述精简的收尾 — ✅ 已执行（本轮 2026-10-11）

| 条目 | 处置 |
|---|---|
| `ops are grouped … one patch uses one group` | **删除**：`PATCH_SUBMISSION_RULES` 第 1 条逐概念等价承载 |
| `The patch is atomic … its own code` | **删除**：第 2 条是其**超集**（多出 in order / resubmit），且 `ops` 参数描述已含「one group」 |
| `mark group: mark_node completes the CURRENT milestone gate only (a proxy-driven gate with data.role=milestone)` | **部分删除**：删掉被契约承载的复述部分，**保留调用相位提示** `mark group: use mark_node only to complete the current gate of this turn.`——整仓无第二处定义「什么是闸门」，而「何时可用 mark group」属 §1.2 准入内容（**后续变更**：里程碑闸门机制整体退役，该相位提示与 `mark group` 已一并删除） |
| 新建模板的返回字段说明 | 删去 `newTemplate=true and the new targetId are returned` 半句（由 `output.schema` 承载），主句保留 |
| 批次级错误码选择规则 | **已补入** `ERROR_CODE_SEMANTICS`：`WF_BAD_ARGS` only when every failure is an argument-layer error, `WF_GRAPH_INVALID` as soon as any failure is a graph-semantics error。与实现（`tool.ts` 的 `errors.every(...)` 取码）核对**一致**，并有行为用例锁定 |

**结果**：`wf_graph_patch` description **525 → 243 字符（−53.7%）**、**84 → 42 词（−50%）**。

### 5.3 复核确认无问题

- 失败面：两类聚合错误都"一次列全 + 每条带 code 与修复建议"，稳定码已进文本（英文统一）；
- `warnings[]` 非阻断但显式（含 `fileNodeTextOnly` 归一化提示），不静默；
- `ops` 参数保留最小示例（`node` 包装与 `source/target` 端点名是历史高频错因）——**影响调用，保留正确**；
- `create` / `expectRevision` / `scope` / `targetId` 的参数说明都直接决定调用方式，全部保留。

---

## 6. `wf_experience_learn` 复核发现

### 6.1 常驻面（实测）

| 项 | 实测 |
|---|---|
| description | 2013 字符 / **298 词** ≈ 503 tokens |
| `parameters` | 2296 字符 ≈ 574 tokens（`experiences` 的 9 个字段说明 + 每字段预算注记、`type`） |
| 合计 | 4309 字符 ≈ **1077 tokens**（经验三工具中最大） |
| `output.schema` | 318 字符（native 不注入） |

### 6.2 运行时注入（空数组调用取"生成 Prompt"）

| 主体类型 | 正文位置 | 字符 / 行 | ≈tokens | 语言 |
|---|---|---|---|---|
| `agent` | `src/host/assets/experience-seeds.ts` → `EXPERIENCE_PROMPT_SEEDS[ep-agent-v1]` | 1681 / 128 | 420 | **中文**（CJK 1081） |
| `orchestrator` | 同上 `ep-orchestrator-v1` | 2369 / 195 | 592 | **中文**（CJK 1306） |
| 两份合计 | — | 4050 | 1012 | 中文 |

> 单次调用按主体类型只返回其中一份（agent→420 / orchestrator→592 tokens）。
> 播种条件为「该类型没有任何行」，已存在的行（含用户改写正文）不被覆盖。
> 原第三份 `team`（2070 字符 / 518 tokens）已随类型退役整份删除（见 §9）。

### 6.3 已按用户裁决执行（本轮，2026-10-11）

| 删除 / 改动 | 理由 |
|---|---|
| description 里的九字段名罗列（`responsibility, task_type, … evidence`） | 与 `parameters` 逐字段说明重复；保留「九个语义字段 + 未知字段被拒」 |
| `Field length: every field below states a generation budget in characters.` | 描述自身结构的元描述，不影响调用 |
| `text that exceeds a field cap (or the total cap) fails the whole call with WF_EXPERIENCE_VALIDATION and nothing is recorded.` | **硬上限不应被模型知晓**（用户裁决：已有预算控制） |
| `(cap 8000)` 与 `: a shorter candidate stays retrievable and cheap to recall` | 同上（上限 + 理由说明） |
| `parameters` 中每字段的 `the cap is <M>`（7 个标量）与 `the caps are 8 items of 500 characters`（2 个数组） | 同上；字段级只保留生成预算 |
| `and each field description below states its length budget` | 元描述 |

**结果**：description 2013→**1564** 字符（298→236 词）、`parameters` 2296→**2041**、合计 4309→**3605 字符 ≈ 901 tokens**（省 176）；已实测确认模型可见面**不再出现任何硬上限**（`8000` 与 `cap` 均不存在）。

**测试同步**：把「预算 + 上限」断言改造为「预算（同源断言）+ 不得出现 cap（规则门禁）」——符合新规则（同源关系允许、完整文案不允许）。

### 6.4 待重做（方法论类 / 语言一致性）

| 项 | 说明 |
|---|---|
| 两份生成 Prompt 正文 | 属**方法论**（是否值得生成、如何抽象、边界与证据要求），且与工具 description 在「何时不要提交」上有重复表述；它已在常驻面之外（按需注入，符合「额外情况以其他形式注入」），但**语言为中文**，与英文常驻面混排 → **用户本轮定案：暂不动（保留）**，后期再统一语言并明确「方法论 vs 工具契约」的分界 |
| 字段预算的传达方式 | 现为「每字段一句 `Aim for at most N characters; the cap is M`」（模板生成）→ 可考虑统一在一处说明 + 仅标 cap，减少重复句式 |

### 6.5 复核确认无问题

- **双态调用**（空数组取 Prompt / 传候选入库）在 description 与 `parameters` 中都明确——影响调用，保留；
- **前置条件**明确（同一 run 内必须先取该类型 Prompt，否则 `WF_EXPERIENCE_NOT_INITIALIZED`）——影响调用，保留；
- **逐字段预算**给出（影响模型填写长度）——保留；
- 失败码齐全且进文本：`WF_EXPERIENCE_BAD_ARGS` / `WF_EXPERIENCE_VALIDATION` / `WF_EXPERIENCE_NOT_INITIALIZED` / `WF_EXPERIENCE_WRONG_TYPE` / `WF_EXPERIENCE_EMBEDDING_UNAVAILABLE`；
- experience 域**无中文残留**（本轮统一后已确认）。

### 6.6 ⚠️ 更正：experience 域曾有中文残留（上轮遗漏）— ✅ 本轮已全量清理

上轮的扫描口径只覆盖 `new WfError(` / `reason:` / `message:` / `error:` 字面量，**漏掉了经辅助构造函数生成的错误**，因此 6.5 最后一条结论**是错误的**。

**2026-10-11（team 退役轮）**：`subject.ts`、`infrastructure/experience-contract.ts` 已英文化；`team-context.ts` 随模块删除。

**2026-10-11（本轮缺陷清理）**：按「出口」清点后**全量英文化**——本域 6 类封装构造函数（`invalid` / `badArgs` / `fail` / `codecError` / `feedbackFailed` / `embeddingUnavailable`）+ 直连 `new WfError` 全覆盖，共 11 个源文件、约 73 处出口：

| 文件 | 出口数 |
|---|---|
| `experience/validation.ts` | 24（含 `where` 标签与 `ALLOWED_FIELD_TEXT`） |
| `experience/service.ts` | 14（含「三类 Prompt 种子」→ `two prompt seeds` 的过时措辞修正） |
| `tools/wf-experience-feedback/apply.ts` | 11 |
| `experience/embedding-codec.ts` / `feedback.ts` | 各 7 |
| `projection` / `retrieval` / `scoring` / 三工具 `tool.ts` / `experience-contract` | 合计 10（另含 `experience-contract.ts` 的 `EXPERIENCE_TYPE_NOTE` 值残留） |

**保留中文的例外（逐项受众判定，共 6 处非注释行）**：3 处宿主日志诊断（`deps.logger.warn`，全仓日志统一中文）+ 3 处工具注册期装配错误（模型不可达；仓库 11 工具逐字统一措辞）。**模型可见出口 0 残留**。

**顺带完成的判断项**：`projection.ts` 的 `（无）` → `(none)`、全角分号 `；` → `; `（模型可见投影文本的语言面统一；已落盘的旧行保留旧分隔符，不影响任何判定）。

**测试治理升级**：新增 `tests/host/experience/fixtures/assertions.ts` 的 `modelFacingProblemOf(error)`——把「`{CODE}: ` 前缀 + 引号外散文无 CJK」绑进**唯一出口** `errorOf`，三工具本地 `failureOf` 同样升级；此后任何经该出口的错误自动受规范门禁保护。这修掉了「规范没绑在出口上」这一根因。

**治理规则补充（已写入 §3）**：错误消息必须按「出口」清点——`WfError` 构造点 **+ 所有封装构造函数**（`invalid(...)`、`fail(...)` 等），不能只扫字面量；否则会得出「已全英文」的错误结论。

---

## 7. `wf_experience_recall` 复核发现

### 7.1 常驻面（实测）

| 项 | 实测 |
|---|---|
| description | 1730 字符 / **258 词** ≈ 433 tokens |
| `parameters` | 889 字符 ≈ 222 tokens（`type` 217 / `query` 146 / `ids` 130 / `topK` 103） |
| 合计 | 2619 字符 ≈ **655 tokens**（首轮 792 → 已省 137） |
| `output.schema` | 302 字符（native 不注入） |

运行时：无额外注入（返回体按需：候选摘要或完整条目）。

### 7.2 已按用户裁决执行（2026-10-11）

| # | 项 | 处置 |
|---|---|---|
| R1 | 候选得分句里的 `of at most ±20%` | **删除**（内部信任权重不进模型可见面）；保留「信任不压过相关度、优先选更相关」的行为指引 |
| R2 | `the ranking is never recalculated here` | **删除**（内部实现说明） |
| R3 | `or more than ${MAX_RECALL_IDS} ids in the second stage` | **保留**（用户裁决：与 learn 的字符上限不同——这里没有别处写过数量上限，模型需要知道 ids 的单次上限） |
| R4 | `type` 参数说明三工具各写一遍 | **提升为共享常量** `EXPERIENCE_TYPE_PARAM_DESCRIPTION`（`infrastructure/experience-contract.ts`），learn / recall / feedback 三处引用，消除措辞漂移 |
| R5 | `, the wrap-up stage shared with wf_experience_learn` | **删除** |
| — | `Use wf_org_catalog instead to survey reusable organization assets …` 整句 | **删除**（用户裁决：工具分工信息不属于本工具常驻面） |
| — | `Content is never modified and the ranking is never recalculated here.` | **删除** |
| — | 阶段句与两段式句 | **合并**为用户给定表述（"Recall happens at the start of a task or while it is running. It is a two-stage call: query returns ranked candidate summaries [{id, score, summary, source}], then ids returns the full experience entries."） |

**结果**：recall 常驻 2619→**2167** 字符（description 1730→1307、params 889→860）≈ **655→542 tokens**（−113）；learn 与 feedback 的 `type` 说明同步统一（learn 3587、feedback 1193）。

### 7.3 复核确认保留（影响调用）

- **两阶段调用**（`query` 取候选摘要 → `ids` 取完整条目）——核心调用语义；
- **`Pass either query or ids, never both`**（两处参数说明各一次，互斥条件）；
- **`reading full entries by ids is what makes them count as used`**——决定后续能否被 `feedback` 评价，属关键后果；
- **阶段指引**：任务开始前用 `query`、执行中情形变化用 `ids`；收尾阶段配合 `feedback`；
- **失败码**：`WF_EXPERIENCE_BAD_ARGS` / `WF_EXPERIENCE_NOT_FOUND` / `WF_EXPERIENCE_RECALL_FAILED` / `WF_EXPERIENCE_WRONG_TYPE`；
- 纯只读、无副作用（可安全重复调用）。

### 7.4 参数与上限实测

| 常量 | 值 | 模型是否被告知 |
|---|---|---|
| `DEFAULT_RECALL_TOP_K` | 15 | 未告知（描述未提默认值） |
| `MAX_RECALL_TOP_K` | 50 | 未告知 |
| `MAX_RECALL_IDS` | 50 | **被写进 description——按用户裁决保留**（此处无别处写过数量上限） |

超限时的错误文案（`recallIdsLimitProblem`）已是英文 + 可行动：`at most 50 ids may be recalled per call (received N); submit further batches`。

### 7.5 `source` 句：**已删除**（用户裁决）

用户裁决：删除 `source is "semantic" for embedding search or "bm25" for the lexical fallback.` ——
**语义检索是该工具可用性的前提**，一旦回退 BM25，召回质量使其几乎不可用，因此向模型解释 `source` 取值没有操作价值。

事实核对（[retrieval.ts:153-174](src/host/experience/retrieval.ts#L153)）：语义不可用（端口退化 bm25 或嵌入调用失败）时确实会回退 `rankByBm25` 并仍返回候选（`source: "bm25"`）——即**功能仍可用、召回质量显著受限**，与用户判断方向一致。

结果：recall 常驻 2167→**2089** 字符 ≈ 542→**522 tokens**；`source` 字段仍出现在返回体里（只是不再解释取值）。

---

## 8. `wf_experience_feedback` 复核发现（经验三工具最后一个）

### 8.1 常驻面（实测）

| 项 | 实测 |
|---|---|
| description | **3249 字符 / 520 词** ≈ 813 tokens |
| └ 其中锚点定义（glossary） | **1796 字符 ≈ 449 tokens（占 description 的 55%）** |
| `parameters` | **1524 字符** ≈ 381 tokens（`type` 188 / `evaluations` 132 / 6 个字段说明 526） |
| 合计 | **4773 字符 ≈ 1193 tokens**（经验三工具中最大） |
| `output.schema` | 双态说明（accepted / skipped）——native 不注入 |

运行时：无额外注入（`accepted` / `skipped` 直接来自提交结果）。

### 8.2 复核确认**必须保留**的部分

| 项 | 理由 |
|---|---|
| **glossary（四维 × 五级行为定义，449 tokens）** | 评分的**唯一判据**：每个维度每一级都是可判定的行为描述。删掉=模型失去锚点，只能在 0.75 与 1 之间凭感觉挑数字——属「影响调用」的核心内容，**不得外移** |
| `Preconditions: every experience_id must be one this subject had injected … through wf_experience_recall; experiences never used cannot be rated and come back in skipped.` | 决定**能否提交** |
| `Score each evaluation by choosing a semantic anchor level, never an arbitrary decimal.` | 决定**怎么给分** |
| `decision_effect is not how much you like the experience.` | 防最常见误用（把好感度当效果） |
| `unknown fields are rejected.` | 参数形状 |
| `Failure semantics:`（`WF_EXPERIENCE_BAD_ARGS` / `WF_EXPERIENCE_WRONG_TYPE` / `WF_EXPERIENCE_FEEDBACK_FAILED`） | 失败语义与稳定码 |
| `ratings can never be edited or deleted` | 不可逆性直接影响提交决策 |

### 8.3 已按用户裁决执行（2026-10-11）

| # | 项 | 处置 |
|---|---|---|
| F1 | 阶段句尾 `: recall happens at the start of a task or while it is running, and rating what was used belongs to the end` | **删除**（工具间导航，与 `recall` 描述重复）→ 压成 `Call it in the final completion stage of a task, together with wf_experience_learn.` |
| F2 | `evidence is optional facts behind the rating, not a run log;` | **删除**（与 `parameters.evidence` 字段说明同义重复） |
| F3 | 整句 `Side effects: …` | **改写为一句行为指引**（用户裁决：该句本质是「提交前想清楚，因为不可逆」，不需要罗列内部副作用）→ `Ratings are permanent and can never be edited or deleted — rate deliberately: submit only what you actually used and can justify.` |
| F4 | `parameters.experience_id` 说明与 Preconditions 轻度重复 | 未动（字段级就地可读，低优先） |

**结果**：feedback 常驻 4773→**4437** 字符（description 3249→2913、params 1524）≈ **1193→1109 tokens**（−84）；实测 `±20%` 与 `re-aggregate` 已不在模型可见面。

**测试同步**：把「断言含召回时机句」改为 `not.toContain('at the start of a task or while it is running')`，并新增 `not.toContain('±20%')` / `not.toContain('re-aggregate')` 门禁 + `toContain('can never be edited or deleted')`（不可逆须以行为指引形式保留）。

### 8.4 复核确认保留（影响调用，不得外移）

- **glossary（449 tokens）**：评分的唯一判据（四维 × 五级行为定义）；
- 前置条件（只能评价通过 `wf_experience_recall` 注入过的经验）；
- `Score each evaluation by choosing a semantic anchor level, never an arbitrary decimal.`；
- `decision_effect is not how much you like the experience.`；
- `unknown fields are rejected.` / 失败语义与三个稳定码；
- `Ratings are permanent …`（不可逆性，以行为指引形式）。

---

## 9. 本轮架构变更：`team` 类型退役 + 经验体系与运行时解绑（2026-10-11）

用户裁决：经验类型 `team` 从架构中**永久移除**；父代理侧「必须正在编排 / 改过图才能提交编排经验」的护栏**永久取消**；
类型改由调用方按「此刻正在执行的内容」自选（执行具体任务 → `agent`；父代理执行编排 → `orchestrator`）；子代理恒为 `agent`。

### 9.1 已执行

| 层 | 变更 |
|---|---|
| 类型域 | `ExperienceType` 收窄为 `'agent' \| 'orchestrator'`；类型联合 / `EXPERIENCE_TYPE_TABLE` / codec 白名单 / 三工具 `type.enum` 四处取值域对齐（enum 直接引用 `EXPERIENCE_TYPES`） |
| 数据库 | 两表 CHECK 收窄为 `('agent','orchestrator')`；新增幂等迁移 `retireTeamExperienceType`（先删 usage/evaluation/stats 子行 → 删父行 → **换表重建**并保留 agent/orchestrator 数据）；判据为「两表任一建表原文含 `'team'`」，混合态同样收口；重建前校验旧表列集合，不符即整笔回滚 |
| 数据 | 存量 team 经验行、其子行与 `ep-team-v1` 生成 Prompt 行**物理删除**（真删、不留备份表） |
| 护栏 | 父代理侧职责门禁全部删除；子代理护栏保留（工具层 + 域层双保险，只能 `agent`），且**不再要求**子代理处于编排运行实例内 |
| 解析入口 | 写入/读取合并为单一 `resolveExperienceSubject`（原差异只剩被取消的那条子代理门禁） |
| 端口 | `ExperienceRuntimePort` 删 `hasTeamInCurrentRun` / `hasGraphPatch` / `hasActiveRun`；宿主 `graphPatchedSessions` / `GraphPatchLogStore` / `recordGraphPatch` 与 `DIRS` 的 `graph-patches` 死目录整链移除 |
| 注入链 | 「team 经验召回一次 → 渲染同一段文本追加给协作组每个成员」整链删除（`orchestrator/team-experience.ts`、`prompts/team-experience.ts`、`experience/team-context.ts` 及全部消费点） |
| 生命周期 | 经验初始化态**不再随运行终态清空**（`onRunTerminal` seam 与其通知链整链删除），改为宿主 `dispose()` 时整体清空 |

### 9.2 新增治理原则（用户裁决，已固化）

见 [architecture.md](./architecture.md) §2.2 第 7 条、§10 第 8 条 与 [model-facing-surface-rules.md](./model-facing-surface-rules.md) §4.8：

> 经验体系独立于工作流运行时：经验工具不得以运行事实为调用前提；运行事实仅用于溯源，缺失按「无来源」表达；
> 经验状态的生命周期不得以运行终态为边界。

### 9.3 独立复核结论

**通过，无阻断级问题**。复核发现 3 个重要项（迁移判据只看一张表、`protocol.ts` 错误码契约注释过期、`runtime-base.ts` 死方法）与 1 处强绑定
（`onRunTerminal → clearSession`），均已修正并回归验证；迁移真实性、四处取值域一致性、护栏正反边界、`lib/` 残留均经独立探针取证。

### 9.4 遗留（本轮已大部分清掉，见 §10）

- ~~experience 域其余中文错误消息~~ → 已在 §10.1 全量清理；
- ~~`wf_db_query` 小缺陷~~、~~通则 G1 / G3~~、~~`wf_graph_patch` 剩余精简~~ → 已在 §10.2 / §10.3 完成；
- `org-sop.ts` 与方法论语言统一（§2.1）、两份生成 Prompt 正文语言 → **用户本轮定案：暂不动（保留）**；
- codec 侧 `EXPERIENCE_TYPE_VALUES` 仍是平行白名单（有「DDL CHECK ⇄ 白名单」一致性测试锁定，但无编译期穷尽）。

---

## 10. 本轮缺陷清理（2026-10-11，第二轮）

用户定案范围：**修已知缺陷；方法论与提示词正文不动**。三条并行流（各自写入范围互不重叠）+ Lead 收口。

### 10.1 experience 域模型可见错误消息全量英文化（§6.6 收口）

- 覆盖 11 个源文件、约 73 处出口，统一为 `{CODE}: english message`；稳定码语义不变、无同条件两码；
- 出口全覆盖：`invalid` / `badArgs` / `fail` / `codecError` / `feedbackFailed` / `embeddingUnavailable` + 直连 `new WfError`；
- **模型可见出口 0 中文残留**；保留中文的例外仅 6 处非注释行（3 处宿主日志 + 3 处装配期注册错误，见治理规则 §3.3 新增的两行语言边界）；
- 顺带：`projection.ts` 的 `（无）` → `(none)`、全角分号 → `; `（模型可见投影语言面统一）；
- 测试治理升级：`modelFacingProblemOf(error)` 绑进**唯一出口** `errorOf`，规范从此自动生效（治理规则 §3.4 第 7 条）。

### 10.2 `wf_db_query` 四项缺陷（§4 收口）

见 §4.1 / §4.2：双错误码收敛为 `WF_BAD_CALLER`；`truncated` 三处口径统一为「被上限**真**截断」；`SCHEMA_TABLE_LIMIT = 200` 单一本体 + `LIMIT 上限+1` 精确探针；实例定位经准入判定不写 description。`topK` 的 `max 50` 保留但改为与 `SEARCH_TOP_K_MAX` 同源插值。

### 10.3 `wf_graph_patch` 精简与错误码规则（§5.2 + 通则 G1 收口）

见 §5.2：2 句契约复述删除、1 句只删复述部分（保留调用相位提示）；批次级取码规则补入 `ERROR_CODE_SEMANTICS` 并与实现核对一致；G1 的后果句删除、字段枚举保留。

### 10.4 验证与留痕

- 本团队范围：**37 文件 / 697 用例**全绿；全仓 **220 文件 / 2709 用例**全绿；`pnpm typecheck` 0 error；
- 新增/改造的测试均带**红相或变异证据**（描述删句、取码规则、字段剥离、`truncated` 边界、topK 同源、注入链反向断言）；
- 提交按**本团队路径**显式暂存（工作区同时存在另一并行团队的改动；`lib/` 待两团队收工后统一重建，避免把他人中间态打进分发包）。

