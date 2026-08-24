// src/client/i18n.ts
//
// 中英文案与语言解析（适配新项目数据模型：角色/文件/数据库模板、工作流/服务、
// mode1/mode2、浮窗入口）。注册进官方 locale 服务的命名空间 visualWorkflow；
// 无 locale 服务时按浏览器语言回退。

export const zh = {
  // 浮窗入口
  fabOpen: '打开工作台',
  windowTitle: '可视化工作流工作台',
  windowMinimize: '收起',
  windowClose: '关闭',
  // 工作台
  studio: '工作流设计器',
  badge: '可视化编排',
  note: '拖拽卡片 · 连线编排 · 一键运行',
  ready: '就绪',
  noSession: '当前会话不可用，请先在对话区发送一条消息',
  libTab: { workflow: '工作流', role: '角色', file: '文件', database: '数据库' },
  libWorkflowEmpty: '暂无工作流，点击 + 新建',
  libRoleEmpty: '暂无角色模板，点击 + 新建',
  libFileEmpty: '暂无文件模板，点击 + 新建',
  libDatabaseEmpty: '暂无数据库模板，点击 + 新建',
  canvasEmpty: '从左侧拖拽卡片开始编排',
  inspectorEmpty: '从左侧选择卡片或点击画布节点进行编辑',
  currentSession: '当前会话',
  mode1: '编排执行',
  mode2: '后台服务',
  statusRunning: '运行中',
  statusCrashed: '已崩溃',
  statusStopped: '已停止',
  toastSaved: '已保存',
  toastDeleted: '已删除',
  toastRunning: '运行已开始',
  toastStopped: '运行已停止',
  // 模板
  newTemplate: '新建',
  templateKindRole: '角色模板',
  templateKindFile: '文件模板',
  templateKindDatabase: '数据库模板',
  // 工作流
  newWorkflow: '新建工作流',
  workflowName: '工作流名称',
  workflowDescription: '描述',
  save: '保存',
  delete: '删除',
  run: '运行',
  stop: '停止',
  history: '运行历史',
  // 服务
  services: '服务',
  serviceStart: '启动服务',
  serviceStop: '停止服务',
  serviceStatus: '服务状态',
  // 通用
  undo: '撤销',
  redo: '重做',
  tidy: '整理布局',
  fitView: '全图',
  loading: '加载中…',
  confirmDelete: '确定删除？',
}

export type Dict = typeof zh

export const en: Dict = {
  fabOpen: 'Open workspace',
  windowTitle: 'Visual Workflow Workspace',
  windowMinimize: 'Minimize',
  windowClose: 'Close',
  studio: 'Workflow Studio',
  badge: 'Visual orchestration',
  note: 'Drag cards · connect · run',
  ready: 'Ready',
  noSession: 'No active session; send a message in the conversation first',
  libTab: { workflow: 'Workflows', role: 'Roles', file: 'Files', database: 'Databases' },
  libWorkflowEmpty: 'No workflows yet — click + to create',
  libRoleEmpty: 'No role templates yet — click + to create',
  libFileEmpty: 'No file templates yet — click + to create',
  libDatabaseEmpty: 'No database templates yet — click + to create',
  canvasEmpty: 'Drag cards from the left to start',
  inspectorEmpty: 'Pick a card on the left or a canvas node to edit',
  currentSession: 'Current session',
  mode1: 'Orchestration',
  mode2: 'Service',
  statusRunning: 'Running',
  statusCrashed: 'Crashed',
  statusStopped: 'Stopped',
  toastSaved: 'Saved',
  toastDeleted: 'Deleted',
  toastRunning: 'Run started',
  toastStopped: 'Run stopped',
  newTemplate: 'New',
  templateKindRole: 'Role template',
  templateKindFile: 'File template',
  templateKindDatabase: 'Database template',
  newWorkflow: 'New workflow',
  workflowName: 'Workflow name',
  workflowDescription: 'Description',
  save: 'Save',
  delete: 'Delete',
  run: 'Run',
  stop: 'Stop',
  history: 'Run history',
  services: 'Services',
  serviceStart: 'Start service',
  serviceStop: 'Stop service',
  serviceStatus: 'Service status',
  undo: 'Undo',
  redo: 'Redo',
  tidy: 'Tidy layout',
  fitView: 'Fit view',
  loading: 'Loading…',
  confirmDelete: 'Delete?',
}

/** 语言词典选择（zh 前缀命中中文，其余英文）。 */
export function text(language: string | null | undefined): Dict {
  return String(language ?? '').toLowerCase().startsWith('zh') ? zh : en
}

/** 从 locale 服务/浏览器解析语言码（防御式）。 */
export function detectLanguage(locale: unknown, navigatorLanguage?: string): string {
  if (typeof locale === 'string' && locale) return locale
  if (locale && typeof locale === 'object') {
    const entry = locale as { getLocale?(): { active?: unknown }; getSnapshot?(): { active?: unknown }; active?: unknown }
    const active = entry.getLocale?.().active ?? entry.getSnapshot?.().active ?? entry.active
    if (typeof active === 'string' && active) return active
  }
  return navigatorLanguage ?? (typeof navigator !== 'undefined' ? navigator.language : 'en')
}
