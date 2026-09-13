// src/host/graph/invariants-types.ts
//
// 图检查器（自主编排方案 §6.1/§6.2）的类型契约：
//   - IssueLevel / GraphIssue：检查器问题记录（稳定 code + 级别 + 中文 message +
//     可选定位 + 修复建议）；
//   - CheckGraphInput：检查器入参（图 + 元参数 + 来源 + 可选增量幅度）；
//   - IssueCodeInfo / GRAPH_INVARIANT_CODES：**code 全集注册表**（code/级别/中文说明），
//     供实现与测试逐条对照（测试遍历该表确保每个 code 至少一例）。
// 纯类型 + 常量表（无 IO、无时钟），可在 host 单测与客户端预算展示侧复用。
/**
 * 检查器 code 全集（自主编排方案 §6.2 规则表逐条对应）。
 * 新增规则必须同步登记本表——测试会遍历它，确保每条规则至少一例覆盖。
 */
export const GRAPH_INVARIANT_CODES = [
    // —— 用户明确要求的（a–e） ——
    { code: 'startRequired', level: 'error', description: '恰好 1 个启动/输入节点' },
    { code: 'startNoFlowOut', level: 'error', description: '启动节点的流程出 ≥1 且目标为可执行单元（agent/parent/group）' },
    { code: 'endRequired', level: 'error', description: '恰好 1 个结束/输出节点' },
    { code: 'endNoFlowIn', level: 'error', description: '结束节点的流程入 ≥1 且来源为可执行单元' },
    { code: 'orphanNode', level: 'error', description: '节点既无流程线也无上下文/数据库线（悬空节点）' },
    { code: 'conditionMissingOpposite', level: 'warning', description: '同一源+同一流程出的条件线缺少相对分支（有通过无不通或反之）' },
    { code: 'groupNoMembers', level: 'error', description: '协作组没有成员' },
    { code: 'groupMemberMissing', level: 'error', description: '协作组成员 id 不在画布节点集合中' },
    { code: 'groupNoFlow', level: 'error', description: '协作组卡片没有任何流程线' },
    // —— 补充规则（f–p） ——
    { code: 'flowCycle', level: 'error', description: '流程子图存在多节点环' },
    { code: 'proxySourceMissing', level: 'error', description: '虚拟节点引用的主节点不存在或不是角色节点' },
    { code: 'unreachableFromStart', level: 'error', description: '有流程入但从启动节点沿流程不可达（孤岛段）' },
    { code: 'cannotReachEnd', level: 'warning', description: '有流程入但无流程出且不是结束节点（断头流程）' },
    { code: 'dataNodeIncomplete', level: 'error', description: '数据节点缺少运行必需配置（数据库无路径/连接；受管文件无文件）' },
    { code: 'ctxSourceInvalid', level: 'error', description: '上下文入线的来源不是角色/文件/输入节点' },
    { code: 'dbLineTargetInvalid', level: 'error', description: '数据库出线的目标不是数据库节点' },
    { code: 'pauseNodeDangling', level: 'error', description: '暂停节点缺少流程入或流程出' },
    { code: 'startHasFlowIn', level: 'error', description: '启动节点存在流程入线（方向违规）' },
    { code: 'endHasFlowOut', level: 'error', description: '结束节点存在流程出线（方向违规）' },
    { code: 'milestoneProxyInvalid', level: 'warning', description: '指向父代理的虚拟节点缺少流程入口，或闸门数超过元参数上限' },
    { code: 'metaLimitExceeded', level: 'error', description: '规模/幅度超过元参数上限（仅 origin=agent）' },
    { code: 'metaBelowMin', level: 'warning', description: '规模低于元参数下限（仅提示，不阻断）' },
    { code: 'duplicateRoleLabel', level: 'warning', description: '多个可执行节点的名称相同或高度相似（服务「最少子代理数」）' },
    { code: 'nodeNoUpstream', level: 'warning', description: '可执行节点被流程驱动但没有任何输入通道（无 ctx / file / db 入线）' },
    { code: 'roleNodeNoPreset', level: 'warning', description: '角色节点未配置工具组合（presetId 为空 = 运行期零工具）' },
    { code: 'roleNodeNoPrompt', level: 'warning', description: '角色节点未配置 System Prompt' },
    { code: 'namingConvention', level: 'warning', description: '节点名称未满足元参数约定的命名规则' },
];
/** code → 说明的反查表（文档与测试断言用）。 */
export function invariantCodeInfo(code) {
    return GRAPH_INVARIANT_CODES.find((item) => item.code === code) ?? null;
}
//# sourceMappingURL=invariants-types.js.map