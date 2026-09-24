// src/client/styles/scheduler.ts
//
// 定时任务域。定时任务：任务表单（分组 / 字段 / 重复区间）、任务列表与状态展示、双月日历、时间输入。
//
// 本文件内规则顺序即覆盖顺序（同特异性下后写的覆盖先写的），禁止重排。

export const schedulerStyles = `
/* ---- 定时任务（新功能本阶段；样式对齐组合管理 wf-combo 体系） ---- */
.wf-sched__form {
  flex: 1.25;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--wf-border);
  overflow: hidden;
}

.wf-sched__form-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  scrollbar-width: thin;
}

.wf-sched__form-foot {
  flex: none;
  display: flex;
  gap: 7px;
  padding: 10px 14px;
  border-top: 1px solid var(--wf-border);
}

.wf-sched__form-foot .wf-btn {
  flex: 1;
  font-size: 11px;
  padding: 6px 10px;
}

.wf-sched-field {
  display: grid;
  gap: 4px;
  color: var(--wf-ink-2);
  font-size: 11px;
}

.wf-sched-field__label {
  font-weight: 600;
  color: var(--wf-ink);
}

.wf-sched-field__hint {
  font-size: 9px;
  line-height: 1.55;
  color: var(--wf-ink-2);
}

.wf-sched-field select,
.wf-sched-field input {
  border: 1px solid var(--wf-border-strong);
  border-radius: 7px;
  background: var(--wf-layer-2);
  color: var(--wf-ink);
  padding: 6px 8px;
  outline: 0;
  font: inherit;
  font-size: 12px;
}

.wf-sched-field select:focus,
.wf-sched-field input:focus {
  border-color: var(--wf-brand);
}

/* ---- 表单分组与字段控件 ---- */
.wf-sched-group {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--wf-border);
  border-radius: 11px;
  background: var(--wf-layer-2);
}

.wf-sched-group h5 {
  margin: 0;
  font-size: 12px;
  color: var(--wf-ink);
}

.wf-sched-radios {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wf-sched-radio {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--wf-ink);
  font-size: 11px;
  cursor: pointer;
}

.wf-sched-radio input {
  accent-color: var(--wf-brand);
}

.wf-sched-workspace {
  margin-top: 6px;
  font-variant-numeric: tabular-nums;
}

.wf-sched-dates {
  display: flex;
  gap: 7px;
}

.wf-sched-dates input {
  flex: 1;
  font-variant-numeric: tabular-nums;
}

.wf-sched-dates .wf-btn {
  font-size: 12px;
  padding: 5px 10px;
}

.wf-sched-days {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

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

/* ---- 重复区间编辑 ---- */
.wf-sched-ranges {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wf-sched-ranges .wf-btn.is-ghost {
  align-self: flex-start;
  font-size: 10px;
  padding: 3px 8px;
}

.wf-sched-range-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.wf-sched-range-row input {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--wf-border-strong);
  border-radius: 7px;
  background: var(--wf-layer);
  color: var(--wf-ink);
  padding: 5px 7px;
  outline: 0;
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.wf-sched-range-row input:focus {
  border-color: var(--wf-brand);
}

.wf-sched-range-row .wf-btn {
  padding: 3px 7px;
  font-size: 11px;
}

.wf-sched-row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

/* ---- 任务列表状态 ---- */
.wf-sched-status-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  font-size: 10px;
  color: var(--wf-ink-2);
}

.wf-sched-status-cell {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wf-sched-status-cell.is-error {
  color: var(--wf-err);
  white-space: normal;
  width: 100%;
}

.wf-sched-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--wf-ink-2);
  flex: none;
  display: inline-block;
}

.wf-sched-dot.is-running {
  background: var(--wf-ok);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--wf-ok) 16%, transparent);
}

.wf-sched-dot.is-waiting {
  background: #e6b23c;
}

.wf-sched-dot.is-paused {
  background: var(--wf-ink-2);
}

.wf-sched-dot.is-error {
  background: var(--wf-err);
}

.wf-sched-list-meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 9px;
  color: var(--wf-ink-2);
}

.wf-sched-enabled {
  flex: none;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 14px;
  border-top: 1px solid var(--wf-border);
  color: var(--wf-ink);
  font-size: 11px;
}

.wf-sched-enabled input {
  accent-color: var(--wf-brand);
}

/* ---- 双月日历（样式参考用户日历素材） ---- */
.wf-cal-card {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--wf-border-strong);
  border-radius: 12px;
  background: var(--wf-layer);
  box-shadow: 0 14px 40px color-mix(in srgb, var(--wf-ink) 16%, transparent);
}

.wf-cal-card__foot {
  display: flex;
  justify-content: flex-end;
}

.wf-cal-card__foot .wf-btn {
  font-size: 11px;
  padding: 5px 14px;
}

.wf-cal {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 8px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--wf-bg) 78%, transparent);
}

.wf-cal-month {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.wf-cal-month__head {
  display: grid;
  grid-template-columns: 26px 1fr 26px;
  align-items: center;
  gap: 4px;
  color: var(--wf-ink);
}

.wf-cal-month__title {
  font-size: 13px;
  font-weight: 650;
  text-align: center;
  white-space: nowrap;
}

.wf-cal-nav {
  border: 0;
  background: transparent;
  color: var(--wf-ink-2);
  font-size: 15px;
  line-height: 1;
  padding: 4px;
  cursor: pointer;
  border-radius: 6px;
}

.wf-cal-nav:hover {
  color: var(--wf-ink);
  background: var(--wf-layer-2);
}

.wf-cal-nav.is-placeholder {
  visibility: hidden;
}

.wf-cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.wf-cal-week {
  font-size: 11px;
  font-weight: 650;
  color: var(--wf-ink);
  text-align: center;
  padding: 2px 0;
}

.wf-cal-cell {
  border: 0;
  background: transparent;
  color: var(--wf-ink-2);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  height: 36px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  position: relative;
  cursor: pointer;
  padding: 0;
}

.wf-cal-cell:disabled {
  cursor: default;
}

.wf-cal-cell.is-dim {
  color: var(--wf-ink-3);
}

.wf-cal-cell:not(:disabled):hover .wf-cal-cell__num {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--wf-brand) 55%, transparent);
}

.wf-cal-cell__num {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  position: relative;
  z-index: 1;
  font-size: 12px;
}

.wf-cal-cell.is-start .wf-cal-cell__num,
.wf-cal-cell.is-end .wf-cal-cell__num {
  background: var(--wf-brand);
  color: var(--wf-on-brand);
}

.wf-cal-cell__tag {
  font-size: 7px;
  line-height: 1;
  color: var(--wf-ink-2);
}

.wf-cal-cell.is-start .wf-cal-cell__tag,
.wf-cal-cell.is-end .wf-cal-cell__tag {
  color: var(--wf-brand);
  font-weight: 650;
}

.wf-cal-cell.is-today .wf-cal-cell__num {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--wf-ink) 55%, transparent);
}

/* ---- 自定义时间输入（文本按位 + 双列滑轮，两次点击确认） ---- */
.wf-time {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  position: relative;
  flex: 1;
  min-width: 0;
}

.wf-time__field {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--wf-border-strong);
  border-radius: 7px;
  background: var(--wf-layer);
  color: var(--wf-ink);
  padding: 5px 7px;
  outline: 0;
  font: inherit;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.wf-time__field:focus {
  border-color: var(--wf-brand);
}

.wf-time__clock {
  border: 1px solid var(--wf-border);
  background: var(--wf-layer);
  color: var(--wf-ink-2);
  border-radius: 7px;
  padding: 5px 7px;
  cursor: pointer;
  font-size: 11px;
}

.wf-time__clock:hover {
  border-color: var(--wf-brand);
  color: var(--wf-ink);
}

.wf-time__picker {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 60;
  display: flex;
  gap: 2px;
  margin-top: 4px;
  padding: 6px;
  border: 1px solid var(--wf-border-strong);
  border-radius: 10px;
  background: var(--wf-layer);
  box-shadow: 0 14px 38px color-mix(in srgb, var(--wf-ink) 16%, transparent);
}

.wf-time__col {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 188px;
  overflow: auto;
  scrollbar-width: thin;
  min-width: 46px;
}

.wf-time__opt {
  border: 0;
  background: transparent;
  color: var(--wf-ink-2);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  padding: 5px 8px;
  border-radius: 7px;
  cursor: pointer;
}

.wf-time__opt:hover {
  background: var(--wf-layer-2);
  color: var(--wf-ink);
}

.wf-time__opt.is-active {
  background: var(--wf-brand);
  color: var(--wf-on-brand);
  font-weight: 650;
}
`
