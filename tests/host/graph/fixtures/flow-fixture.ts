// tests/host/graph/fixtures/flow-fixture.ts
//
// 图模型/校验测试共用的最小工作流工厂（避免各测试文件重复拼装文档）。
// 只做形状装配：不归一化、不校验，便于测试自行构造非法用例。

import type { GraphNode, WorkflowDocument } from '../../../../src/host/shared/graph-model.js'

/** 组装最小工作流（mode 可选，默认 mode1）。 */
export function makeFlow(
  nodes: GraphNode[],
  lines: WorkflowDocument['lines'] = [],
  mode: 'mode1' | 'mode2' = 'mode1',
): Partial<WorkflowDocument> {
  return { id: 'f1', sessionId: 's1', mode, name: 't', description: '', nodes, lines }
}
