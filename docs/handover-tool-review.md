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

**当前状态**：11 个 `wf_*` 工具中 **8 个已复核**（其中 7 个已整改），**5 个待复核**；
experience 域仍有一批**已确认的中文错误消息残留**（最高优先级待办，见 §2-A）。

**本阶段另有一轮架构变更**（`team` 类型退役 + 经验体系与运行时解绑），见 §1.1 与 [backlog §9](./tool-context-review-backlog.md)。
它不属于「工具文本优化」这条线，但改动了经验三工具的 `type` 取值域与调用护栏——接手前必须先读。

---

## 1. 已完成（按时间顺序）

| 工具 | 状态 | 关键改动 |
|---|---|---|
| `wf_ask` | ✅ 已改 | 对所有代理开放（删除「仅子代理」「必须活跃运行」护栏，改为身份自动分派）；错误消息英文+码；新增 `WF_NO_ASK_TARGET` |
| `wf_run_node` / `wf_run_node_wait` / `wf_finish` | ✅ 已改 | 描述精简（删内部实现说明、子代理拒绝声明、泛泛失败清单）；`wf_db_query` 的 139 词偏差收敛回 ≤130 词门禁 |
| `wf_ask_agent` | ✅ 已改 | 文案精简；**修真实缺陷**：过期 ask 不再永久阻塞协作组聚合；删除只写不读的 `PendingAsk.audit`；修正「阻塞/三态/resolve」过时声明 |
| `wf_db_query` | ✅ 已复核（小缺陷待修） | 见 backlog §4（双错误码、`truncated` 只 query 置位、SQLite schema 无上限） |
| `wf_org_catalog` | ✅ 已改 | 删除字段禁令句与「仅父代理可调用」；`ids` 报错统一；**记录 SOP 中文与方法论待重做**（backlog §2） |
| `wf_graph_patch` | ✅ 已改 | 按新标准删 3 句（契约指针、DAG 建模、坐标禁令）；`PATCH_CONTRACT_POINTER` 常量随之删除 |
| `wf_experience_learn` | ✅ 已改 | 删字段名罗列、元描述、理由句；**硬上限全部退出模型可见面**（只留生成预算）；1077→901 tokens |
| `wf_experience_recall` | ✅ 已改 | 删工具分工句、±20% 内部权重、实现说明、`source` 解释句；`type` 说明提为共享常量；655→522 tokens |
| `wf_experience_feedback` | ✅ 已改 | 删工具间导航句与重复的 evidence 说明；Side effects 整句改写为一句不可逆警示；1193→1109 tokens |

### 1.1 本轮架构变更（2026-10-11，Lead + Agent Team 执行）

| 项 | 结果 |
|---|---|
| `team` 经验类型退役 | `ExperienceType` 收窄两值；两表 CHECK 收窄 + 幂等迁移（换表重建、混合态收口、列校验）；存量 team 行与 `ep-team-v1` 物理删除 |
| 父代理护栏永久移除 | 类型由调用方按「此刻执行的内容」自选；子代理护栏保留（只能用 `agent`），且不再要求身处编排运行实例内 |
| Team 经验注入链删除 | 「召回一次 → 追加给每个成员」整链 + 三个源文件 + 旧护栏事实链（`markTeamStarted` / `graphPatched` / `GraphPatchLogStore` / `recordGraphPatch` / `graph-patches` 死目录）全部移除 |
| 经验体系解绑运行时 | 初始化态不再随运行终态清空（`onRunTerminal` 通知链整链删除），改为宿主 `dispose()` 整体清空 |
| 验证 | `pnpm typecheck` 0 error；`pnpm test` **218 文件 / 2684 用例全绿**；`pnpm build` 已重建 `lib/`；独立复核（多轮对抗性取证）结论「通过、无阻断」 |

**跨工具统一（已做）**：
- 可见性元数据事实修正（`PARENT_AGENT_VISIBLE_TOOLS` 移除 `wf_ask_agent`）；
- 配置键名迁移 `wfAskAgentTimeoutMs → wfAskAgentTtlMs`（新键为主 + 旧键读取兼容 + 单测）；
- `EXPERIENCE_TYPE_PARAM_DESCRIPTION` 共享常量（三工具统一措辞）；
- orchestrator 工具路径 + 工具层 + 写图契约 + 图检查器 + validate 的错误文本英文+码；
- flaky 修复（watchdog / service manager 提高等待上限，断言不变；vitest 用例上限 20s→60s）。

---

## 2. 待办（按优先级）

### A. 代码修复类（高优先，清单有详细记录）

1. **`experience` 域中文错误消息残留**（backlog §6.6）——**最高优先**：
   - `experience/validation.ts` 的 `invalid()` 封装产出 **19 条中文**（字段类型/空白/超长、未知字段、重复候选、候选数上限、顶层未知字段…）——即经验学习/评估**最高频失败路径**；
   - 另：`feedback.ts`（含 `评价表写入失败：…`，测试 `tool.test.ts:484` 正锁定它）、`service.ts` / `embedding-codec.ts` / `projection.ts` / `recall/tool.ts` 等；
   - ✅ 已在本轮修完：`subject.ts`、`infrastructure/experience-contract.ts`（随 team 退役轮一并英文化）；`team-context.ts` 已整文件删除；
   - **扫描口径**：必须按「出口」找（`WfError` 构造点 **+ 所有封装构造函数**），不要只扫字面量（上次就是这么漏的，见治理规则 §3.6）；
   - 改完须同步对应测试断言（这些断言本身就违反"不硬编码文案"规则，可顺手改造为码断言）。
2. **`wf_db_query` 小缺陷**（backlog §4）：同一事实两个码（`WF_BAD_CALLER` vs `WF_BAD_ARGS`）；`truncated` 仅 query 置位；SQLite `schema()` 无表数上限；无运行编排时的实例定位未写进描述。
3. **通则 G1**：`graph-op-contract.ts` 的 `ROLE_NODE_DATA_CONTRACT` 里「Canvas-owned fields …」同义句——用户已判定可删，**等指令一起执行**。
4. **`wf_graph_patch` 剩余精简**（backlog §5.2）：描述里仍复述契约的 3 条（一组一次 / 原子性 / mark 时机）——按标准应继续删除；批次级错误码选择规则未写进契约。

### B. 结构类（待用户统一安排，已记录）

1. **`org-sop.ts` 的 SOP**（backlog §2）：`rules.designMethod`（规划方法论、中文）、`graphSemantics` 第四节（选择判据）与 kind 语义描述——属方法论/已过时（含 `wf_ask_agent` 旧说法，官方 Team 通道应为 `send_message`）；`dynamic.userSop` 注入点**从未落地**。
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

> 工作区中 `reports/` 属另一会话的 Agent Team 审查产物，**不要触碰、不要提交**。
