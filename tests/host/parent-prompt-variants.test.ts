// 父代理提示词三情况组装测试（用户评审新增）：
//   - parentPromptVariantOf：画布形态 → 'orchestrator' | 'hybrid' | 'executor' 判定
//     （含用户补充边界：父代理被流程线连接、其余 agent 均未参与流程 → 仍判 executor，
//      允许画布存在不执行任务的「无关节点」）；
//   - buildParentRunPrompt：三种情况输出整份自洽提示词，身份措辞互斥；
//   - orchestrationNodeList/collabGroupList：只列「参与流程」的执行单元。
import { describe, expect, it } from 'vitest'
import {
  buildParentRunPrompt,
  collabGroupList,
  orchestrationNodeList,
  parentExecutorOf,
  parentPromptVariantOf,
} from '../../src/host/orchestrator/helpers.js'
import type { GraphNode, Line, WorkflowDocument } from '../../src/host/shared/graph-model.js'
import type { ExecutorContextFacts } from '../../src/host/prompts/executor.js'
import { ORCH_HARD_CONSTRAINTS } from '../../src/host/prompts/orchestration.js'

// —— 画布构建小工具（分类测试用；不校验，仅结构）——
function roleNode(id: string, kind: 'parent' | 'agent', label: string): GraphNode {
  return {
    id,
    kind,
    position: { x: 0, y: 0 },
    data: {
      label,
      systemPrompt: '',
      provider: '',
      model: '',
      presetId: null,
      retryLimit: 3,
      reactLimit: null,
      inputSchema: '',
      outputSchema: '',
      groupId: null,
    },
  }
}

function groupNode(id: string, label: string, memberIds: string[]): GraphNode {
  return { id, kind: 'group', position: { x: 0, y: 0 }, data: { label, collabPrompt: '', memberIds, size: { w: 300, h: 220 } } }
}

function proxyNode(id: string, sourceId: string): GraphNode {
  return { id, kind: 'proxy', position: { x: 0, y: 0 }, proxySourceId: sourceId }
}

function stage(id: string, kind: 'start' | 'end'): GraphNode {
  return { id, kind, position: { x: 0, y: 0 }, data: { label: kind } }
}

function flow(nodes: GraphNode[], lines: Line[]): WorkflowDocument {
  return {
    id: 'flow-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '测试流程',
    description: '',
    nodes: [...nodes, stage('start', 'start'), stage('end', 'end')],
    lines,
  }
}

function flowLine(id: string, source: string, target: string): Line {
  return { id, source, target, sourceHandle: 'flow-out', targetHandle: 'flow-in' }
}

function ctxLine(id: string, source: string, target: string): Line {
  return { id, source, target, sourceHandle: 'ctx-out', targetHandle: 'ctx-in' }
}

/** 测试用父代理执行单元上下文（buildParentRunPrompt 的 executor 参数）。 */
function executorOf(nodeId: string, nodeLabel: string): { nodeId: string; nodeLabel: string; task: ExecutorContextFacts; runContextText: string } {
  return {
    nodeId,
    nodeLabel,
    task: { nodeLabel, upstreamContext: [], filePaths: [], dbToolHint: '', isGroupMember: false },
    runContextText: 'runId=run-1; attempt 1/1（父代理执行单元）',
  }
}

describe('parentPromptVariantOf 三情况判定', () => {
  it('情况1：无父代理节点（有 agent 节点）→ orchestrator', () => {
    const f = flow([roleNode('a1', 'agent', '子代理A'), roleNode('a2', 'agent', '子代理B')], [
      flowLine('s-a1', 'start', 'a1'),
      flowLine('a1-end', 'a1', 'end'),
    ])
    expect(parentPromptVariantOf(f)).toBe('orchestrator')
  })

  it('情况1：父代理存在但未参与流程（无 flow 线，或仅 ctx 线）→ orchestrator', () => {
    const unconnected = flow([roleNode('p1', 'parent', '父代理'), roleNode('a1', 'agent', '子代理A')], [flowLine('s-a1', 'start', 'a1')])
    expect(parentPromptVariantOf(unconnected)).toBe('orchestrator')
    const ctxOnly = flow([roleNode('p1', 'parent', '父代理'), roleNode('a1', 'agent', '子代理A')], [ctxLine('p-a1', 'p1', 'a1')])
    expect(parentPromptVariantOf(ctxOnly)).toBe('orchestrator')
  })

  it('情况3：父代理参与流程且其余 agent 均未参与流程（用户补充边界：无关节点）→ executor', () => {
    const f = flow([roleNode('p1', 'parent', '父代理'), roleNode('a1', 'agent', '无关子代理')], [flowLine('s-p1', 'start', 'p1'), flowLine('p1-end', 'p1', 'end')])
    expect(parentPromptVariantOf(f)).toBe('executor')
  })

  it('情况2：父代理参与流程且其他 agent 参与流程 → hybrid', () => {
    const f = flow(
      [roleNode('p1', 'parent', '父代理'), roleNode('a1', 'agent', '子代理A')],
      [flowLine('s-p1', 'start', 'p1'), flowLine('p1-a1', 'p1', 'a1'), flowLine('a1-end', 'a1', 'end')],
    )
    expect(parentPromptVariantOf(f)).toBe('hybrid')
  })

  it('情况2：父代理参与流程且协作组卡片参与流程（成员无需自身连线）→ hybrid', () => {
    const f = flow(
      [roleNode('p1', 'parent', '父代理'), roleNode('m1', 'agent', '组员1'), groupNode('g1', '协作组', ['m1'])],
      [flowLine('s-p1', 'start', 'p1'), flowLine('p1-g1', 'p1', 'g1'), flowLine('g1-end', 'g1', 'end')],
    )
    expect(parentPromptVariantOf(f)).toBe('hybrid')
  })

  it('虚拟节点归属：父代理自身未连但其虚拟节点参与流程 → 判执行者模式（executor）', () => {
    const f = flow(
      [roleNode('p1', 'parent', '父代理'), proxyNode('p1-proxy', 'p1')],
      [flowLine('s-proxy', 'start', 'p1-proxy'), flowLine('proxy-end', 'p1-proxy', 'end')],
    )
    expect(parentPromptVariantOf(f)).toBe('executor')
    expect(parentExecutorOf(f)).toEqual({ nodeId: 'p1', nodeLabel: '父代理' })
  })
})

describe('orchestrationNodeList / collabGroupList 只列参与流程的执行单元', () => {
  it('未参与流程的 agent（无关节点）不进入待编排节点清单', () => {
    const f = flow(
      [roleNode('a1', 'agent', '参与A'), roleNode('a2', 'agent', '无关B')],
      [flowLine('s-a1', 'start', 'a1'), flowLine('a1-end', 'a1', 'end')],
    )
    const list = orchestrationNodeList(f)
    const ids = list.map((entry) => entry.id)
    expect(ids).toContain('a1')
    expect(ids).not.toContain('a2')
  })

  it('未参与流程的协作组卡片不进入协作组清单', () => {
    const f = flow(
      [roleNode('a1', 'agent', '参与A'), roleNode('m1', 'agent', '组员1'), groupNode('g1', '协作组', ['m1'])],
      [flowLine('s-a1', 'start', 'a1'), flowLine('a1-end', 'a1', 'end')],
    )
    expect(collabGroupList(f)).toHaveLength(0)
  })
})

describe('buildParentRunPrompt 三情况整装（身份措辞互斥）', () => {
  it('情况1（无父代理）→ 纯编排指令：含「仅编排」、不含执行者模式（经导出常量引用）', () => {
    const f = flow([roleNode('a1', 'agent', '子代理A')], [flowLine('s-a1', 'start', 'a1'), flowLine('a1-end', 'a1', 'end')])
    const directive = buildParentRunPrompt({ flow: f, defPath: 'orchestrations/run-1.json', mode: 'mode1', executor: null, systemLanguage: '中文' })
    expect(directive).toContain(ORCH_HARD_CONSTRAINTS.dispatchOnly)
    expect(directive).not.toContain(ORCH_HARD_CONSTRAINTS.executorRole)
  })

  it('情况2（hybrid）→ 编排+执行者角色；不含「仅编排」（经导出常量引用）', () => {
    const f = flow(
      [roleNode('p1', 'parent', '父执行'), roleNode('a1', 'agent', '子代理A')],
      [flowLine('s-p1', 'start', 'p1'), flowLine('p1-a1', 'p1', 'a1'), flowLine('a1-end', 'a1', 'end')],
    )
    const directive = buildParentRunPrompt({ flow: f, defPath: 'orchestrations/run-1.json', mode: 'mode1', executor: executorOf('p1', '父执行'), systemLanguage: '中文' })
    expect(directive).toContain(ORCH_HARD_CONSTRAINTS.executorRole)
    expect(directive).not.toContain(ORCH_HARD_CONSTRAINTS.dispatchOnly)
  })

  it('情况3（executor）→ 纯执行提示：无编排/调度语义且含 wf_finish 收尾', () => {
    const f = flow([roleNode('p1', 'parent', '父执行')], [flowLine('s-p1', 'start', 'p1'), flowLine('p1-end', 'p1', 'end')])
    const directive = buildParentRunPrompt({ flow: f, defPath: 'orchestrations/run-1.json', mode: 'mode1', executor: executorOf('p1', '父执行'), systemLanguage: '中文' })
    expect(directive).toContain('wf_finish')
    expect(directive).not.toContain(ORCH_HARD_CONSTRAINTS.dispatchOnly)
    expect(directive).not.toContain('wf_run_node')
  })

  it('续跑边界：hybrid 但父代理执行单元已完成（executor 为 null）→ 按纯编排组装，不再出现自执行任务', () => {
    const f = flow(
      [roleNode('p1', 'parent', '父执行'), roleNode('a1', 'agent', '子代理A')],
      [flowLine('s-p1', 'start', 'p1'), flowLine('p1-a1', 'p1', 'a1'), flowLine('a1-end', 'a1', 'end')],
    )
    const directive = buildParentRunPrompt({
      flow: f,
      defPath: 'orchestrations/run-1.json',
      mode: 'mode1',
      executor: null,
      resume: { resumeFromNodeId: 'a1', resumedFromRunId: 'run-0' },
      systemLanguage: '中文',
    })
    expect(directive).toContain(ORCH_HARD_CONSTRAINTS.dispatchOnly)
    expect(directive).not.toContain(ORCH_HARD_CONSTRAINTS.executorRole)
    // 恢复数据（动态值，非提示词文案）透传入末段
    expect(directive).toContain('run-0')
  })
})