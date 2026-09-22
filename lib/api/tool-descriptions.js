// src/host/api/tool-descriptions.ts
//
// 工具卡片描述（端点响应的展示数据加工）：内置工具中文短描述 + 长度兜底。
// 为什么独立于端点文件：其变化原因（内置工具集合、卡片文案、卡片宽度约束）与
// 端点协议、参数校验完全无关。
//
// 组合管理卡片描述上限（字符）：
// 模型侧工具 description 面向模型可以长（错误码/op 组约束等），但卡片只有几十像素宽：
// 不截断就会把文本挤出卡片边框（2026.09 用户报障）。此处做数据层兜底，客户端另有
// CSS 行数钳制（styles.ts `.wf-combo-card__desc`）与卡片最小高度（`.wf-combo-card`）。
// 取 80：约合卡片内 2 行文本（10px 字号 / 约 200px 内容宽），与卡片最小高度 96px 匹配，
// 保证「名称 + 描述 + 操作按钮」三者在卡片内互不重叠。
export const CARD_DESC_MAX = 80;
/** 内置常用工具中文描述映射（未命中回退原文，英文加 [EN] 前缀）。 */
const TOOL_ZH = {
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
    wf_org_catalog: '只读勘察组织资产（角色/组合/工具/preset/数据源/模板/预算）；仅父代理可用',
    wf_graph_patch: '改写工作流图（图结构 / 元参数 / 里程碑标记，一次补丁仅一组）；仅父代理可用',
};
/**
 * 组合管理卡片描述（纯函数，导出供单测）：
 *   - 命中 TOOL_ZH → 短中文；
 *   - 未命中 → schema 原文（英文加 [EN] 前缀；已是中文则原样）；
 *   - **一律按 CARD_DESC_MAX 截断**（超长描述不得撑破卡片）。
 */
export function zhDescription(name, fallback) {
    const hit = TOOL_ZH[String(name ?? '')];
    let text;
    if (hit) {
        text = hit;
    }
    else {
        const raw = String(fallback ?? '').trim();
        text = !raw ? '（暂无描述）' : (/[\u4e00-\u9fa5]/.test(raw) ? raw : `[EN] ${raw}`);
    }
    return text.length > CARD_DESC_MAX ? `${text.slice(0, CARD_DESC_MAX - 1)}…` : text;
}
//# sourceMappingURL=tool-descriptions.js.map