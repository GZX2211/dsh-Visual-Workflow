// src/host/prompts/orchestration-change.ts
//
// 运行期「编排变更」通知文案构建器（纯函数）：
//   用户在**运行中**保存了当前实例画布，且这次保存改变了编排语义（新增/删除/
//   修改了节点或连线，见 orchestrator/flow-diff.ts）时，由宿主向父代理注入本通知，
//   让父代理重新读取最新事实源并调整后续编排。
//
// 设计要点：
//   - 明确标注为「编排变更」系统通知，避免父代理误认为是用户的新指令（用户要求）；
//   - 只给事实源路径，不内联整份拓扑（文件即事实源，避免两套来源漂移）；
//   - 纯函数：不读时钟/随机源，同一入参输出字节相同（架构文档 §13）。
import { systemLanguageRule } from './node-task.js';
/** 编排变更通知标题标记（父代理与单测据此识别消息性质）。 */
export const ORCH_CHANGE_MARKER = '【编排变更】';
/**
 * 组装「编排变更」通知文本（纯函数）。
 * 通知本身不是新任务：只要求父代理重读最新事实源并按新拓扑调整后续调度。
 */
export function buildOrchestrationChangeText(params) {
    const language = String(params.systemLanguage ?? '').trim();
    const lines = [
        `${ORCH_CHANGE_MARKER}用户刚刚保存了正在运行的工作流「${params.workflowName}」的画布，编排定义已更新。`,
        '',
        '这是运行期的编排变更通知（系统发出），不是用户的新指令，也不是新的任务：请勿据此重复汇报或重启已完成的步骤。',
        '',
        `最新事实源文件：${params.definitionPath}`,
        '请重新读取该文件，获取最新的节点列表与连线语义，并据此调整后续编排：',
        '- 尚未执行的部分按最新拓扑与配置调度；',
        '- 已完成的节点不要重跑、不要重复调度；',
        '- 若最新拓扑已取消原本待执行的分支，直接跳过该分支。',
    ];
    if (language)
        lines.push('', `${systemLanguageRule(language)}。`);
    return lines.join('\n');
}
//# sourceMappingURL=orchestration-change.js.map