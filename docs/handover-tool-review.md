# 交接：工具模型可见面优化（进度 / 待办 / 工作方式）

> 写给上下文压缩后的自己（或接手者）。**先读这份，再读另外两份规则文档**：
> - [model-facing-surface-rules.md](./model-facing-surface-rules.md)：判定标准与错误码规范（**执行任何改动前必读**）
> - [tool-context-review-backlog.md](./tool-context-review-backlog.md)：逐工具复核记录与全部待办
>
> 最后更新：2026-10-11（本轮提交见文末「提交历史」）

---

## 0. 一分钟上手

**任务**：优化"注入到模型上下文的工具内容"——常驻文本必须是**影响该工具被调用**的内容，其余一律移出；
同时统一模型可见错误文本为 `{CODE}: english message`。

**两条铁律**（用户裁决，违反即返工）：

1. **常驻准入**：把一段文字移除后，若不影响该工具被调用 → 不应常驻。
2. **测试不许硬编码完整文案**：只允许断言 ① 结构（schema 形状）② 行为（结果/错误码）③ **同源关系**（常量 A 包含常量 B）④ 质量门禁（非空/词数/无中文）。改文案不需要改测试。

**验证命令**（每次改动后必跑，最后一条给团队留干净基线）：

```bash
pnpm typecheck && pnpm test && pnpm build
```

**当前状态**：11 个 `wf_*` 工具中 **8 个已复核**（其中 8 个已整改），**5 个待复核**；
**已知缺陷类待办已全部清零**（experience 域中文错误消息、`wf_db_query` 四项、通则 G1/G3、`wf_graph_patch` 精简）。
剩余：**B 结构类**（方法论 / 生成 Prompt 正文——用户定案暂不动）、**C 测试治理**、**D 五个未复核工具**。

**本阶段有两轮大改动**：架构变更（`team` 类型退役 + 经验体系与运行时解绑，见 §1.1 与 [backlog §9](./tool-context-review-backlog.md)）
与本轮缺陷清理（见 §1.2 与 [backlog §10](./tool-context-review-backlog.md)）。两者都不属于「工具文本优化」这条线，接手前必须先读。

---

## 1. 已完成（按时间顺序）

| 工具 | 状态 | 关键改动 |
|---|---|---|
| `wf_ask` | ✅ 已改 | 对所有代理开放（删除「仅子代理」「必须活跃运行」护栏，改为身份自动分派）；错误消息英文+码；新增 `WF_NO_ASK_TARGET` |
| `wf_run_node` / `wf_run_node_wait` / `wf_finish` | ✅ 已改 | 描述精简（删内部实现说明、子代理拒绝声明、泛泛失败清单）；`wf_db_query` 的 139 词偏差收敛回 ≤130 词门禁 |
| `wf_ask_agent` | ✅ 已改 | 文案精简；**修真实缺陷**：过期 ask 不再永久阻塞 协作组聚合；删除只写不读的 `PendingAsk.audit`；修正「阻塞/三态/resolve」过时声明 |
| `wf_db_query` | ✅ 已复核并修复 | 四项缺陷清零（双错误码 / `truncated` 三处口径统一 / SQLite 表数上限 / 实例定位判定），见 backlog §4 |
| `wf_org_catalog` | ✅ 已改 | 删除字段禁令句与「仅父代理可调用」；`ids` 报错统一；**记录 SOP 中文与方法论待重做**（backlog §2）——用户定案暂不动 |
| `wf_graph_patch` | ✅ 已改 | 首轮删 3 句（契约指针、DAG 建模、坐标禁令）；本轮再删 2 句契约复述 + mark 句只留相位提示，并补写批次级取码规则；description 525 → 243 字符 |
| `wf_experience_learn` | ✅ 已改 | 删字段名罗列、元描述、理由句；**硬上限全部退出模型可见面**（只留生成预算）；1077→901 tokens |
| `wf_experience_recall` | ✅ 已改 | 删工具分工句、±20% 内部权重、实现说明、`source` 解释句；`type` 说明提为共享常量；655→522 tokens |
| `wf_experience_feedback` | ✅ 已改 | 删工具间导航句与重复的 evidence 说明；Side effects 整句改写为一句不可逆警示；1193→1109 tokens |

### 1.1 本轮架构变更（2026-10-11，Lead + Agent 协作组执行）

| 项 | 结果 |
|---|---|
| `team` 经验类型退役 | `ExperienceType` 收窄两值；两表 CHECK 收窄 + 幂等迁移（换表重建、混合态收口、列校验）；存量 team 行与 `ep-team-v1` 物理删除 |
| 父代理护栏永久移除 | 类型由调用方按「此刻执行的内容」自选；子代理护栏保留（只能用 `agent`），且不再要求身处编排运行实例内 |
| 协作组经验注入链删除 | 「召回一次 → 追加给每个成员」整链 + 三个源文件 + 旧护栏事实链（`markTeamStarted` / `graphPatched` / `GraphPatchLogStore` / `recordGraphPatch` / `graph-patches` 死目录）全部移除 |
| 经验体系解绑运行时 | 初始化态不再随运行终态清空（`onRunTerminal` 通知链整链删除），改为宿主 `dispose()` 整体清空 |
| 验证 | `pnpm typecheck` 0 error；`pnpm test` **218 文件 / 2684 用例全绿**；`pnpm build` 已重建 `lib/`；独立复核（多轮对抗性取证）结论「通过、无阻断」 |

### 1.2 本轮缺陷清理（2026-10-11 第二轮，Lead + Agent 协作组执行）

用户定案范围：**只修已知缺陷；方法论与提示词正文不动**。三条并行流 + Lead 收口。

| 项 | 结果 |
|---|---|
| experience 域错误消息英文化 | 按**出口**清点后覆盖 11 个源文件、约 73 处出口，统一 `{CODE}: english message`；**模型可见出口 0 中文残留**（保留例外仅 6 处：宿主日志 3 + 装配期注册错误 3）；`projection` 占位与分隔符 ASCII 化 |
| `wf_db_query` 四项 | 双错误码收敛 `WF_BAD_CALLER`；`truncated` 三处口径统一为「被上限**真**截断」；`SCHEMA_TABLE_LIMIT=200` 单一本体 + `LIMIT 上限+1` 精确探针；实例定位经准入判定不写 description；`topK` 上限改为与常量同源 |
| `wf_graph_patch` + G1 | 删 2 句契约复述、mark 句只留相位提示；`ERROR_CODE_SEMANTICS` 补批次级取码规则（与实现核对一致）；G1 删后果句、保留字段枚举 |
| 测试治理升级 | `modelFacingProblemOf(error)` 绑进领域测试的**唯一错误出口**，规范自动生效（治理规则 §3.4 第 7 条） |
| 验证 | 本团队范围 **37 文件 / 697 用例**全绿；全仓 **220 文件 / 2709 用例**全绿；`pnpm typecheck` 0 error；关键改动均带红相/变异证据 |

> ⚠️ 本轮工作区**同时存在另一并行技术债团队的改动**（`shared/**`、`client/**`、`api/**`、`storage/**`、`vitest.config.ts` 等）。
> 因此本次提交**按本团队路径显式暂存**，且**未重建 `lib/`**——待两团队收工后统一 `pnpm build` 并提交分发包。

**跨工具统一（已做）**：
- 可见性元数据事实修正（`PARENT_AGENT_VISIBLE_TOOLS` 移除 `wf_ask_agent`；该常量已在后续技术债清理中退役）；
- 配置键名迁移 `wfAskAgentTimeoutMs → wfAskAgentTtlMs`（新键为主 + 旧键读取兼容 + 单测）；
- `EXPERIENCE_TYPE_PARAM_DESCRIPTION` 共享常量（三工具统一措辞）；
- orchestrator 工具路径 + 工具层 + 写图契约 + 图检查器 + validate 的错误文本英文+码；
- flaky 修复（watchdog / service manager 提高等待上限，断言不变；vitest 用例上限 20s→60s）。

---

## 2. 待办（按优先级）

### A. 代码修复类 — ✅ 已全部清零（2026-10-11 第二轮）

1. ~~`experience` 域中文错误消息残留~~ → ✅ **已完成**（backlog §6.6 / §10.1）：按「出口」清点覆盖 11 个源文件、约 73 处出口；模型可见出口 0 中文残留；`modelFacingProblemOf` 已绑进唯一错误出口。
2. ~~`wf_db_query` 小缺陷~~ → ✅ **四项全部修复**（backlog §4 / §10.2）。
3. ~~通则 G1~~ → ✅ **已执行**：删后果句、保留字段枚举（偏差已备案，见 backlog §1 的 G1 行）。
4. ~~`wf_graph_patch` 剩余精简~~ → ✅ **已执行**（backlog §5.2 / §10.3）：2 句删除 + mark 句只留相位提示 + 批次级取码规则补写。

### B. 结构类（待用户统一安排，已记录）

1. **`org-sop.ts` 的 SOP**（backlog §2）：`rules.designMethod`（规划方法论、中文）、`graphSemantics` 第四节（选择判据）与 kind 语义描述——属方法论/已过时（含 `wf_ask_agent` 旧说法，官方 协作组通道应为 `send_message`）；`dynamic.userSop` 注入点**从未落地**。
2. **两份生成 Prompt 正文**（`assets/experience-seeds.ts`，1681 / 2369 字符，**中文**）：属方法论（按需注入合规），但与英文常驻面混排 → 统一语言 + 明确方法论/契约分界。（原第三份 `team` 已随类型退役删除。）
3. **契约正文语言**：`graph-op-contract.ts` 已英文 ✅；`invariants-rules-*` / `validate.ts` 已英文 ✅（本轮完成）。

### C. 测试治理类

按「不硬编码完整文案」规则，**已确认的待改造断言清单**见 backlog 顶部与各工具小节（`wf-graph-patch`、`wf-org-catalog`、`wf-experience-*`、`invariants` 等）；改造方向：结构 / 行为 / 同源 / 质量门禁，禁止完整文案。

### D. 未复核工具（继续按同一流程）

`wf_ask` → `wf_run_node` → `wf_run_node_wait` → `wf_finish` → `wf_ask_agent`
（`wf_ask` 与 `wf_ask_agent` 已在本轮整改过文案，但**尚未按复核流程出报告**。）

---

## 3. 复核流程（每个工具固定六步）

1. **穷举注入渠道**：工具名 / description / parameters / `output.schema` / `tool:*` 散文段是否存在 / 可见性与开关 / 成功结果文本 / 失败结果文本 / `deferLoading`；
2. **中英对照**（英文原文逐句给中文）；
3. **实测取证**：dump 真实注册产物并量化（字符/词/token）；需要时做**零副作用探测**（非法参数触发校验分支）拿模型实际看到的字节；
4. **说明使用方式**：何时调用、前置条件、副作用、返回值语义、边界（"我会怎么用"）；
5. **发现分类**：契约（保留） vs 方法论/冗余（进 backlog）；**硬上限与内部参数（±%、阈值、内部重算机制）一律不进模型可见面**；
6. **验证与留痕**：`pnpm typecheck && pnpm test && pnpm build`，然后 commit（中文多行 message，说明用户裁决与度量）。

---

## 4. 关键文件索引

| 用途 | 路径 |
|---|---|
| 判定标准 + 错误码规范 | [docs/model-facing-surface-rules.md](./model-facing-surface-rules.md) |
| 架构原则（含「经验体系独立于运行时」） | [docs/architecture.md](./architecture.md) §2.2 第 7 条 |
| 复核记录 + 待办总表 | [docs/tool-context-review-backlog.md](./tool-context-review-backlog.md) |
| 工具注册 DSL / 输出渲染 | `src/host/tools/infrastructure/{define-tool,text-render}.ts` |
| 写图契约（英文，单一事实源） | `src/host/tools/infrastructure/graph-op-contract.ts` |
| 经验工具共享契约 | `src/host/tools/infrastructure/experience-contract.ts` |
| 经验域错误消息（**待英文化**） | `src/host/experience/validation.ts` 等 |
| 规划 SOP（**待重做**） | `src/host/prompts/org-sop.ts` |
| 生成 Prompt 种子（**待统一语言**） | `src/host/assets/experience-seeds.ts` |
| 工具开关（只影响可见性） | `src/host/tools/infrastructure/tool-switches.ts` |
| 子代理可见性双保险 | `src/host/shared/protocol.ts`（`CHILD_AGENT_HIDDEN_TOOLS`）+ `src/host/agent/runner.ts` |

---

## 5. 提交历史（本阶段）

| commit | 内容 |
|---|---|
| `19b9740` | 优化工具模型可见面：描述精简 + 错误文本统一为英文+稳定码（11 工具首轮） |
| `e48e4bb` | `wf_org_catalog`：删除画布字段禁令句 |
| `1f1f7c5` | `ids` 报错统一 + 新建复核待办清单 |
| `5a58017` | `wf_graph_patch`：按「不影响调用即不常驻」删三段描述 |
| `36c17ff` | 新增模型可见面治理规则草案 + `learn` 复核记录 |
| `df85db7` | `learn`：移除字段名罗列与全部硬上限（只留生成预算） |
| `9376663` | 记录 `recall` 复核结果 |
| `282bca3` | `recall`：删工具分工/内部权重/实现说明 + `type` 说明提为共享常量 |
| `ebd530d` | `recall`：删 `source` 解释句 + 记录 `feedback` 复核 |
| （本轮） | `feedback`：删工具间导航与重复说明，Side effects 改写为不可逆警示 |
| `d1c3e3a` | **架构变更**：`team` 类型退役 + 父代理护栏永久移除 + 经验体系与运行时解绑（含独立复核发现项的修正、`lib/` 重建） |
| `e5e904a` | **缺陷清理**：experience 域错误消息全量英文化 + `wf_db_query` 四项缺陷 + `wf_graph_patch` 精简与取码规则 + 通则 G1/G3（33 文件；仅按本团队路径暂存，`lib/` 待统一重建） |

> 工作区中 `reports/` 属另一会话的 Agent 协作组审查产物，**不要触碰、不要提交**。
