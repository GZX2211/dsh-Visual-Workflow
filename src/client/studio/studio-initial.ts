// src/client/studio/studio-initial.ts
//
// 工作台状态机的起点：撤销栈上限、初始面板几何与完整初始状态工厂
// （会话 id 由调用方注入）。reducer 的 HISTORY_PUSH 与 hooks 装配消费。

import type { PanelLayout, StudioState } from './studio-types.js'

/** 撤销重做栈上限（旧项目 HISTORY_LIMIT）。 */
export const HISTORY_LIMIT = 60

/** 初始面板几何：默认「左栏展开」（折叠切换循环位置 0），右侧属性栏默认隐藏（由选中推导）。 */
export function defaultPanels(): PanelLayout {
  return { mode: 0, leftWidth: 236, rightWidth: 300, bottomHeight: 180 }
}

/** 初始状态（会话 id 由调用方注入）。 */
export function createInitialState(sessionId: string): StudioState {
  return {
    sessionId,
    libTab: 'workflow',
    mode: 'mode1',
    workflows: [],
    services: [],
    activeRuns: [],
    instanceOptions: { newSession: false, workspacePath: '' },
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
    run: { runId: null, sessionId: null, snapshot: null },
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
