// src/client/studio/studio-initial.ts
//
// 工作台状态机的起点：撤销栈上限、初始面板几何与完整初始状态工厂
// （会话 id 由调用方注入）。reducer 的 HISTORY_PUSH 与 hooks 装配消费。

import type { PanelLayout, StudioState } from './studio-types.js'

/** 撤销重做栈上限（旧项目 HISTORY_LIMIT）。 */
export const HISTORY_LIMIT = 60

/** 初始面板几何。 */
export function defaultPanels(): PanelLayout {
  return { leftOpen: true, leftWidth: 236, rightOpen: true, rightWidth: 300 }
}

/** 初始状态（会话 id 由调用方注入）。 */
export function createInitialState(sessionId: string): StudioState {
  return {
    sessionId,
    libTab: 'workflow',
    mode: 'mode1',
    workflows: [],
    services: [],
    flowTemplates: [],
    templates: { role: [], file: [], database: [], group: [] },
    combos: [],
    presets: [],
    tools: [],
    models: [],
    currentId: null,
    currentKind: null,
    canvas: { nodes: [], edges: [] },
    selection: { nodeId: null, edgeId: null, lib: null },
    editor: null,
    dirty: false,
    savedGraph: null,
    run: { runId: null, snapshot: null },
    toasts: [],
    message: '',
    history: { past: [], future: [] },
    panels: defaultPanels(),
    confirm: null,
    historyOpen: false,
    runHistory: [],
    selectedRunId: null,
    comboOpen: false,
    schedulerOpen: false,
  }
}
