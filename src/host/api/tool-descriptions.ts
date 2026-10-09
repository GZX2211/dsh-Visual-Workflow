// src/host/api/tool-descriptions.ts
//
// 工具卡片描述（端点响应的展示数据加工）：内置工具中/英短描述 + 语言选择 + 长度兜底。
// 为什么独立于端点文件：其变化原因（内置工具集合、卡片文案、卡片宽度约束）与
// 端点协议、参数校验完全无关。
//
// 组合管理卡片描述上限（字符）：
// 模型侧工具 description 面向模型可以长（错误码/op 组约束等），但卡片只有几十像素宽：
// 不截断就会把文本挤出卡片边框（2026.09 用户报障）。此处做数据层兜底，客户端另有
// CSS 行数钳制（client styles/combo.ts `.wf-combo-card__desc`）与卡片最小高度（`.wf-combo-card`）。
// 取 80：约合卡片内 2 行文本（10px 字号 / 约 200px 内容宽），与卡片最小高度 96px 匹配，
// 保证「名称 + 描述 + 操作按钮」三者在卡片内互不重叠。
export const CARD_DESC_MAX = 80

/** 内置常用工具中文描述映射（未命中回退原文，英文加 [EN] 前缀；导出供单测做中/英键对称门禁）。 */
export const TOOL_ZH: Record<string, string> = {
  read: '读取文件内容（支持多种编码与行区间）',
  write: '创建或整体替换文件内容',
  edit: '对已有文件做精确的局部文本替换',
  bash: '在沙箱中执行 shell 命令',
  run_code: '在代码运行时中执行一段代码',
  str_replace_editor: '代码/文本编辑器：查看、替换、插入、撤销（简单模式专用，非该模式禁止勾选）',
  glob: '按通配符模式查找文件路径',
  grep: '在文件内容中按正则搜索并返回匹配行',
  todo_write: '维护并更新结构化任务清单',
  pwsh: '执行 PowerShell 命令',
  ask_user_question: '向用户提问并等待答复',
  web_search: '联网搜索当前信息',
  ssh_exec: '在配置的 SSH 主机上执行远程命令',
  ssh_list: '列出已配置的 SSH 主机',
  ssh_upload: '上传本地文件到 SSH 主机',
  ssh_download: '从 SSH 主机下载文件到本地',
  ssh_tunnel: '管理本地端口转发隧道',
  ssh_cluster: '在多台 SSH 主机上并发执行同一命令',
  list_agents: '列出可继续交互的后台子代理',
  send_message: '向后台子代理发送消息继续对话',
  interrupt_agent: '请求取消后台子代理当前回合',
  subagent: '委派自包含任务给子代理处理',
  workflow: '运行多子代理编排工作流脚本',
  // —— dsh-visual-workflow 自有工具：卡片用短中文，模型侧 schema 描述（英文）不受影响 ——
  wf_run_node: '启动节点子代理（异步非阻塞；父代理编排用）',
  wf_run_node_wait: '启动节点子代理并等待其完成（模式二服务用）',
  wf_finish: '结束工作流运行并释放运行锁',
  wf_ask: '子代理向主会话用户提问（官网提问卡）',
  wf_ask_agent: '代理间阻塞通信（ask / reply / resolve）',
  wf_db_query: '数据库三模式访问（search / query / schema；需 db-in 连线）',
  wf_org_catalog: '只读勘察组织资产（编排规则/资产/组合/preset/模型），可按需召回详情；仅父代理可用',
  wf_graph_patch: '改写工作流图（图结构 / 里程碑标记，一次补丁仅一组）；仅父代理可用',
  wf_experience_learn: '提交主体自己的经验候选入库；空数组调用取生成 Prompt',
  wf_experience_recall: '按主体类型语义召回既有经验（先取候选摘要，再按 id 取全文）',
  wf_experience_feedback: '提交已使用经验的四维评价（任务收尾阶段，与经验学习同阶段）',
}

/** 内置常用工具英文描述映射（与 TOOL_ZH 同键；未命中回退 schema 原文，不加 [EN] 前缀）。 */
export const TOOL_EN: Record<string, string> = {
  // —— 英文短描述（与 TOOL_ZH 同键；非中文界面取此表，命中即不再回退 schema 原文）——
  read: 'Read file contents (multiple encodings and line ranges)',
  write: 'Create or fully replace a file',
  edit: 'Exact partial text replacement in an existing file',
  bash: 'Run shell commands in the sandbox',
  run_code: 'Run a code snippet in the code runtime',
  str_replace_editor: 'Code/text editor: view, replace, insert, undo (simple mode only)',
  glob: 'Find file paths by glob pattern',
  grep: 'Regex-search file contents and return matching lines',
  todo_write: 'Maintain and update the structured task list',
  pwsh: 'Run PowerShell commands',
  ask_user_question: 'Ask the user a question and wait for the answer',
  web_search: 'Search the web for current information',
  ssh_exec: 'Run a remote command on a configured SSH host',
  ssh_list: 'List configured SSH hosts',
  ssh_upload: 'Upload a local file to an SSH host',
  ssh_download: 'Download a file from an SSH host',
  ssh_tunnel: 'Manage local port-forwarding tunnels',
  ssh_cluster: 'Run one command concurrently on multiple SSH hosts',
  list_agents: 'List continuable background subagents',
  send_message: 'Send a message to a background subagent',
  interrupt_agent: 'Request cancellation of a subagent turn',
  subagent: 'Delegate a self-contained task to a subagent',
  workflow: 'Run a multi-subagent orchestration workflow script',
  // —— dsh-visual-workflow 自有工具：卡片短英文；模型侧 schema 描述（英文）不受影响 ——
  wf_run_node: 'Start a node subagent (async, non-blocking; parent orchestration)',
  wf_run_node_wait: 'Start a node subagent and wait for it (mode 2 services)',
  wf_finish: 'Finish the workflow run and release the run lock',
  wf_ask: 'Child agent asks the main-session user (official question card)',
  wf_ask_agent: 'Blocking agent-to-agent messaging (ask / reply / resolve)',
  wf_db_query: 'Three-mode database access (search / query / schema; needs a db-in edge)',
  wf_org_catalog: 'Read-only survey of org assets; recall details on demand; parent only',
  wf_graph_patch: 'Rewrite the workflow graph (structure / milestone marking); parent only',
  wf_experience_learn: 'Submit your own experience candidates; empty array fetches the prompt',
  wf_experience_recall: 'Recall existing experiences by subject type; then read full entries by id',
  wf_experience_feedback: 'Rate the experiences you used (four dimensions; task wrap-up stage)',
}

/**
 * 组合管理卡片描述（纯函数，导出供单测）：
 *   - 中文界面：命中 TOOL_ZH → 短中文；未命中 → schema 原文（英文加 [EN] 前缀标记
 *     「这条不是中文」，已是中文则原样）；空描述 → 中文占位。
 *   - 非中文界面：命中 TOOL_EN → 短英文；未命中 → schema 原文（不加 [EN] 前缀——
 *     该前缀只在中文界面里表达「未翻译」）；空描述 → 英文占位。
 *   - **一律按 CARD_DESC_MAX 截断**（超长描述不得撑破卡片）。
 * @param chinese - 是否用中文呈现（由 API 边界的 isChinesePresentation 判定）。
 */
export function toolCardDescription(name: string, fallback: string, chinese: boolean): string {
  const hit = (chinese ? TOOL_ZH : TOOL_EN)[String(name ?? '')]
  let text: string
  if (hit) {
    text = hit
  } else {
    const raw = String(fallback ?? '').trim()
    if (chinese) text = !raw ? '（暂无描述）' : (/[\u4e00-\u9fa5]/.test(raw) ? raw : `[EN] ${raw}`)
    else text = raw || 'No description'
  }
  return text.length > CARD_DESC_MAX ? `${text.slice(0, CARD_DESC_MAX - 1)}…` : text
}
