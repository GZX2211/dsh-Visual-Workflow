# Bug 修复方案：二次确认弹窗「保存修改」按钮点击无响应

- Issue：#23 — `bug：二次确认弹窗中的“保存修改”按钮交互异常`
- 仓库：`GZX2211/dsh-Visual-Workflow`（分析基线 `890e702`，工作区 `project-bugfix`，分支 `bugfix/agent`）
- 涉及模块：`src/client`（工作台未保存守卫 + 编辑器保存入口 + 装配层）
- 结论：**根因已定位**。`ConfirmDialog` 的按钮接线本身正常；问题在它调用的 `saveEditor` 以“属性栏当前选中对象”（`state.editor`）为保存入口，而守卫要保存的是“画布文档”。当画布 dirty 但 `state.editor` 为 `null`（点了画布空白）或为 `node`/`edge`（选中节点/连线）且当前文档是工作流资产时，`saveEditor` / `saveCanvas` 直接返回 `null`，不落库、不接续原操作；而弹窗已被 `saveAndProceed` 先行关闭，于是表现为“点击保存修改没有任何反应”。资产界面与模板界面都走同一个守卫入口，故两处均出现。

---

## 1. Issue 原始诉求与截图信息

Issue 正文只有一张截图（`https://github.com/user-attachments/assets/3d9ae11f-61b1-451f-b7db-0babdc6d377a`，实际为 JPEG，1108×369）。

截图是“当前画布有未保存的修改”三选项弹窗：

- 标题：`当前画布有未保存的修改`
- 说明：`在继续之前，请选择如何处理当前画布的修改。`
- 按钮：`保存修改`（主按钮）、`放弃修改`（危险按钮）、`取消`
- 用户红字标注：

> 该按钮似乎没有被接通 点击无法保存，在资产界面和模板界面都存在该问题

用户预期：点击「保存修改」后，当前画布的未保存修改真实落库，然后继续原本的操作（切换库来源/打开文档等）。

---

## 2. 相关代码链路（事实）

### 2.1 弹窗按钮 → 守卫 → 保存入口

`src/client/components/confirm-dialog/ConfirmDialog.tsx`，第 27-32 行：

```tsx
const actions = confirm.kind === 'unsaved'
  ? [
      <button key="save" type="button" className="wf-btn is-primary" onClick={onSaveAndProceed}>{copy.unsavedSave}</button>,
      <button key="discard" type="button" className="wf-btn is-danger" onClick={onDiscardAndProceed}>{copy.unsavedDiscard}</button>,
      <button key="cancel" type="button" className="wf-btn" onClick={onClose}>{copy.unsavedCancel}</button>,
    ]
  : ...
```

按钮的 `onClick` 已正确绑定，不存在“按钮没接通”的 DOM/样式遮挡问题（`Modal` 与 `.wf-confirm__actions` 均无 `pointer-events` 拦截）。

`src/client/studio/StudioLayout.tsx`，第 429-440 行：

```tsx
{/* 确认弹窗：「保存并继续」在真实保存完成后才继续原操作——需要二次确认的路径
    （运行中实例保存）本次返回 null，落库发生在用户确认之后，经 onSaved 接续。 */}
<ConfirmDialog
  confirm={state.confirm}
  copy={t}
  onClose={() => dispatch({ type: 'CONFIRM_SET', confirm: null })}
  onSaveAndProceed={() => { void guard.saveAndProceed((onSaved) => editor.saveEditor({ onSaved })) }}
  onDiscardAndProceed={guard.discardAndProceed}
  onResolveImport={(mode) => { void transfer.resolveImportConflict(mode as 'rename' | 'overwrite') }}
/>
```

`src/client/hooks/useUnsavedGuard.ts`，`saveAndProceed`，第 36-57 行：

```ts
const saveAndProceed = useCallback(async (save: (onSaved: () => void) => Promise<unknown>) => {
  const pending = state.confirm
  dispatch({ type: 'CONFIRM_SET', confirm: null })     // ← 先关闭弹窗
  if (pending?.kind !== 'unsaved') return
  /** 原操作只允许继续一次（即时路径与确认路径可能先后都报到）。 */
  let proceeded = false
  const proceed = (): void => {
    if (proceeded) return
    proceeded = true
    pending.proceed?.()
  }
  try {
    // 返回值非 null/undefined = 本次调用已真实落库，直接继续；
    // 返回 null = 本次调用没有落库（运行中保存需二次确认 / 保存失败）——
    // 此时不继续、不静默丢弃：待用户确认后由 save 内部经 onSaved 接续，
    // 取消或失败则保持 dirty（原操作不执行，用户数据不丢）。
    const saved = await save(proceed)
    if (saved !== null && saved !== undefined) proceed()
  } catch {
    // 保存失败不继续（避免未保存数据被后续操作覆盖丢失）
  }
}, [dispatch, state.confirm])
```

关键事实：弹窗在调用保存**之前**就关闭了。因此只要保存入口返回 `null` 且不触发 `onSaved`，用户看到的就是“弹窗消失、什么都没发生”。

### 2.2 保存入口 `saveEditor` 的判定顺序

`src/client/hooks/useEditorActions.ts`，`saveEditor`，第 348-438 行（开头）：

```ts
const saveEditor = useCallback(async (options?: { onSaved?: () => void }): Promise<unknown> => {
  const editor = state.editor
  if (!editor) return null                                  // ← 入口 1：无选中对象即“无保存”
  const onSaved = options?.onSaved
  if (
    editor.source === 'workflow' || editor.source === 'service' || editor.source === 'flowTemplate'
    || editor.source === 'node' || editor.source === 'edge'
  ) {
    return await saveCanvas({ onSaved })                    // ← 入口 2：画布类来源走画布保存
  }
  if (editor.source === 'template') { ... }                 // 模板库保存
  if (editor.source === 'flowAsset') { ... }                // 资产保存（登记新版本）
  ...
})
```

`state.editor` 是**右侧属性栏当前选中/编辑对象的引用**（`src/client/studio/studio-types.ts` 第 62-74 行，`EditorRef` 可为 `null`），不是“当前打开的画布文档”。两者在以下场景会不一致：

- 用户点击画布空白处 → reducer `CLEAR_SELECTION`（`src/client/studio/studio-reducer.ts` 第 290-291 行）把 `editor` 置为 `null`，但不会清除 `dirty`；
- 用户选中画布上的节点/连线 → reducer `SELECT_NODE` / `SELECT_EDGE`（第 282-285 行）把 `editor` 置为 `{ source: 'node' | 'edge', id }`，同样与“当前文档类型”无关。

### 2.3 画布 `dirty` 的唯一来源

`src/client/studio/studio-reducer.ts` 中 `dirty: true` 只出现在画布/画布文档动作：

- 第 252 / 257 / 275 / 279 / 281 / 299 / 308 行：节点/连线增删、节点数据 patch、边 patch；
- 第 324 / 336 / 348 / 360 行：`DOC_PATCH`（实例/模板/服务/资产文档的名称/描述）。

即：`dirty` 语义 = **当前画布文档有未保存修改**，与 `state.editor` 选中了哪个属性栏对象无关。

### 2.4 资产文档的保存通道

`src/client/hooks/useDocumentActions.ts`，`saveCanvas`，第 197-201 行：

```ts
if (state.currentKind === 'flowAsset') {
  // 资产态保存 = 登记该资产的新版本（assets.saveVersion），由 T6 在属性栏接线；
  // 本函数（实例/模版/服务的落库通道）对资产不落库，避免误写模版端点。
  return null
}
```

资产态必须走 `saveEditor` 的 `editor.source === 'flowAsset'` 分支（`useEditorActions.ts` 第 371-400 行：`previewCascade` → `assets.saveVersion` → `assets.loadAsset` → `dispatch OPEN_FLOW_ASSET` → `onSaved?.()`）。该分支的守卫条件里写着：

```ts
const detail = state.assetDoc
if (!detail || detail.assetId !== editor.id) return null
```

它同样以 `editor.id` 为资产定位依据，而不是 `state.currentId` / `state.assetDoc.assetId`。

### 2.5 失败链汇总（两处界面分别命中不同分支）

设当前画布 dirty，用户点击「保存修改」：

| 场景 | `state.currentKind` | `state.editor` | 命中逻辑 | 结果 |
|---|---|---|---|---|
| 模板界面，点画布空白后切换 | `flowTemplate` | `null` | `saveEditor` 第 350 行 `if (!editor) return null` | 不保存、不 `onSaved`、不继续 |
| 资产界面，点画布空白后切换 | `flowAsset` | `null` | 同上 | 不保存、不继续 |
| 资产界面，选中任一节点后切换 | `flowAsset` | `{ source:'node' }` | 第 352-357 行走 `saveCanvas` → `useDocumentActions` 第 197-201 行对 `flowAsset` 返回 `null` | 不保存、不继续 |
| 资产界面，选中任一连线后切换 | `flowAsset` | `{ source:'edge' }` | 同上 | 不保存、不继续 |
| 资产界面，属性栏仍是资产本身 | `flowAsset` | `{ source:'flowAsset' }` | 第 371-400 行资产保存 | 正常（现有测试只覆盖了这一种） |
| 实例/模板界面，选中节点 | `workflow` / `flowTemplate` | `{ source:'node' }` | `saveCanvas` 正常保存 | 正常 |
| 实例/模板界面，点空白 | 任意 | `null` | 第 350 行 | 不保存、不继续 |

这解释了 Issue 中“资产界面和模板界面都存在该问题”，也解释了为什么不是必现：只要用户没有点画布空白、且资产界面属性栏仍指向资产本身，按钮就正常。

### 2.6 复现路径

前置：打开工作台，打开一个工作流模板（模板界面）或一个工作流资产（资产界面），画布可编辑。

1. 在画布上做一次修改（拖入/删除节点、连线或修改节点字段），确认出现未保存标记（`state.dirty = true`）；
2. 点击画布空白处取消选中（`CLEAR_SELECTION` → `state.editor = null`）；在资产界面也可改为点选一个节点（`state.editor = { source:'node' }`）；
3. 点击左侧库来源切换「模板 / 资产」，或点击另一份工作流/模板卡片（会走 `guard.guard`，`Studio.tsx` 第 253-259 行 `setLibrarySource`、第 262-264 行 `selectFlowAsset`、`useDocumentActions.ts` 第 435-446 行 `selectWorkflow`/`selectFlowTemplate`）；
4. 弹出“当前画布有未保存的修改”；
5. 点击「保存修改」；
6. 实际：弹窗关闭，但画布未保存（无成功 toast）、库来源未切换、目标文档未打开；画布内容仍在但没有任何保存反馈；
7. 预期：保存成功（toast），然后继续切换/打开操作。

**复现稳定性**：该路径是确定性代码分支（`editor === null` / `flowAsset + node|edge`），不依赖网络时序；可在浏览器中稳定复现。现有自动化测试未覆盖上述两种状态（见 §5）。

---

## 3. 影响范围评估

| 维度 | 是否涉及 | 说明 |
|---|---|---|
| Host / `src/host/shared` 契约 | 否 | 不改端点、不改共享类型 |
| 公共接口 | 是（仅 Client 内部 hook 面） | 需在 `EditorActionsFace` 增加/暴露“保存当前画布文档”方法；`ConfirmDialog` props 不变 |
| 状态机 / reducer | 否 | 不新增 `StudioAction`；复用 `MARK_SAVED`、`OPEN_FLOW_ASSET`、`CONFIRM_SET` |
| i18n 文案 | 否 | 复用既有 toast / 错误提示；若新增错误提示需同时补中英文 |
| 样式类名 | 否 | 纯逻辑修复 |
| 其他入口 | 是（正向修复） | 同一问题也影响属性栏在资产画布选中节点时的“保存”按钮（目前同样返回 `null`），统一入口后一并修复 |

**数据安全**：修复前 `saveAndProceed` 的失败语义是“不继续、保持 dirty”，所以不会丢数据；但“保存修改”按钮实际上没有保存，用户若随后点“放弃修改”会丢失修改。修复后应保证任何 dirty 的画布文档都能落到正确通道。

---

## 4. 修复方案

### 4.1 核心原则

> “保存修改”必须保存**触发 dirty 的对象**（当前画布文档），而不是**属性栏当前选中的对象**（`state.editor`）。
>
> 依据：`dirty` 在 reducer 中只由画布/画布文档动作置位（§2.3），`editor` 只用于属性栏渲染（`EditorRef`，可为 `null`，可指向节点/连线）。

### 4.2 改动点清单

#### 改动 1：`src/client/hooks/useEditorActions.ts` — 抽出“保存当前画布文档”唯一入口

新增内部函数（放在 `saveEditor` 之前，复用现有资产保存分支）：

```ts
/**
 * 保存当前画布文档（实例 / 服务 / 工作流模板 / 工作流资产）。
 * 与 state.editor 无关：未保存守卫面对的是画布 dirty，dirty 只来自当前画布文档。
 * 返回非 null/undefined = 本次已真实落库；null = 未落库（运行中待确认 / 失败）。
 */
const saveCanvasDocument = useCallback(async (options?: { onSaved?: () => void }): Promise<unknown> => {
  const onSaved = options?.onSaved
  if (state.currentKind === 'workflow' || state.currentKind === 'service' || state.currentKind === 'flowTemplate') {
    return await saveCanvas({ onSaved })
  }
  if (state.currentKind === 'flowAsset') {
    // 复用原 saveEditor 的 flowAsset 分支：以 state.assetDoc / state.currentId 定位，不以 editor.id
    const detail = state.assetDoc
    if (!detail || detail.assetId !== state.currentId) return null
    const payload = workflowAssetPayload(state, detail)
    // ...原第 376-399 行 doSave：previewCascade → assets.saveVersion → assets.loadAsset → dispatch OPEN_FLOW_ASSET → onSaved
  }
  return null
}, [assets, dispatch, needsCascadeConfirm, saveCanvas, state, t.assetCascadeWorkflowMessage])
```

要点：

- 资产分支的定位条件从 `editor.id` 改为 `state.currentId`（或 `state.assetDoc?.assetId`），这样 `editor` 为 `node` / `edge` / `null` 时也能保存当前资产文档；
- 资产分支保留原有级联预览与失败语义（`previewCascade` 失败降级、`saveVersion` 失败 toast、成功才 `onSaved`）；
- `workflow` / `service` / `flowTemplate` 走既有 `saveCanvas`，保留“运行中保存需二次确认、返回 null 由 onSaved 接续”的语义。

#### 改动 2：`src/client/hooks/useEditorActions.ts` — `saveEditor` 的画布类分支复用新入口

```ts
const saveEditor = useCallback(async (options?: { onSaved?: () => void }): Promise<unknown> => {
  const editor = state.editor
  if (!editor) return null           // 属性栏无选中对象：属性栏“保存”按钮本来就不可见/无对象，可保持返回 null
  const onSaved = options?.onSaved
  if (
    editor.source === 'workflow' || editor.source === 'service' || editor.source === 'flowTemplate'
    || editor.source === 'node' || editor.source === 'edge'
  ) {
    return await saveCanvasDocument({ onSaved })   // 行为与原来一致（实例/模板走 saveCanvas）
  }
  ...
  if (editor.source === 'flowAsset') {
    return await saveCanvasDocument({ onSaved })   // 原来仅 editor=flowAsset 可用；现在定位改为 currentId
  }
  ...
})
```

这样“属性栏保存”和“未保存守卫保存”共用同一套画布/资产保存逻辑，避免两份逻辑漂移（仓库注释多次强调“唯一实现”）。

#### 改动 3：`src/client/studio/StudioLayout.tsx` — 确认弹窗改调新入口

第 437 行：

```tsx
onSaveAndProceed={() => { void guard.saveAndProceed((onSaved) => editor.saveCanvasDocument({ onSaved })) }}
```

#### 改动 4：`src/client/hooks/useEditorActions.ts` — 暴露新方法

`EditorActionsFace`（第 37-55 行）增加：

```ts
/** 保存当前画布文档（与属性栏选中对象无关；未保存守卫使用）。 */
saveCanvasDocument(options?: { onSaved?: () => void }): Promise<unknown>
```

并在 hook 返回值（第 676-683 行）中加入 `saveCanvasDocument`，保持 `useMemo` 依赖完整。

#### 改动 5（建议）：保存入口无法定位文档时给出明确提示

`saveCanvasDocument` 在 `currentKind` 不匹配（或无 `assetDoc`）时返回 `null`，此时 `saveAndProceed` 不会继续，弹窗已关闭。为避免再次出现“静默无反应”，在该分支调用 `toastError` 或 `notify('error', ...)` 明确提示“当前文档无法保存，请重新打开后重试”。文案需同时补 `src/client/i18n.ts` 中英文（若沿用现有通用错误文案则无需新增）。

### 4.3 为什么改这里而不是别处

- **不改 `ConfirmDialog`**：它是纯表现组件，仅通过 props 接收回调；把保存逻辑塞进弹窗会破坏现有分层（`StudioLayout` 装配、hook 持有业务面）。
- **不改 `useUnsavedGuard`**：`saveAndProceed` 的语义（真实落库才继续、null 不继续）是正确且被测试覆盖的（`tests/client/hooks/useUnsavedGuard.test.tsx` 第 116 行“save 返回 null 不继续”）；本次问题是传进去的 `save` 实现选错了入口。
- **不给 `saveEditor` 加 `editor === null` 时“猜”当前文档**：属性栏“保存”按钮在没有选中对象时不应有行为；只有守卫路径需要按 `currentKind` 保存画布。因此新增独立入口，`saveEditor` 的可见行为保持不变（除资产画布选中节点这一处正向修复）。
- **不改 `saveCanvas` 的 `flowAsset` 分支**：该分支“本函数对资产不落库”是刻意的防误写设计（注释明确），资产保存必须走 `assets.saveVersion`；应在 `saveCanvasDocument` 里分派，而不是让 `saveCanvas` 越权。

### 4.4 影响面明细

- `EditorActionsFace` 新增方法：调用方仅 `StudioLayout`，需同步更新；`tests/client/hooks/useEditorActions.test.tsx` 的 harness 会拿到新方法，不影响既有断言。
- 资产保存分支的定位条件改为 `state.currentId`：对 `editor = flowAsset` 的既有路径等价（`OPEN_FLOW_ASSET` 同时设置 `currentId = assetId` 与 `editor.id = assetId`），既有测试应继续通过。
- 属性栏在资产画布选中节点时点“保存”：修复前返回 `null`（无反应），修复后登记资产新版本。这是与 Issue 23 同源的缺陷，属于正向行为变化；需在测试中明确覆盖。
- 运行中实例保存的二次确认路径不变：`saveCanvas` 仍返回 `null`，`onSaved` 在用户确认后触发；`saveAndProceed` 不会重复继续（`proceeded` 标志）。

---

## 5. 验证方式

### 5.1 自动化测试（新增用例）

`tests/client/hooks/useEditorActions.test.tsx`（现有 `renderAssetHarness` / `flowAssetState` 可复用）：

1. `flowAssetState({ editor: null, dirty: true })` + `saveCanvasDocument({ onSaved })`：
   - 断言调用 `EP_PREVIEW_ASSET_CASCADE` → `EP_SAVE_ASSET_VERSION` → `EP_GET_ASSET` / `EP_LIST_ASSETS`；
   - 断言 `onSaved` 被调用、返回值非 null；
2. `flowAssetState({ editor: { source: 'node', id: 'n-1' }, dirty: true })` + 同一入口：同上；
3. `flowAssetState({ editor: { source: 'edge', id: 'e-1' }, dirty: true })`：同上；
4. 模板态 `editor: null` + `currentKind: 'flowTemplate'`：断言走 `saveCanvas`（`EP_PUT_FLOW_TEMPLATE`），`onSaved` 被调用；
5. 资产保存失败（`EP_SAVE_ASSET_VERSION` 抛错）：断言返回值 null、`onSaved` 未调用（守卫不继续）；
6. `guard.saveAndProceed((onSaved) => harness.editor.saveCanvasDocument({ onSaved }))`：
   - 成功：`proceeded === true`；
   - 失败：`proceeded === false`、dirty 保留（现有 `useUnsavedGuard` 测试语义不变）。

### 5.2 命令

按根 `AGENTS.md` 的“改动与验证”表：本次修改 `src/client` 代码，至少执行

```bash
pnpm typecheck
pnpm test
```

若新增/修改 i18n 文案（§4.2 改动 5），必须再执行：

```bash
pnpm check
```

### 5.3 人工回归

1. 模板界面：编辑画布 → 点空白 → 切换库来源「资产」→ 点「保存修改」→ 出现保存成功 toast，界面继续切换；
2. 资产界面：编辑画布 → 点空白 → 切换「模板」→ 点「保存修改」→ 资产登记新版本（可在版本列表看到新版本号），随后继续切换；
3. 资产界面：编辑画布 → 选中一个节点 → 切换库来源 → 点「保存修改」→ 同上；
4. 资产界面：属性栏保持资产本身 → 切换 → 保存 → 既有行为不得回退；
5. 运行中的实例：编辑画布 → 切换 → 保存修改 → 先弹运行中保存二次确认 → 确认后落库并继续；
6. 保存失败（断网/资产已被删除）：点保存修改后应看到明确错误提示，且未继续切换、dirty 保留。

---

## 6. 待确认事项

- 新入口命名 `saveCanvasDocument` 是否与仓库术语一致；若维护者倾向复用 `saveCanvas` 命名，可改为 `saveCurrentDocument`，实现不变。
- §4.2 改动 5 的错误文案键名需按 `src/client/i18n.ts` 现有风格新增（中英文各一条）；若担心扩大改动面，可先复用 `remoteErrorMessageOf` 的通用文案。

---

## 7. 复核结论（复核与测试编写 Agent，2026-10-29）

复核依据（实测源码，非推断）：`src/client/hooks/useEditorActions.ts`（`saveEditor` 全部分支、`workflowAssetPayload`、`needsCascadeConfirm`）、`src/client/hooks/useDocumentActions.ts`（`saveCanvas` 的四种 `currentKind` 分支）、`src/client/hooks/useUnsavedGuard.ts`（`saveAndProceed` 全文）、`src/client/studio/studio-reducer.ts`（第 17–35 行 `openDocument`、第 96–124 行 `OPEN_FLOW_ASSET`、第 236–248 行 `CLEAR_CANVAS`、第 288 行 `SELECT_EDITOR`、第 314–360 行 `DOC_PATCH`）、`src/client/studio/studio-types.ts`（`EditorRef` 与 `currentKind` 定义）、`src/client/studio/StudioLayout.tsx`（第 433–440 行装配）。

### 7.1 复核通过的部分

1. **失败链准确**：`saveEditor` 第 348–357 行确实先取 `state.editor` 并在 `null` 时 `return null`；`node` / `edge` 一律转 `saveCanvas`；`saveCanvas` 对 `currentKind === 'flowAsset'` 确实直接 `return null`（`useDocumentActions.ts` 中注释「本函数对资产不落库」）。三处事实与方案 §2.5 的表格逐格吻合。
2. **`dirty` 语义准确**：`dirty: true` 只由画布图动作（第 252–308 行）与 `DOC_PATCH`（第 314–360 行，仅 `workflow` / `flowTemplate` / `service` / `flowAsset` 四种 `currentKind` 命中）置位；`roleAsset` / `promptAsset` / `experience` 编辑不会置 `dirty`，因此不会进入未保存守卫。`saveCanvasDocument` 只需覆盖这四种 `currentKind`，分派范围完整，不存在「角色资产也 dirty 但保存入口漏了」的缺口。
3. **`EditorRef` 与画布身份的一致性是方案改动 2 的前提，且事实成立**：`openDocument`（第 17–35 行）与 `OPEN_FLOW_ASSET`（第 96–124 行）在设置 `currentKind` / `currentId` 的同时同步重置 `editor`；`CLEAR_CANVAS` 与 `ASSET_CLOSED` 清 `currentKind` 时一并清 `editor`。故 `editor.source === 'flowAsset'` ⇒ `state.currentKind === 'flowAsset' && state.currentId === editor.id`，改动 2 把该分支改调 `saveCanvasDocument` 是行为等价的。
4. **`saveAndProceed` 语义成立**：弹窗先关、只有返回值非 `null/undefined` 或 `onSaved` 才 `proceed`，`proceeded` 标志防重复；方案「不回改 `useUnsavedGuard`」的判断正确——问题在传入的 `save` 实现选错了入口。
5. **改动 1 的资产分支可复用**：`workflowAssetPayload(state, detail)` 已存在（第 129 行起），`needsCascadeConfirm` 已存在，资产分支可从 `saveEditor` 平移，不需要新增 Host 端点。

### 7.2 复核发现的问题（需修正）

**F23-1（必改）：资产分支必须原样保留 `state.dirty` 门控，方案伪代码把它省掉了。**

- 依据：现实现 `const pending = state.dirty ? await needsCascadeConfirm(...) : false`，且注释明确「无未保存改动时内容与已入库版本全等……省掉一次预览往返（重复点击保存是『无改动保存』的最常见来源）」。方案 §4.2 改动 1 用 `// ...原第 376-399 行 doSave` 省略了这段，照此实现会让每次保存（含属性栏重复点保存）都多一次 `previewCascade` 往返。
- 可执行修正：`saveCanvasDocument` 的 `flowAsset` 分支整体平移 `saveEditor` 第 371–400 行的逻辑，**包括** `const pending = state.dirty ? await needsCascadeConfirm(...) : false` 与「`pending` 为真则本次返回 null、由 `onSaved` 接续」的语义；仅把定位条件从 `detail.assetId !== editor.id` 改为 `detail.assetId !== state.currentId`。

**F23-2（必改）：§4.2 改动 5 必须从「建议」升级为契约，否则仍是「静默无反应」。**

- 依据：方案 §3 自己要求「修复后应保证任何 dirty 的画布文档都能落到正确通道」，但改动 5 写「建议」。`flowAsset` 态下 `state.assetDoc` 与 `state.currentId` 可以不一致（`ASSET_DOC_LOADED` 会覆盖 `assetDoc`，例如属性栏/列表装载了另一份资产详情，而画布仍打开旧资产），此时新入口只能返回 `null`；弹窗已关闭，用户看到的仍是「点保存没反应」。
- 可执行修正：定位失败分支必须 `notify('error', t.<新增 key>)`（或 `toastError`）后再返回 `null`；新增 key 必须在 `src/client/i18n.ts` **同时**补中文与英文条目（父代理裁决）：建议 key `toastSaveUnavailable`，中文「当前文档无法保存，请重新打开后重试」、英文「Unable to save the current document. Reopen it and try again.」。禁止在 hook 内写死中文/英文字面量。

**F23-3（必改）：`StudioLayout.tsx` 第 431–432 行的装配注释必须同步改写。**

- 依据：该注释现写「保存统一经 editor.saveEditor：实例/模版态转 saveCanvas……」，改动 3 之后该装配点不再经过 `saveEditor`。按根 `AGENTS.md` 注释规范「行为变更同步更新或删除注释」，留着会误导下一位维护者。
- 可执行修正：改为说明「未保存守卫按**当前画布文档**保存（`saveCanvasDocument`），与属性栏选中对象无关；属性栏保存仍走 `saveEditor`」。

**F23-4（补强）：§5.1 用例 5 的断言不足以证明「失败语义完整」。**

- 依据：资产保存失败时除了返回 `null`，还必须「不重投影画布（不 dispatch `OPEN_FLOW_ASSET`）、不调 `onSaved`」；否则守卫可能接续原操作，用户数据在无落库的情况下被后续操作覆盖。方案只写了「返回值 null、`onSaved` 未调用」。
- 可执行修正：按 §8 的 T23-6 三条断言同时验证。

### 7.3 未采纳的质疑（记录以免重复讨论）

- 「把保存逻辑塞进 `ConfirmDialog`」：破坏 `StudioLayout` 装配 / hook 持有业务面的现有分层，不采纳（§4.3 已述）。
- 「放宽 `saveCanvas` 的 `flowAsset` 分支让其落库」：会误写模板端点，且违背该分支「防误写」的刻意设计，不采纳（§4.3 已述）。
- 「在 `saveEditor` 里给 `editor === null` 猜当前文档」：会让属性栏无对象时的保存按钮凭空产生行为，改变可见交互语义；新增独立入口更小，采纳方案原判。
- 「跨态不一致（`editor` 指向 flowAsset 而 `currentKind` 为 workflow）需要防御」：实测该状态不可达（`openDocument` / `OPEN_FLOW_ASSET` / `ASSET_CLOSED` / `CLEAR_CANVAS` 都同步重置 `editor`，`SELECT_EDITOR` 的唯一调用方 `useSelection.selectEditor` 只承接画布/属性栏的同态选择）。故不为它写用例（见 §8.4 有意未覆盖），但要求 `saveCanvasDocument` **不得再读 `state.editor`**，从根上避免这类不一致重新出现。

## 8. 测试契约（复核与测试编写 Agent）

### 8.1 契约主体与实现归属

- 出口：`src/client/hooks/useEditorActions.ts` 的 `EditorActionsFace` 新增
  ```ts
  saveCanvasDocument(options?: { onSaved?: () => void }): Promise<unknown>
  ```
  - `options.onSaved`：**仅当本次调用真实落库时**调用（运行中实例保存、级联确认后的落库都经它转达）。
  - 返回：非 `null`/`undefined` = 本次已真实落库；`null` = 未落库（待二次确认 / 定位失败 / 失败）。调用方（`useUnsavedGuard.saveAndProceed`）只据此决定是否继续。
- **归属判定（父代理裁决 2 要求给出理由与调用关系）**：放在 `useEditorActions.ts`，不放在 `useDocumentActions.ts`。
  - 理由：`saveCanvasDocument` 的分派必须同时触达「画布落库通道」（`saveCanvas`，来自 `useDocumentActions`）与「资产版本登记」（`assets.saveVersion` + `OPEN_FLOW_ASSET` + `needsCascadeConfirm`，已全部在 `useEditorActions` 的闭包内）。放进 `useDocumentActions` 会把资产版本登记逻辑搬进「文档生命周期面」，并让 `flowAsset` 保存出现两处实现（违反仓库反复强调的「唯一实现」）。
  - 调用关系（装配顺序不变，仅新增一条边）：
    ```
    StudioLayout
      ├─ ConfirmDialog.onSaveAndProceed ──► useUnsavedGuard.saveAndProceed
      │                                       └─► editor.saveCanvasDocument({ onSaved })
      │                                             ├─ currentKind=workflow|service|flowTemplate ──► useDocumentActions.saveCanvas
      │                                             └─ currentKind=flowAsset ──► assets.previewCascade? ──► assets.saveVersion ──► assets.loadAsset ──► OPEN_FLOW_ASSET ──► onSaved
      └─ InspectorPanel.onSave ──► editor.saveEditor        （属性栏语义不变；画布类分支复用 saveCanvasDocument）
    ```

### 8.2 条款

| 编号 | 条款 | 入参 / 出参 | 核心行为 | 边界与错误路径 |
|---|---|---|---|---|
| T23-1 | 入口存在且不看 `state.editor` | `(options?) => Promise<unknown>` | 从 `EditorActionsFace` 可取到（`typeof === 'function'`） | 实现内出现 `state.editor` 读取 → 违约（由 T23-2..T23-5 的「editor 取 null / node / edge 结果一致」用例间接证明） |
| T23-2 | 实例态委派画布保存 | `currentKind='workflow'`，`editor` ∈ {`null`, `node`, `edge`} | 调用注入的 `saveCanvas` 一次，透传 `onSaved`，返回其返回值 | `saveCanvas` 返回 `null`（运行中待确认）→ 本入口也返回 `null`，不得把 `null` 当成功 |
| T23-3 | 服务态委派画布保存 | `currentKind='service'`，`editor=null` | 同 T23-2 | 同上 |
| T23-4 | 模板态委派画布保存 | `currentKind='flowTemplate'`，`editor=null` | 同 T23-2 | 同上 |
| T23-5 | 资产态按 `currentId` 登记新版本，与 `editor` 无关 | `currentKind='flowAsset'`，`currentId='a-1'`，`assetDoc.assetId='a-1'`，`dirty=true`，`editor` ∈ {`null`, `node`, `edge`} | 调用序：`previewCascade` → `saveVersion(workflow, a-1)` → `loadAsset` → dispatch `OPEN_FLOW_ASSET(assetId='a-1')` → `onSaved`；返回非 `null` | 不得调用注入的 `saveCanvas`；三次 `editor` 变化的调用序列必须一致 |
| T23-6 | 资产态：无改动保存不打预览；失败语义完整 | `dirty=false` / `saveVersion` 抛错 | `dirty=false` → 跳过 `previewCascade`，仍重装载并 `onSaved`；`saveVersion` 抛错 → 返回 `null`、`onSaved` 未调用、按 `toastError` 报错、不 dispatch `OPEN_FLOW_ASSET` | 级联确认路径（`previewCascade` 有牵连）→ 本次返回 `null` 且不落库，确认后的落库经 `onSaved` 转达（既有语义） |
| T23-7 | 资产态定位不到当前文档必须显式报错 | `assetDoc=null` 或 `assetDoc.assetId !== currentId` | 返回 `null`、不发起任何写端点、给出错误提示（`notify('error', t.toastSaveUnavailable)` 或 `toastError`） | 静默返回 `null`（无任何提示）→ 违约：这正是 Issue 的「点了没反应」 |
| T23-8 | 属性栏保存与守卫共用同一通道（正向修复） | `currentKind='flowAsset'`，`dirty=true`，`editor={source:'node'}` | `saveEditor()` 走资产登记（`previewCascade` + `saveVersion`），不得委派 `saveCanvas`；返回非 `null` | `editor={source:'edge'}` 同；`editor=null` 时 `saveEditor` 仍返回 `null`（属性栏无对象，`T23-1` 不受影响） |
| T23-9 | 守卫端到端接续一次 | `dirty` 画布 + `confirm={kind:'unsaved', proceed}` + `editor=null` + `currentKind='flowAsset'` | `guard.saveAndProceed((onSaved) => saveCanvasDocument({ onSaved }))` → 真实落库后 `proceed` 恰好被调用一次 | 保存失败 → `proceed` 未调用；二次确认路径 → `proceed` 在确认并落库后调用（不得重复） |

### 8.3 i18n 契约（父代理裁决 3）

- 需要新增的 key 仅在 T23-7 使用：`toastSaveUnavailable`（中文 + 英文各一条，写入 `src/client/i18n.ts`）。
- 复用约束：能复用 `toastSaved`（成功）与 `revisionConflictRetry`（乐观锁）既有语义时必须复用，不得新增近义 key；不得在 `useEditorActions.ts` 或组件内写死文案。
- 改动 `i18n.ts` 后按根 `AGENTS.md` 最小验证表执行 `pnpm check`。

### 8.4 有意未覆盖（说明理由）

- 跨态不一致（`editor.source==='flowAsset'` 而 `currentKind!=='flowAsset'`）：实测不可达（见 §7.3 末条），不为不可达状态写用例；改以「`saveCanvasDocument` 不读 `state.editor`」从结构上排除。
- `roleAsset` / `promptAsset` / `experience` 的保存：不置 `dirty`，与未保存守卫无关；既有 `useEditorActions.test.tsx` 用例已覆盖，不重复。
- `ConfirmDialog` 按钮回调是否被点击：纯表现层装配，既有 `ConfirmDialog` 测试与本缺陷无关（弹窗按钮确实被接通），不重复。

## 9. 人工回归补充清单

在 §5.3 六条之外补测（自动化不可覆盖的装配与真实远端交互）：

1. 资产界面：属性栏保持「资产本身」，**不点空白**直接切换 → 「保存修改」→ 版本号递增、继续切换（既有行为不回退）。
2. 资产界面：先选中节点，再**点画布空白**，然后切换 → 「保存修改」→ 版本号递增、继续切换（Issue 主诉）。
3. 资产界面：保存失败（断网）→ 出现错误提示、仍停留原界面、未保存标记仍在。
4. 实例态（非运行中）：点空白后切换 → 「保存修改」→ 保存成功 toast + 继续切换。
5. 运行中实例：点空白后切换 → 「保存修改」→ 先弹运行中保存二次确认 → 确认后落库并继续；取消则停留且仍 dirty。
6. 属性栏保存按钮（资产画布选中节点时）：点击后出现「版本已保存」提示，节点选择被重投影刷新（已知行为，见 §7.1 第 3 条）。
