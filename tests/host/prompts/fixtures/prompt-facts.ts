// tests/host/prompts/fixtures/prompt-facts.ts
//
// 提示词基线测试的稳定 facts（同一构建内字节稳定的静态事实）。
// 供编排 / 执行者 / 节点任务块三组基线的构建器入参复用。

/** 编排父代理 facts（情况1 纯编排 / 情况2 编排+自执行）。 */
export const orchFacts = {
  workflowName: '示例工作流',
  workflowGoal: '演示编排指令基线',
  definitionPath: 'orchestrations/run-abc123.json',
  nodes: [
    { id: 'node-a', label: '分析节点' },
    { id: 'node-b', label: '总结节点' },
  ],
  collabGroups: [{ groupId: 'group-1', label: '协作组一', memberIds: ['node-a', 'node-b'] }],
  systemLanguage: '中文',
}

/** 节点任务块 facts（子代理侧与父代理执行单元共用）。 */
export const nodeFacts = {
  nodeLabel: '总结节点',
  upstreamContext: [{ source: 'node-a', content: '这是上游节点产出的一段很长的摘要内容。' }],
  filePaths: ['data/files/example.pdf'],
  dbToolHint: '已连接数据库节点：d1（产品库）。只可通过 wf_db_query 访问。',
  isGroupMember: false,
  inputContract: '',
  outputContract: '',
  outputContractDefaulted: false,
  systemLanguage: '中文',
}
