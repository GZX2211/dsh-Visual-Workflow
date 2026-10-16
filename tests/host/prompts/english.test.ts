// tests/host/prompts/english.test.ts
//
// Generated English instructions preserve tool contracts, user content and prefix stability.
import { describe, expect, it } from 'vitest'
import {
  buildOrchestratorPrompt, buildHybridPrompt, buildNodeTaskBlock, buildParentTaskSpec,
  buildParentExecutorPrompt, buildCollabBlock, buildOrgBudgetText, buildOrchestrationChangeText,
  buildOrgPlanPrompt, defaultOutputContractOf,
} from '../../../src/host/prompts/index.js'
import { EN_PROMPT_MARKERS as M, EN_ORCH_CONSTRAINTS as C, EN_DEFAULT_OUTPUT_CONTRACT } from '../../../src/host/prompts/index.js'
import { normalizeOrgMeta, orgBudgetOf, orgUsageOf } from '../../../src/host/graph/index.js'
import type { WorkflowDocument } from '../../../src/host/shared/graph-model.js'

const facts = { workflowName: 'Instagram Post Helper', workflowGoal: 'Prepare a post', definitionPath: '/workflow/run.json',
  nodes: [{ id: 'writer', label: 'Writer' }], collabGroups: [], systemLanguage: 'English' }
const node = { nodeLabel: 'Writer', upstreamContext: [], filePaths: [], dbToolHint: '', isGroupMember: false,
  inputContract: '', outputContract: EN_DEFAULT_OUTPUT_CONTRACT, outputContractDefaulted: true, systemLanguage: 'English' }

function englishOnly(text: string): void {
  expect(text).not.toMatch(/[\u3400-\u9fff]/)
}

describe('English generated prompts', () => {
  it.each([buildOrchestratorPrompt, buildHybridPrompt])('preserves finish/failure constraints at both ends and a stable prefix', build => {
    const initial = build({ facts, dynamic: {} })
    const resumed = build({ facts, dynamic: { isResume: true, resumeFromNodeId: 'writer', resumedFromRunId: 'run-1', pauseNodeIds: ['pause'] } })
    expect(initial).toBe(build({ facts, dynamic: {} }))
    expect(initial.split(M.tail)[0]).toBe(resumed.split(M.tail)[0])
    for (const text of [initial, resumed]) {
      englishOnly(text)
      const [head, tail] = text.split(M.tail)
      for (const constraint of [C.finishIdempotent, C.failureSemantics]) {
        expect(head).toContain(constraint)
        expect(tail).toContain(constraint)
      }
      expect(text).toContain('Use English')
      expect(text).toContain(facts.definitionPath)
      expect(text).toContain('wf_graph_patch')
    }
  })

  it('renders both collaboration channels without losing member IDs or tool names', () => {
    for (const channel of ['official', 'legacy'] as const) {
      const text = buildCollabBlock({ members: [{ id: 'a', label: 'Writer', target: 'writer-1' }], custom: '', channel, systemLanguage: 'English' })
      englishOnly(text)
      expect(text).toContain(channel === 'official' ? 'send_message' : 'wf_ask_agent')
      expect(text).toContain(channel === 'official' ? 'writer-1' : 'id: a')
      englishOnly(buildNodeTaskBlock({ facts: { ...node, isGroupMember: true, collabChannel: channel } }))
    }
  })

  it('uses an English default handoff and preserves custom content verbatim', () => {
    expect(defaultOutputContractOf('English')).toBe(EN_DEFAULT_OUTPUT_CONTRACT)
    const text = buildNodeTaskBlock({ facts: node })
    englishOnly(text)
    expect(text).toContain(EN_DEFAULT_OUTPUT_CONTRACT)
    const custom = '自定义结构 {caption: string}'
    const context = '用户提供的上下文'
    const authored = buildNodeTaskBlock({ facts: { ...node, inputContract: custom, outputContract: custom,
      outputContractDefaulted: false, upstreamContext: [{ source: 'Research', content: context }] } })
    expect(authored).toContain(custom)
    expect(authored).toContain(context)
    expect(authored).not.toContain(EN_DEFAULT_OUTPUT_CONTRACT)
  })

  it('localizes hybrid task sections and standalone executor instructions', () => {
    const task = buildParentTaskSpec({ facts: node, runContextText: 'run-1', systemLanguage: 'English' })
    const executor = buildParentExecutorPrompt({ workflowName: facts.workflowName, facts: node, runContextText: 'run-1', systemLanguage: 'English' })
    englishOnly(task)
    englishOnly(executor)
    expect(task).toContain('Writer')
    expect(executor).toContain('wf_finish')
    expect(executor).not.toContain('wf_run_node')
  })

  it('localizes budget, graph-change and planning instructions', () => {
    const flow = { nodes: [], lines: [] } as unknown as WorkflowDocument
    const budget = buildOrgBudgetText(orgBudgetOf(normalizeOrgMeta({}), orgUsageOf(flow)), 'English')
    englishOnly(budget)
    const change = buildOrchestrationChangeText({ workflowName: facts.workflowName, definitionPath: facts.definitionPath, systemLanguage: 'English' })
    englishOnly(change)
    expect(change).toContain('[Orchestration changed]')
    expect(change).toContain(facts.definitionPath)
    for (const target of ['create', 'template', 'instance'] as const) {
      const plan = buildOrgPlanPrompt({ facts: { target, targetName: 'Posts', targetId: 'p1', systemLanguage: 'English' }, dynamic: { userIntent: 'Plan posts' } })
      englishOnly(plan)
      expect(plan).toContain('wf_graph_patch')
      expect(plan).toContain('wf_org_catalog')
      expect(plan).toContain('Plan posts')
    }
  })
})

describe('English prompt context branches', () => {
  it.each(['official', 'legacy'] as const)('hybrid %s collaboration keeps group IDs and self-execution instructions', channel => {
    const text = buildHybridPrompt({ facts: { ...facts, collabChannel: channel,
      parentNode: { nodeId: 'lead', nodeLabel: 'Lead' },
      collabGroups: [{ groupId: 'team', label: 'Writing team', memberIds: ['writer', 'reviewer'] }] },
      dynamic: { parentTaskBlock: 'Review the final post', question: 'Prepare a caption', runParamsText: 'mode2', orgBudgetText: 'Budget: 2 nodes' } })
    englishOnly(text)
    expect(text).toContain(C.executorRole)
    expect(text).toContain('id=lead')
    expect(text).toContain('writer, reviewer')
    expect(text).toContain('Review the final post')
    expect(text).toContain(channel === 'official' ? 'spawn_teammate' : 'in parallel')
  })

  it('node contexts retain files, database hints and upstream output', () => {
    const text = buildNodeTaskBlock({ facts: { ...node, filePaths: ['/data/brief.pdf'], dbToolHint: 'Use wf_db_query',
      upstreamContext: [{ source: 'Research', content: 'Audience: designers' }], isGroupMember: true } })
    englishOnly(text)
    expect(text).toContain('/data/brief.pdf')
    expect(text).toContain('Audience: designers')
    expect(text).toContain('wf_db_query')
    expect(text).toContain('wf_ask_agent')
    englishOnly(buildCollabBlock({ members: [], custom: '', systemLanguage: 'English' }))
    englishOnly(buildParentExecutorPrompt({ workflowName: 'Posts', facts: { ...node, isGroupMember: true }, runContextText: '', systemLanguage: 'English' }))
  })
})
