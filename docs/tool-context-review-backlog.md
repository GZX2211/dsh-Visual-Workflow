# 工具模型可见面 · 复核与重做清单

本清单记录**逐个工具复核**时发现的、需要在后期统一优化/重做的模型可见文本。
判定口径（用户裁决）：

- **与工具调用有关** → 保留（工具描述、字段形状、参数/错误码语义、前置条件、可见性规则、调用形态）。
- **与工具调用无关、只与「写图 / 规划方法论」有关** → 一律进入本清单，后期统一优化或重做（其中不少内容已被后续实现取代而失效）。

> 复核进度见文末「已复核工具」表；每复核一个工具就在本文件追加一节。

---

## 1. 通则（跨工具，待统一处理）

| # | 事项 | 状态 |
|---|---|---|
| G1 | **画布所有字段的禁令句**（`retryLimit / reactLimit / promptFilePath / injectSystemPrompt / injectToolSections / sourceAssetId`）：`wf_org_catalog` 描述里的那句已删除（commit `e48e4bb`）；`graph-op-contract.ts` 的 `ROLE_NODE_DATA_CONTRACT` 里的同义句**待用户确认后一并删除** | 待执行 |
| G2 | `reports/audit/VERIFY-ROUND2.md:272` 曾以「模型被明确告知不要传」为依据判定某条不构成契约漏洞；若 G1 的第二句也删掉，该依据失效（`apply.ts` 的 `PARENT_UNCONFIGURABLE_ROLE_FIELDS` 行为不变，结论实质不受影响） | 已告知 Team |
| G3 | 同一事实两个错误码：`wf_db_query` 的 `WF_BAD_CALLER`（tool.ts:84）与 `WF_BAD_ARGS`（tool.ts:168） | 待执行（见 §4.1） |

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
| `rules.patchContract` 的**提交规则 / op 字段形状 / 角色节点 data 契约 / 错误码语义** | `graph-op-contract.ts` | 写图必需，且与 `wf_graph_patch` 共用同一常量（单一事实源） |
| `rules.gateMarking`（闸门标记语义） | `graph-op-contract.ts` | 写图必需（`mark_node` 的时机/目标/预算） |
| `graphSemantics` 的**节点 kind 枚举、连线语义、连接点矩阵、条件线/DAG/数据节点硬规则、提交前自检** | `org-sop.ts` | 本插件自定义语义，模型猜不出，踩中即整批补丁原子失败 |
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
| 1 | `wf_db_query` | 已复核（发现：#2 `truncated` 仅 query 置位、#3 SQLite schema 无上限、#4 实例定位未写明、#5 双错误码 → 记入 §4） |
| 2 | `wf_org_catalog` | 已复核（见 §2） |
| 3 | `wf_graph_patch` | 待复核 |
| 4 | 经验三工具（learn / recall / feedback） | 待复核 |
| 5 | `wf_ask` / `wf_run_node` / `wf_run_node_wait` / `wf_finish` / `wf_ask_agent` | 待复核 |

---

## 4. `wf_db_query` 复核发现（补齐索引）

### 4.1 错误码重复（对应通则 G3）

- `tool.ts:84`：`WF_BAD_CALLER: cannot identify the caller session`
- `tool.ts:168`：`WF_BAD_ARGS: cannot identify the caller session`

同一条件、两个码。**分析结论**：`execute` 已在第 167-168 行校验 `sessionId` 非空，因此 `resolveDataQueryContext` 里的第 84 行检查**不可达**（死防御）。建议：删除第 84 行的重复检查，保留 `WF_BAD_CALLER` 作为唯一码；`ToolExecLike.agent` 在官方工具执行上下文里是可选的，所以第 168 行的防御分支本身应保留。

### 4.2 其它（暂不改）

- `truncated` 仅在 `query` 模式置位；`search` 的 hits 被 clamp（`indexer.ts:216` `Math.min(50, topK||5)`）或降级 BM25 时无标记。
- `schema` 表数上限：MySQL/PG 为 `LIMIT 200`，**SQLite 无上限**（大库会一次性灌入表名列表）。
- 主代理无运行编排时按「本会话最新实例」定位（`listWorkflows[0]`），描述未写明。
