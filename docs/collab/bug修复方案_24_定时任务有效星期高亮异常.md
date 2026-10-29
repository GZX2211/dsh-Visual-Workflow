# Bug 修复方案：定时任务「有效星期」选择器高亮渲染异常

- Issue：#24 — `bug：定时任务界面“有效星期”选择器高亮渲染异常`
- 仓库：`GZX2211/dsh-Visual-Workflow`（分析基线 `890e702`，工作区 `project-bugfix`，分支 `bugfix/agent`）
- 涉及模块：`src/client`（WebUI 定时任务表单与样式）
- 结论：**根因已定位到样式层**，属于插件样式未收敛宿主 `:focus` 视觉导致的可复现渲染异常；改动只在 `src/client/styles/scheduler.ts`，不涉及 Host / 契约 / 状态机。

---

## 1. Issue 原始诉求与截图信息

Issue 正文只有一张截图（`https://github.com/user-attachments/assets/ece3ce63-17fb-4f07-bc3c-189d220f3114`，实际为 JPEG，1108×421）。

截图内容：定时任务表单的「有效星期」一行按钮（日 / 一 / 二 / 三 / 四 / 五 / 六 / 每天），用户标注：

> 高亮状态渲染异常：当指针悬浮在其他数字之上时，「日」字按钮都会同时高亮。

截图可见状态（用户标注时）：

- 「五」按钮有白色描边——指针正悬浮在「五」上；
- 「日」按钮同时有白色描边和白色文字，但指针不在「日」上；
- 「每天」按钮背景比其余按钮亮、带白色描边（这是 `daysOfWeek` 为空的正常选中态）；
- 其余星期按钮为暗色边框、灰色文字（未选中、未悬停）。

用户预期：只有指针所在的星期按钮显示悬停高亮，指针离开后不应继续高亮；「日」不应与「五」同时显示悬停样式。

---

## 2. 根因定位

### 2.1 组件结构（事实）

`src/client/components/scheduler/SchedulerTaskForm.tsx`，`SchedulerTaskForm` 组件，第 160-176 行：

```tsx
<Field variant="scheduler" label={copy.schedulerWindowDays}>
  <div className="wf-sched-days">
    {copy.schedulerWeekdays.map((label, day) => (
      <button key={label} type="button"
        className={`wf-sched-day${(draft?.window.daysOfWeek ?? []).includes(day) ? ' is-active' : ''}`}
        onClick={() => onToggleDay(day)} disabled={!draft}>
        {label}
      </button>
    ))}
    {/* 「每天」= daysOfWeek 为空；与具体星期互斥（选了任一星期即取消「每天」） */}
    <button type="button"
      className={`wf-sched-day is-all${((draft?.window.daysOfWeek ?? []).length === 0) ? ' is-active' : ''}`}
      onClick={onSetDaysAll} disabled={!draft}>
      {copy.schedulerWindowDaysAll}
    </button>
  </div>
</Field>
```

按钮只有两种视觉状态来源：

1. 选中态：`is-active` 类（由 `daysOfWeek` 推导）；
2. 悬停态：CSS 伪类 `:hover`。

没有任何“焦点态”处理，也没有在 `onClick` 后主动失焦。

### 2.2 样式定义（事实）

`src/client/styles/scheduler.ts`，第 140-166 行：

```css
.wf-sched-day {
  border: 1px solid var(--wf-border);
  border-radius: 8px;
  background: var(--wf-layer);
  color: var(--wf-ink-2);
  padding: 5px 0;
  width: 32px;
  font-size: 11px;
  cursor: pointer;
  font-weight: 600;
}

.wf-sched-day:hover {
  border-color: var(--wf-brand);
  color: var(--wf-ink);
}

.wf-sched-day.is-active {
  border-color: var(--wf-brand);
  background: color-mix(in srgb, var(--wf-brand) 12%, var(--wf-layer));
  color: var(--wf-brand);
}

.wf-sched-days .is-all {
  width: auto;
  padding: 5px 10px;
}
```

- 基础态：边框 `--wf-border`（深灰）、文字 `--wf-ink-2`（灰）、背景 `--wf-layer`（深色）；
- `:hover`：只改 `border-color` 为 `--wf-brand`（DSH 深色主题下为近白 `#FAFAFC`）和 `color` 为 `--wf-ink`（近白），**背景不变**；
- `.is-active`：边框/文字为 `--wf-brand`，背景为 `color-mix(brand 12%, layer)`（明显变亮）。

对 Issue 截图做像素采样（原图坐标，`System.Drawing.GetPixel`）：

| 位置 | 采样点 | RGB |
|---|---|---|
| 「日」按钮内部背景 | (55,265) / (85,265) | `#232323` / `#232323` |
| 「一」按钮内部背景 | (115,265) / (145,265) | `#232323` / `#232323` |
| 「五」按钮内部背景 | (355,265) / (385,265) | `#232323` / `#232323` |
| 「每天」按钮内部背景 | (480,265) / (520,265) | `#3C3E3D` / `#3D3D3D` |
| 「日」按钮上边框 | (70,236) | `#FAFAFC` |
| 「一」按钮上边框 | (130,236) | `#303030` |
| 「五」按钮上边框 | (370,236) | `#FAFAFC` |
| 「每天」按钮上边框 | (495,236) | `#F9FAFC` |

对照样式可确定：

- `--wf-layer ≈ #232323`、`--wf-brand ≈ #FAFAFC`；
- `color-mix(brand 12%, layer)` ≈ `#3D3D3D`，与「每天」背景完全吻合 → 「每天」是正常的 `is-active` 选中态；
- 「日」按钮背景仍是基础 `#232323`（**不是** `is-active`），但边框 `#FAFAFC`、文字白色，与 `.wf-sched-day:hover` 的声明逐项一致 → **「日」按钮当时匹配了悬停样式**；
- 「五」按钮同样匹配悬停样式（指针所在，正常）。

### 2.3 为什么「日」会在指针离开后继续显示悬停同款高亮

**已有事实**：截图只能证明「日」按钮在指针位于「五」时仍呈现 `.wf-sched-day:hover` 的完整视觉（边框/文字为 brand/ink，背景保持基础色），并且它不是 `is-active`。在不受控的 CSS 里，有两条机制会让按钮在指针离开后继续匹配这套视觉：

1. **焦点残留**：点击「日」后按钮获得焦点；宿主主题/浏览器对原生 `button:focus` 施加的视觉恰好与插件的 `:hover` 同款（brand 边框 + 亮色文字）。
2. **触摸设备的 sticky hover**：在触摸/混合输入设备上，触摸过的按钮会保留 `:hover` 状态，直到下一次指针交互；随后鼠标悬停「五」时，两个按钮同时匹配 `:hover`。

当前插件样式对星期按钮**完全没有 `:focus` / `:focus-visible` / `outline` 处理**（对 `src/client` 全量检索 `:focus`、`focus-visible`、`outline`，`scheduler.ts` 中只有输入框的 `:focus`，没有 `.wf-sched-day` 的任何焦点规则），`hover` 规则也没有限定设备能力。同一仓库已经出现过同类宿主焦点圈问题，并在样式层专门收敛过——`src/client/styles/sidebar-entry.ts` 第 67-74 行：

```css
/* 清除聚焦/点击后的发光焦点环（含默认浏览器/主题 focus 圈），保持与设置按钮一致 */
button.wf-sidebar-entry:focus,
button.wf-sidebar-entry:focus-visible,
button.wf-sidebar-entry:active {
  outline: none;
  box-shadow: none;
  -webkit-tap-highlight-color: transparent;
}
```

这条注释是直接证据：DSH 宿主主题/浏览器会对原生 `button` 施加可见焦点圈，插件需要显式收敛。星期按钮同样使用原生 `<button>`，但从未收敛焦点样式，也没有约束 hover 的适用设备。

**根因层结论**：`.wf-sched-day` 把“高亮”只交给裸 `:hover` 和宿主 `:focus` 两套不受控的状态表达，插件没有为“指针已离开”提供可靠的复位；两种机制（focus 残留 / sticky hover）任意一种都会产生 Issue 截图中的“多个按钮同时高亮”。静态截图无法区分是哪一种，但两者都由同一处样式缺口放大，且修复方式互补：

- 复位鼠标点击后的焦点残留；
- 把 `:hover` 限定在支持悬停的精细指针设备上。

### 2.4 复现路径

前置：进入工作台，打开「定时任务」管理弹层（`SchedulerManager`），选中任意任务或点「新建」得到草稿。

1. 在「有效星期」一行点击「日」按钮（选中或取消均可能），保持指针停留在该按钮上；
2. 将指针移动到「五」按钮上；
3. 观察「日」按钮：边框与文字仍为白色高亮，背景为普通深色；「五」按钮也为白色高亮；
4. 与 Issue 截图一致。

区分两种成因（用于验证修复覆盖面）：

- 用鼠标点击「日」后直接移到「五」：若「日」残留高亮，且点击弹层空白/按 Tab 移走焦点后消失 → **焦点残留**；
- 用触摸点击「日」后再用鼠标/触摸悬停「五」：若「日」残留高亮，且只有再次点击别处才消失 → **sticky hover**。

**复现说明（无法自动化复现的部分）**：该异常依赖真实浏览器的 `:focus`/`:hover` 渲染和宿主主题样式，`vitest + jsdom` 不做布局与伪类计算，无法在仓库现有测试环境中复现；本方案依据截图像素采样 + 代码事实定位，修复后需在 DSH Web profile 的浏览器中按上述步骤人工验证（鼠标与触摸设备各一次）。

---

## 3. 影响范围评估

| 维度 | 是否涉及 | 说明 |
|---|---|---|
| Host / `src/host/shared` 契约 | 否 | 纯 Client 样式修改 |
| 公共接口 / Tool Schema / 端点 | 否 | 不改组件 props、不改 remote 调用 |
| 状态机 / reducer | 否 | 不改 `StudioAction`、`SchedulerManager` 数据流 |
| i18n 文案 | 否 | 不新增/修改文案 |
| 样式类名 | 否 | 只给既有 `.wf-sched-day` 增加伪类规则，不增删类名 |
| 其他组件 | 否 | 规则限定在 `.wf-sched-day`，不影响 `.wf-btn`、日历、时间输入 |

风险点：键盘可访问性。直接 `outline: none` 会让键盘用户失去焦点指示；本方案用 `:focus-visible` 保留键盘焦点（与 `overlays.ts` 的 `.wf-modal:focus-visible`、`canvas.ts` 的 `.wf-graph__handle:focus-visible` 口径一致），仅收敛鼠标点击后的焦点残留。

---

## 4. 修复方案

### 4.1 改动点（唯一文件）

文件：`src/client/styles/scheduler.ts`
位置：`.wf-sched-day:hover` 规则之后、`.wf-sched-day.is-active` 规则之前（保持文件“规则顺序即覆盖顺序”的约定，不重排既有规则）。

改动一：把 `.wf-sched-day:hover` 限定在真正支持悬停的精细指针设备上（改写原第 152-155 行规则）：

```css
/* 触摸设备的 sticky hover 会让触摸过的按钮持续高亮；悬停反馈只对精细指针设备生效 */
@media (hover: hover) and (pointer: fine) {
  .wf-sched-day:hover {
    border-color: var(--wf-brand);
    color: var(--wf-ink);
  }
}
```

改动二：新增焦点态收敛规则（紧接在媒体查询之后）：

```css
/* 鼠标点击后的焦点残留不得沿用宿主 focus 的 brand 描边/白字（与 hover 同款会造成多个按钮同时高亮）；
   键盘导航仍由 :focus-visible 提供可见焦点。 */
.wf-sched-day:focus {
  outline: 0;
}

.wf-sched-day:not(.is-active):focus:not(:focus-visible):not(:hover) {
  border-color: var(--wf-border);
  color: var(--wf-ink-2);
  background: var(--wf-layer);
  box-shadow: none;
}

.wf-sched-day:focus-visible {
  outline: 2px solid var(--wf-brand);
  outline-offset: 2px;
}
```

设计说明：

- 媒体查询只禁用触摸/粗指针设备的 hover 样式，桌面鼠标行为不变；这是 sticky hover 的标准收敛方式；
- `:focus:not(:focus-visible):not(:hover)` 只在“鼠标点击后已离开按钮”时把宿主可能施加的 brand 边框/白字/背景/阴影复位为基础态；指针仍停在按钮上时 `:hover` 保持生效，不牺牲正常悬停反馈；
- `:not(.is-active)` 排除选中态：选中按钮始终保留 brand 边框/文字，不会被焦点复位规则误伤；
- `:focus-visible` 使用外描边而非改边框颜色，键盘 Tab 聚焦时与 hover 明确区分，且不改变按钮尺寸/布局；
- 媒体查询会改变原 `.wf-sched-day:hover` 规则的位置与缩进，但不改变桌面端声明内容；必须确认没有其他样式依赖原规则的行号/顺序（本文件内 `.is-active` 在焦点规则之前/之后均不影响，因其被 `:not(.is-active)` 排除）。

### 4.2 为什么改这里而不是组件

- 异常是纯视觉状态问题，业务状态（`daysOfWeek`）与点击逻辑均正确；在组件 `onClick` 里 `blur()` 会破坏键盘可访问性，并让点击后的 hover 反馈丢失，属于治标且引入副作用；
- 仓库已有“在样式层收敛宿主焦点圈”的既定做法（`sidebar-entry.ts`），星期按钮是遗漏点；把修复放在 `scheduler.ts` 与既有样式治理口径一致；
- 若在 `SchedulerTaskForm` 里给按钮加 `onFocus`/`onBlur` 状态类，会增加组件状态与渲染次数，且重复实现 CSS 已能表达的语义。

### 4.3 覆盖面说明（两种成因与修复的对应关系）

| 成因 | 修复措施 | 覆盖情况 |
|---|---|---|
| 鼠标点击后的焦点残留 | `:focus:not(:focus-visible):not(:hover)` 复位 + `:focus-visible` 外描边 | 覆盖（Chrome/Edge 鼠标点击不匹配 `:focus-visible`） |
| 纯触摸设备的 sticky hover | `@media (hover: hover) and (pointer: fine)` | 覆盖（触摸设备不再应用 hover 样式） |
| 混合设备的 sticky hover | 焦点复位 + hover 媒体查询 | **部分覆盖**：若设备 primary pointer 为 fine，hover 仍启用；需按 §2.4 的触摸复现步骤验证，必要时改用宿主提供的交互态或 JS 指针状态管理（会扩大改动面，先不做） |

### 4.4 不建议的方案

- 删除 `:hover` 规则：会丢失桌面悬停反馈；
- 在 `onToggleDay` 后 `document.activeElement.blur()`：键盘用户点击/回车后焦点丢失，且与仓库可访问性口径冲突；
- 用 `!important` 强行覆盖宿主样式：会破坏主题一致性与后续维护。

---

## 5. 验证方式

按根 `AGENTS.md` 的“改动与验证”表：本次属于 Client 样式改动，至少执行

```bash
pnpm check
```

（等价于 `pnpm typecheck && pnpm test && pnpm build && pnpm client-smoke`。）

人工回归（必须在真实 DSH Web profile 浏览器中执行，jsdom 无法覆盖伪类渲染）：

1. 打开定时任务弹层，反复点击「日」选中/取消；
2. 指针移到其他星期按钮：只有指针所在的按钮高亮，「日」不再残留白边（修复前可稳定复现）；
3. 选中若干星期，确认选中态（亮背景 + brand 边框）仍正常；「每天」选中态正常；
4. 键盘 Tab 进入星期按钮组：当前焦点按钮显示外描边焦点环，可正常用空格/回车切换；
5. 键盘切换后移开焦点，确认没有残留高亮；
6. 触摸设备（或在 DevTools 中模拟触摸）点击「日」后，再用鼠标/触摸悬停「五」：确认「日」不再保留 hover 白边（验证 §4.1 改动一）；
7. 浅色/深色主题各验证一次（token 来自 `--dsw-alias-*`，颜色随主题变化）。

---

## 6. 待确认事项

- 宿主主题对 `button:focus` 的具体声明无法在本仓库内直接查看（官方 UI 为运行时注入，不在 `node_modules`）；本方案以 `sidebar-entry.ts` 的既有收敛先例 + 截图像素为证据，并在 §4.1 同时覆盖焦点残留与触摸 sticky hover 两种成因。
- 若在混合输入设备（触摸 + 精细指针）上仍能复现，按 §2.4 的触摸步骤取证；届时再评估是否引入 JS 指针状态管理（会扩大改动面，本次不做）。
- Issue 未提供浏览器/操作系统信息；若维护者能拿到用户环境，补充后可进一步缩小到单一成因，但不影响本次修复方案落地。
