# Bug 分析记录：勾选新的 session Checkbox 时报错（信息不足，暂停修复流程）

- Issue：#22 — `勾选新的 session Checkbox  时，会直接报错，切换新模型后，可以正常运行，这个是一个bug 吗？`
- 仓库：`GZX2211/dsh-Visual-Workflow`（分析基线 `890e702`，工作区 `project-bugfix`，分支 `bugfix/agent`）
- 涉及模块：**未能确定**（可能涉及 Client Toolbar「开启新会话」、Host `createSession` 端点/`CordisSessionProvider`，也可能属于 DSH 官方新会话界面）
- 结论：**未定位到稳定根因，按流程约束暂停后续修复**。Issue 缺少错误文本、操作位置、复现步骤与截图/日志；现有描述无法唯一映射到本仓库代码，不能据此编写修复方案。

> 本文件不是修复方案，而是交接用的排查记录。请父代理决定是否先向 Issue 作者回复补充信息，或按下方“待验证假设”继续取证。

---

## 1. Issue 原始信息（全量）

- 标题：`勾选新的 session Checkbox  时，会直接报错，切换新模型后，可以正常运行，这个是一个bug 吗？`
- 作者：`YUANSS2021`
- 创建时间：`2026-10-27T21:45:22Z`
- 正文：**空**
- 评论：**无**
- 附件/截图：**无**

可提取的仅有：

1. 操作：勾选“新的 session Checkbox”；
2. 结果：直接报错（未提供错误文本/截图/控制台信息）；
3. 规避/变化：切换新模型后可以正常运行；
4. 用户自己也不确定是否为 Bug（标题为疑问句）。

---

## 2. 已排查的代码路径（事实）

### 2.1 本仓库中与“新 session Checkbox”最接近的 UI

`src/client/components/toolbar/Toolbar.tsx` 第 99-113 行：

```tsx
{/* 开启新会话（仅实例来源态显示）：模板态 = 模板级持久化配置（随模板保存/删除）；
    资产态 = 一次性临时选项（资产无持久化归属，无路径选择）。实例态不显示：
    实例运行只认实例绑定的会话，无「新会话」概念 */}
{showNewSession
  ? (
      <label className="wf-toolbar__switch" title={t.newSessionHint}>
        <input
          type="checkbox"
          checked={instanceOptions.newSession}
          onChange={(event) => onInstanceOptionsChange({ newSession: event.target.checked })}
        />
        <span>{t.newSession}</span>
      </label>
    )
  : null}
```

- 文案：「开启新会话」（`src/client/i18n.ts` 第 419 行）；
- 仅在**实例来源态**（工作流模板 / 工作流资产）显示；
- 勾选后写入模板级配置或资产态临时选项，**不会立即创建会话**；
- 真正的会话创建发生在点击「创建实例 / 运行」时（`useDocumentActions.createInstanceFromCanvas` 第 250-267 行 → `EP_CREATE_SESSION` 端点），或定时任务触发时（`src/host/scheduler/engine.ts` 第 326 行）。

勾选动作本身（模板态）会立即保存模板（`useNewSessionOptions.onOptionsChange` 第 81-84 行 → `useDocumentActions.setFlowTemplateOptions` 第 365-392 行），失败会 toast 并回滚模板；资产态只 `dispatch INSTANCE_OPTIONS_SET`，不会报错。

### 2.2 会话创建链路

`src/host/api/workflows.ts` 第 35-55 行：`createSession` 端点 → `sessionProvider.createSession({ agentPreset?, cwd? })`。

`src/host/sessions/session-provider.ts` 第 50-94 行 `CordisSessionProvider.createSession`：

- 通过 `ctx.agents.create` 创建会话与根 Agent；
- 传入 `agentPresets.resolve` + `setup` 挂载 `standard` 预设；
- **未传 `agentOptions`（provider/model）**——接口 `AgentsCreateLike` 第 21-27 行虽然声明了可选的 `agentOptions?: { provider?; model? }`，当前实现未使用；
- 创建失败时抛错，由调用方 toast / HTTP 错误返回。

### 2.3 现有测试覆盖

`tests/` 中与“新会话 / createSession”相关的测试集中在 host 侧端点与会话提供者；没有 Issue 描述对应的复现用例。`src/client` 侧勾选 checkbox 的行为由 `useNewSessionOptions` 覆盖，勾选不会创建会话。

### 2.4 为什么现有描述无法定位根因

要唯一归因，至少需要一个可判定的事实（错误文本、控制台堆栈、操作界面、DSH 版本、模型配置），当前全部缺失：

- “勾选新的 session Checkbox”可能指：
  - 本插件 Toolbar 的「开启新会话」复选框；
  - DSH 官方“新建会话”界面的复选框（例如工作区/模型/预设选择）；
  - 其他插件/界面的 session 选择控件。
- “直接报错”可能指：
  - UI toast（本插件 `notify`/`toastError`）；
  - 浏览器控制台异常；
  - DSH 会话创建失败（`agents.create` 抛错，例如模型/provider 未配置）；
  - 模板保存失败（revision 冲突、校验失败）。
- “切换新模型后可以正常运行”与上述任何一条都不构成唯一因果：本插件 `createSession` 未指定模型，切换模型只会改变宿主默认 provider/model 配置。因此不能排除这是**环境/模型配置问题**或**DSH 官方问题**。

**按角色约束，不允许在未定位真实代码逻辑前猜测性修复；本 Issue 暂停。**

---

## 3. 需要 Issue 作者补充的信息（回复模板）

建议用以下友好文案回复 Issue #22（请父代理确认后再发）：

> 你好，感谢反馈。为了定位问题，麻烦补充以下信息：
>
> 1. 出问题的界面截图（含报错提示/控制台红色报错全文），或复制的错误文本；
> 2. 这个“新的 session Checkbox”具体在哪里？（是我们插件的工具栏「开启新会话」，还是 DSH 新建会话界面的选项？）
> 3. 具体操作步骤：是勾选后立即报错，还是勾选后点击「创建实例 / 运行」才报错？
> 4. DSH 与插件版本（插件版本见 `package.json`，当前主线为 `0.10.2`）；
> 5. 切换前后分别使用的模型/provider 名称，以及是否配置了可用的默认模型；
> 6. 是否每次都能复现？换一个工作流模板/资产是否同样出现？
>
> 有了以上信息我们就能确认是插件问题还是环境配置问题，感谢配合。

---

## 4. 待验证假设（仅为取证方向，不是修复方案）

以下假设按“信息补充后优先排查”排序，均**未确认**，不得直接据此改代码：

1. **模型/provider 默认配置缺失导致会话根 Agent 创建失败**
   - 依据：`CordisSessionProvider.createSession` 未传 `agentOptions`；`agents.create` 创建根 Agent 时若宿主默认模型不可用，可能抛错；
   - 验证：让用户提供报错全文与控制台堆栈；切换模型前后对比默认 provider/model；在 DSH 中直接新建会话（不经过本插件）是否也报错。
2. **模板保存失败被误认为“勾选报错”**
   - 依据：模板态勾选会立即保存模板（`setFlowTemplateOptions`），失败会 toast；
   - 验证：确认报错是否带 revision 冲突/校验失败文案；检查模板是否处于草稿/已被删除状态。
3. **DSH 官方新会话界面问题，不在本仓库范围**
   - 依据：用户描述的“session Checkbox + 切换新模型”更接近宿主新建会话流程；
   - 验证：在不启用本插件的情况下复现；若仍复现，转 DSH 官方仓库。
4. **本插件 Toolbar 的复选框事件/保存路径异常**
   - 依据：`onOptionsChange` 只处理 `newSession`，路径变更走目录选择器；理论上勾选不会抛错；
   - 验证：在浏览器控制台观察勾选时是否有 `remote.call` 失败或 reducer 异常。

---

## 5. 影响范围评估

- 当前**没有改动任何代码**，无影响面。
- 若后续确认属于本仓库问题，优先排查 `src/host/sessions/session-provider.ts`（会话/根 Agent 创建）与 `src/client/hooks/useNewSessionOptions.ts`（勾选交互）；再按实际根因评估是否触及 `src/host/shared` 契约。
- 若确认属于 DSH 官方或环境配置问题，本仓库无需修复，应在 Issue 中说明判定依据并关闭/转交。

---

## 6. 验证方式

本阶段无需执行构建/测试（未改代码）。补充信息到位后，按以下顺序验证：

1. 在 DSH Web profile 中按用户步骤复现，记录浏览器控制台与网络请求（`createSession` 端点返回）；
2. 若复现到本插件：补最小测试（`tests/client/hooks/useNewSessionOptions.test.tsx` 或 host 会话提供者测试）；
3. 修复后执行 `pnpm check`（若触及 `src/` 代码）。

---

## 7. 判定与上报

- 判定：**不是“确认非 Bug”**，而是**信息不足、根因未定位、暂停修复**（既不猜测修复，也不静默剔除）。
- 已上报父代理：需先向 Issue 作者索取 §3 信息；在信息补足前，本 Issue 不进入修复实现。
