# `wf_send_message` 设计确认 + 执行交接（2026-10-17）

> 用途：本文件同时是**设计确认书**与**上下文压缩后的执行交接**。压缩后按 §2 顺序继续执行即可，
> 所有必需事实（含实测结论、代码位置、待确认项）都在本文件内，不依赖会话记忆。

---

## 0. 已定案（用户 6 点，不得偏离）

1. **自建等价工具，不复制官方源码**（仓库约束：零官方运行时依赖、不改 dsh 核心）。
2. **寻址面**：
   - 子代理侧只用**一个**稳定 ID：**`nodeId`**（覆盖普通子代理与 teammate 两种形态，由插件内部解析）；
   - 父代理用**固定别名 `parent`**（不用 id，全图只有一个父代理）。
3. **官方工具收口**：插件**默认关闭官方 `send_message`**；`list_agents`（列出运行中的子代理）与
   `interrupt_agent`（终止子代理）**保留**（插件暂无对应能力）；**任务板 `team_task_*` 仍归官方**；
   插件只负责**消息发送**与**流程运行**。
4. **工具形态**：只做官方语义的**单向 durable message**，**不做 ask/reply 两态**；
   `wf_ask_agent` **直接退役**，只复用其中有用函数（投递缝、协调者消息构造）；语义以官方为准。
5. **退役必须连带清理遗留技术债**。
6. **可通信清单注入**：以「角色名称 + ID」的形式注入；**非组内成员只有 `parent`**；
   **组内成员 = `parent` + 组内成员**；**不给上下游 id**；父代理必须有标识；
   **删除"官方通信定义附加在消息上方"的遗留**（与既有成员名单注入**互斥**，不能并存）；
   可通信清单**统一注入**，**不再区分 legacy / official**。

---

## 1. 设计（已冻结，见 §5 定案）

### 1.1 工具契约

```
wf_send_message({ target: string, message: string })
  target  : "parent" ｜ "<nodeId>"（本 run 内的角色节点，含 Team 成员）
  message : 自包含消息正文

返回：{ target, resolved, status: 'delivered' | 'queued' | 'resumed' }
  resolved : 实际投递对象（父代理 -> "parent"；普通子代理 -> childId；成员 -> 成员名）
  status   : delivered=在线投递；queued=入队；resumed=目标不在运行、已冷恢复唤醒

稳定错误码（写进 message 文本）：
  WF_SEND_BAD_ARGS        参数缺失/空 message/非法 target 形态/调用方身份不合法/自投
  WF_SEND_TARGET_UNKNOWN  目标不是本 run 的已启动成员，或该成员尚未启动
  WF_SEND_DELIVERY_FAILED 投递失败（可重试）

错误措辞红线（用户裁决 2026-10-17）：**不得引导子代理使用 wf_run_node**——子代理
既没有该工具，也不应知道它。目标未启动时的错误正文直接写「该成员未启动，你不可以
对其投递消息」，不做「请用 wf_run_node 调度」式引导。
```

### 1.2 寻址解析（唯一解析入口，插件内部）

| target | 解析与投递 |
|---|---|
| `parent` | 本会话 root agent：在线 `root.steer(coordinatorMessage(...))`；空闲 `agents.followupRoot(root, msg)` |
| `<nodeId>` → 普通子代理 | `childByNode` → childId：在线 `subagents.sendMessage(root, childId, blocks)`；inactive 同一调用冷恢复 |
| `<nodeId>` → Team 成员 | 官方 team 服务 `sendMessage(root, { target: 成员名, content })`（成员名 = `teammateNameOf(nodeId)`） |
| 其它 | `WF_SEND_TARGET_UNKNOWN` + 可通信清单提示 |

- 归属校验：目标必须属于**本 run**（与现状 `wf_ask_agent` 的 `childIndex/childByNode` + sessionId/flowId 校验同源）；
- **不做 ACL**：可见面即权限面（清单里不给的 id，模型无从拿到）。

### 1.3 复用与删除边界（第 4 点）

- **复用**（改造后继续用）：
  - `orchestrator/ask-protocol.ts` 的 `coordinatorMessage()`（source 归因）；
  - `RuntimeComm` 的 delivery 缝与归属校验；
  - `visual-workflow-host.followupChild()`（冷态 `subagents.sendMessage` / `queuePrompt` 兜底）；
  - `agent/runner.deliverReuse()` 的在线投递语义；
  - `graph-facts.collabBlockOf()` 的**成员数据构建**（id/label/target）——只保留数据，注入删除。
- **删除**（退役技术债）：
  - `tools/wf-ask-agent/**`（工具本体）；
  - `ask-protocol.ts` 的 ask/reply 两态：`AskAgentCmd`、`PendingAsk`、`run.asks` 登记、TTL 清理、`buildAskText/buildReplyText`；
  - `prompts/texts/notice-ask-message.ts`（ASK_MESSAGE / ASK_REPLY）；
  - `prompts` 里以 official/legacy 分叉的协作约束与协作块注入；
  - `config.wfAskAgentTtlMs`（若确认仅 ask 使用；config.test.ts 有键名迁移用例需同步）；
  - `protocol.ts` 的 `WF_ASK_AGENT`；
  - 相关测试：`tests/host/tools/wf-ask-agent/**`、`tests/host/prompts/collab.test.ts`、
    `builders.test.ts` / `task-blocks.test.ts` / `runtime-execute.test.ts` / `workflow-e2e.test.ts` /
    `register-tool.test.ts` / `protocol.test.ts` 中的协作断言。

### 1.4 官方工具收口（第 3 点）

- `protocol.ts`：`DEFAULT_DISABLED_ON_FIRST_INSTALL = [TEAM_SPAWN_TEAMMATE]`
  → 追加官方 `send_message`（`TEAM_SEND_MESSAGE`）；
- 已有全局开关瀑布可按 `assembly.tools` 剔除官方工具（`tools/infrastructure/tool-switches.ts` 头注释
  已取证：unscoped `system-prompt/assemble` 瀑布对全部 scope 生效）→ 无需新增机制；
- `api/catalog.ts` 的面板呈现逻辑已覆盖 `TEAM_TOOL_NAMES`（含 send_message），无需改。

### 1.5 可通信清单（第 6 点，统一注入）

- 新增清单段（建议放 `prompts/texts/child-comm-list.ts`），注入到**子代理任务块**（成员与非成员统一走它）：
  - 非组内成员：`- 父代理（parent）`；
  - 组内成员：`- 父代理（parent）` + 每个成员 `- <角色名>（<nodeId>）`；
  - **不注入**上游/下游 id。
- 与既有注入**互斥**：删除 `task-blocks.ts` 里 `collabBlockOf(...)` 与 official 分支的「团队协作说明」注入，
  以及 `buildCollabBlock` 的渲染（成员数据构建函数保留复用）；
- 统一后删除 `CollabChannel` 分支：`prompts/child.ts`（`collabRule`/`collabChannel`）、
  `prompts/texts/child-node-task.ts`（collab 段）、`parents.ts` 的 Team 段 official/legacy 分叉、
  `directive.ts`/`runtime-launch.ts` 的 `collabChannel` 传参、`runtime-execute.ts` 的通道判定。

---

## 2. 执行批次（TDD，每批 `pnpm typecheck` + `pnpm test`，收口 `pnpm check`）

**批次 1｜工具落地**
1. `protocol.ts`：新增 `WF_SEND_MESSAGE = 'wf_send_message'`；`DEFAULT_DISABLED_ON_FIRST_INSTALL` 追加官方 `send_message`。
2. 新增 `src/host/tools/wf-send-message/{tool.ts,types.ts}`（结构照 `wf-ask-agent`）；
   编排侧新增/改造投递能力（建议在 `runtime-comm.ts` 把 `wfAskAgent` 换成 `wfSendMessage`）。
3. 实现 §1.2 三向解析 + 错误码 + 审计日志。
4. 测试（先红）：parent 方向、nodeId（普通/成员）方向、未知目标、越界、冷恢复标注、相同 target 幂等/重复投递行为。

**批次 2｜可见面注入与旧注入删除**
5. 新增可通信清单模板 + 构建器；接入 `task-blocks.ts`。
6. 删除 `buildCollabBlock` 注入、official「团队协作说明」注入、全部 `collabChannel` 分叉。

**批次 3｜退役与清债**
7. 删除 `wf-ask-agent` 工具目录、ask/reply 登记与 TTL、`WF_ASK_AGENT`、ASK_MESSAGE/ASK_REPLY、
   （视确认）`config.wfAskAgentTtlMs`。
8. 同步删除/改写相关测试与文档（§1.3 清单）。
9. 旧数据兼容：历史工具组合里勾选的 `wf_ask_agent` 属"幽灵工具"，`resolveAgentTools` 已按
   `allow ∩ visible` 过滤 → 无需迁移，仅需确认 UI 呈现不报错。

**批次 4｜收口**
10. `pnpm check` 全绿；清理 `lib/` 幽灵产物（`build.mjs` 只清顶层，子目录残留需手工删）；
11. 提交（中文 commit，说明退役与替代关系）。

---

## 3. 关键代码位置（交接索引）

| 关注点 | 位置 |
|---|---|
| 工具常量 / 默认关闭清单 | `src/host/shared/protocol.ts`（`WF_ASK_AGENT:201`、`TEAM_SEND_MESSAGE:268`、`DEFAULT_DISABLED_ON_FIRST_INSTALL:305`） |
| 工具注册入口 | `src/host/tools/index.ts`（`registerWfAskAgent`） |
| 待退役工具 | `src/host/tools/wf-ask-agent/tool.ts` |
| ask/reply 协议与投递缝 | `src/host/orchestrator/ask-protocol.ts`、`runtime-comm.ts`（`wfAskAgent`） |
| 冷态投递 | `src/host/visual-workflow-host.ts`（`followupChild:402`） |
| 在线投递 | `src/host/agent/runner.ts`（`deliverReuse:691`） |
| Team 成员投递 | `src/host/agent/member-launcher.ts`（`teams.sendMessage(root,{target,content}):197`）+ `src/host/team/service.ts` |
| 父代理唤醒/插队 | `src/host/orchestrator/runtime-base.ts`（`notifyOrchestrationChange:554`：`root.steer` + `followupRoot`） |
| 清单数据来源 | `src/host/orchestrator/graph-facts.ts`（`collabBlockOf:95`、`collabGroupList:71`、`teammateNameOf`） |
| 任务块注入点 | `src/host/orchestrator/task-blocks.ts`（`buildNodeBlocks:33`） |
| 提示词模板 | `src/host/prompts/texts/{child-node-task,parent-orchestrator,parent-hybrid}.ts`、`prompts/{child,parents}.ts` |
| 工具开关瀑布 | `src/host/tools/infrastructure/tool-switches.ts`（头注释 12-18 行为机制取证） |
| 组合/面板文案 | `src/host/api/catalog.ts`、`src/host/api/tool-descriptions.ts` |

---

## 4. 已实测的关键事实（压缩后仍需知道，勿重复实测）

1. 官方存在**两套** `send_message`：
   - **Team 版**（`@deepseek-ai/dsh-experimental-tool-agent-team`）：参数 `target`/`message`，**只认 teammate 名（含 `lead`）**；
   - **全局版**（`@deepseek-ai/dsh-tool-subagent-control`）：参数 `agent_id`/`message`，面向所有可延续子代理。
2. **实测**（本会话 Team 可用）：父代理给普通子代理发 `send_message(id)` → `active teammate "…" not found`
   （目标**运行中**亦失败）；子代理用全局版按**真实父代理 id**发送 → **成功**（用 `lead` 等别名反而失败）。
3. 官方 Team bundle 文档原文：Team 版 `list_agents`/`send_message`/`interrupt_agent`
   **replace the disabled global continuable-child controls** → Team 可用时全局版被禁用。
4. 插件侧：`TEAM_TOOL_NAMES` 被从子代理 `allow` 名单剔除（`runner.ts:437,475`），
   因为官方对"可限制的全局工具名"有校验；Team 成员由官方创建且**不接受** toolFilter。
5. `wf_run_node` 返回体含 **`childId`**（`tools/wf-run-node/tool.ts:47`）。
6. 官方全局工具可被插件全局工具开关瀑布（`assembly.tools` 过滤）隐藏 → 收口官方 `send_message` 无需新机制。
7. Team 卡片允许空成员；`teammateNameOf(nodeId)` 是成员名映射。

---

## 5. 已定案（用户 2026-10-17 回答，冻结）

1. **冷恢复边界**：**允许**给"尚未启动/已结束"的节点发消息并唤醒它，返回 `status:'resumed'` 标注，
   以支撑"重新调度已完成节点应对新任务"。
2. **返回体形态**：`{ target, resolved, status }` 三值（delivered/queued/resumed）**通过**。
3. **参数名**：**`target` + `message`**（贴近官方 Team 版可读性）。
4. **清单文案**：父代理显示为 **「父代理（parent）」**——`父代理` 是名称，`parent` 是 ID。
5. **审计/去重**：**保留投递审计日志**，**不做重复投递去重**。
6. **`wf_ask`（子代理向用户提问）保持不动**；本方案**只退役 `wf_ask_agent`**。

### 5.1 执行前追加定案（2026-10-17 第二轮 6 问）

1. **冷恢复边界**：只唤醒**已启动过、当前已结束/空闲**（激活已释放，`childIndex` 仍有
   childId 记录）的节点 → `resumed`。**本 run 从未启动过的画布节点 → `WF_SEND_TARGET_UNKNOWN`**，
   错误正文为「该成员未启动，你不可以对其投递消息」（**禁止**提示使用 wf_run_node，见 §1.1 红线）。
2. **调用方范围**：**父代理与子代理都可调用**。父代理可向运行中的子代理/成员补发消息；
   `target=parent` 且调用方即父代理 → `WF_SEND_BAD_ARGS`（不可自投）；子代理给自己 nodeId 同理。
3. **不做 ACL**：只校验「目标属于本 run 且已启动」。可见面即权限面，清单只告知不授权。
4. **官方 `send_message` 收口**：**只对新安装播种**（与 `spawn_teammate` 同口径，不做用户数据迁移）；
   既有部署由用户在全局开关面板自行关闭；成员通信靠用户在组合里勾选 `wf_send_message`。
   接受「官方 team:policy 措辞与工具面暂时不一致」这一代价。
5. **status 判定**（按目标运行态映射）：
   - `parent`：可 steer → `delivered`；空闲需 followup 唤醒 → `queued`；
   - 普通子代理：在线 steer → `delivered`；不在线冷恢复 → `resumed`；
   - Team 成员：`running` → `delivered`；`inactive` → `resumed`；`provisioning` → `queued`；
     `failed` → `WF_SEND_TARGET_UNKNOWN`；状态读不到（null）→ `delivered`。
6. **配置清理**：`config.wfAskAgentTtlMs` + 只读旧键 `wfAskAgentTimeoutMs` **一并删除**
   （schema 键、旧键投影、`cordis.patch.yml` 行、config 迁移测试与各夹具传参）。
   已确认该 TTL 仅被 ask/reply 登记消费。删除前实测 schemastery 对未知键的容忍度。

## 6. 起点基线（执行前）

- 工作区干净；起点提交：`2868044 经验工具常驻面：删内部 trust 机制说明，保留召回→评价联动指引`；
- 起点 `pnpm check` 全绿（246 文件 / 3072 用例 + build + client-smoke）。

---

## 7. 执行结果（2026-10-17 完成）

批次 1–4 全部落地，`pnpm check` 全绿（**245 文件 / 3047 用例** + build + client-smoke）。

### 7.1 落地清单

- **新工具**：`src/host/tools/wf-send-message/tool.ts`（注册 + 三向投递缝）、
  `src/host/orchestrator/send-message-protocol.ts`（协议/常量/消息文本）、
  `src/host/prompts/texts/notice-send-message.ts`（投递消息包装）；
  编排层 `RuntimeComm.wfSendMessage` 按 §1.2 寻址、按 §5.1 第 5 条映射 status，
  并写投递审计（保留审计、不做去重）。
- **默认关闭**：`DEFAULT_DISABLED_ON_FIRST_INSTALL = [spawn_teammate, send_message]`
  （仍只对首次安装播种，不改写既有磁盘清单）。
- **可通信清单**：`graph-facts.commTargetsOf` → `buildNodeTaskBlock` 的「可通信对象」段，
  一次渲染、成员与非成员同一段、不列自身与上下游。
- **退役**：`tools/wf-ask-agent/**`、`orchestrator/ask-protocol.ts`、
  `prompts/texts/notice-ask-message.ts`、`RunEntry.asks`、`rejectAsks`、
  `config.wfAskAgentTtlMs` + 只读旧键 `wfAskAgentTimeoutMs`、`WF_ASK_AGENT`、
  `ASK_MESSAGE/ASK_REPLY`、协作块注入与全部 `collabChannel` 分叉、
  以及 `ERROR_STATUS` 中 ask 专用错误码登记。
- **改名**：`wf_ask` → `wf_ask_user`（常量 `WF_ASK_USER`、注册函数 `registerWfAskUser`、
  目录 `tools/wf-ask-user/`、文案与文档同步；行为零改动）。

### 7.2 实测与兼容（新增事实，勿重复实测）

- **schemastery 对未知键既不校验也不剥离**：既有部署的 `cordis.patch.yml` 若仍写着
  `wfAskAgentTtlMs`，升级**不会启动失败**，该值仅随解析结果原样透传（已无读取方）。
  由 `tests/host/config.test.ts` 的退役键用例锁定。
- **老组合中的 `wf_ask`**：工具组合是用户数据；改名为 `wf_ask_user` 后旧项成为幽灵工具
  （`resolveAgentTools` 按 `allow ∩ visible` 静默过滤）——不报错，但用户需在组合管理里
  重新勾选 `wf_ask_user` 才会下发。
- **官方 `team:policy` 与工具面暂时不一致**：官方 Team 可用时其策略段仍指引成员使用
  `send_message`，而该工具已被默认关闭；成员实际可用的消息通道是 `wf_send_message`
  （需在组合中勾选）。这是 §5.1 第 4 条明确接受的代价。
- **上游产出的 `（id：…）` 标注保留**：可通信清单不给上下游 id，指的是清单段只由组关系
  决定；流程上下文里标注上游产出**来源 id** 是必要的溯源信息，不属于可通信面。

### 7.3 测试基线变化

- 新增：`tests/host/tools/wf-send-message/tool.test.ts`（24 用例）。
- 删除：`tests/host/tools/wf-ask-agent/**`、`tests/host/prompts/collab.test.ts`。
- 改写：`task-blocks` / `runtime-execute` / `runtime-launch` / `builders` / `protocol` /
  `config` / `register-tool` / `catalog` / `tool-switches` / `cordis-patch` / `workflow-e2e`。
