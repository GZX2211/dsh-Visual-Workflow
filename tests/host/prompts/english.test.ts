// tests/host/prompts/english.test.ts
//
// 英文提示词选择：同一批构建器切换到英文正文，保留工具契约与用户内容，并只本地化
// 插件自有的默认输出契约。

import { describe, expect, it } from 'vitest'
import {
  buildHybridPrompt,
  buildNodeTaskBlock,
  buildOrgPlanPrompt,
  buildOrchestratorPrompt,
  buildParentExecutorPrompt,
  buildParentTaskSpec,
  defaultOutputContractOf,
  localizeOutputContract,
  orchestrationChangeTextOf,
} from '../../../src/host/prompts/index.js'
import { dbToolHintOf } from '../../../src/host/orchestrator/index.js'
import { newDatabaseNode, newRoleNode } from '../../../src/host/graph/index.js'
import { DEFAULT_OUTPUT_CONTRACT_TEXT } from '../../../src/host/shared/protocol.js'
import type { ExecutorContextFacts, OrchestrationDirectiveParams } from '../../../src/host/prompts/index.js'
import type { DatabaseNode, WorkflowDocument } from '../../../src/host/shared/graph-model.js'

/** 英文纯净性检查：插件自有指令正文不得残留中文。 */
function englishOnly(text: string): void {
  expect(text).not.toMatch(/[\u3400-\u9fff]/)
}

const context: ExecutorContextFacts = {
  nodeLabel: 'Writer',
  upstreamContext: [{ nodeId: 'research', source: 'Research', content: 'Audience: designers' }],
  dbToolHint: 'Use wf_db_query',
}

const orchestrationFacts: OrchestrationDirectiveParams['facts'] = {
  workflowName: 'Instagram Post Helper',
  workflowGoal: 'Prepare an Instagram post',
  collabGroups: [{ groupId: 'team', label: 'Writing team', memberIds: ['writer', 'reviewer'] }],
  parentNode: { nodeId: 'lead', nodeLabel: 'Lead' },
  systemLanguage: 'English',
}

describe('英文父代理提示词', () => {
  it.each([
    ['orchestrator', () => buildOrchestratorPrompt({ facts: orchestrationFacts, dynamic: {} })],
    ['hybrid', () => buildHybridPrompt({ facts: orchestrationFacts, dynamic: { parentTaskBlock: 'Review the final post' } })],
  ] as const)('%s 保留编排事实并使用英文指令', (_variant, build) => {
    const text = build()
    englishOnly(text)
    expect(text).toContain('Instagram Post Helper')
    expect(text).toContain('Writing team')
    expect(text).toContain('wf_org_catalog')
    expect(text).toContain('wf_send_message')
    expect(text).toContain('wf_finish')
  })

  it('纯执行与情况2任务节使用英文过程事实', () => {
    const task = buildParentTaskSpec({ facts: context, runContextText: 'run-1', systemLanguage: 'English' })
    const executor = buildParentExecutorPrompt({
      workflowName: 'Instagram Post Helper',
      facts: context,
      runContextText: 'run-1',
      systemLanguage: 'English',
    })
    englishOnly(task)
    englishOnly(executor)
    expect(task).toContain('Audience: designers')
    expect(executor).not.toContain('wf_send_message')
    expect(executor).not.toContain('wf_run_node')
  })
})

describe('英文子代理任务块', () => {
  const facts = {
    nodeLabel: 'Writer',
    upstreamContext: context.upstreamContext,
    dbToolHint: '',
    commTargets: [{ label: 'Parent', id: 'parent' }],
    collabNote: '',
    inputContract: '',
    outputContract: DEFAULT_OUTPUT_CONTRACT_TEXT,
    systemLanguage: 'English',
  }

  it('本地化中文规范默认输出契约，同时保留用户内容', () => {
    const text = buildNodeTaskBlock({ facts })
    englishOnly(text)
    expect(text).toContain('Conclusion / Output file paths / Key decisions / Open questions')
    expect(text).toContain('Audience: designers')

    const custom = buildNodeTaskBlock({
      facts: { ...facts, inputContract: '自定义输入 {query: string}', outputContract: '自定义输出 {result: string}' },
    })
    expect(custom).toContain('自定义输入 {query: string}')
    expect(custom).toContain('自定义输出 {result: string}')
    expect(custom).not.toContain('Conclusion / Output file paths / Key decisions / Open questions')
  })

  it('默认契约与自定义契约在提示词边界按语言解析', () => {
    expect(defaultOutputContractOf('English')).toBe('Conclusion / Output file paths / Key decisions / Open questions')
    expect(defaultOutputContractOf('中文')).toBe(DEFAULT_OUTPUT_CONTRACT_TEXT)
    expect(localizeOutputContract(DEFAULT_OUTPUT_CONTRACT_TEXT, 'English')).toBe(
      'Conclusion / Output file paths / Key decisions / Open questions',
    )
    expect(localizeOutputContract('custom contract', 'English')).toBe('custom contract')
  })
})

describe('英文规划与运行期通知', () => {
  it.each(['create', 'template', 'instance'] as const)('规划目标 %s 为英文且保留改图契约', (target) => {
    const text = buildOrgPlanPrompt({
      facts: { target, targetId: target === 'create' ? undefined : 'tpl-1', targetName: 'Posts', systemLanguage: 'English' },
      dynamic: { userIntent: 'Plan the post pipeline' },
    })
    englishOnly(text)
    expect(text).toContain('wf_org_catalog')
    expect(text).toContain('wf_graph_patch')
    expect(text).toContain('Plan the post pipeline')
  })

  it('编排变更通知切换语言但不改变召回契约', () => {
    const english = orchestrationChangeTextOf('English')
    englishOnly(english)
    expect(english).toContain('[Orchestration changed]')
    expect(english).toContain('wf_org_catalog')
    const chinese = orchestrationChangeTextOf('中文')
    expect(chinese).toContain('【编排变更】')
    expect(chinese).toContain('wf_org_catalog')
  })

  it('数据库工具提示切换语言且保留所连节点 id', () => {
    const db = newDatabaseNode('local', 'Knowledge') as DatabaseNode
    const agent = newRoleNode('agent', 'Writer')
    const flow: WorkflowDocument = {
      id: 'flow-1',
      sessionId: 'session-1',
      mode: 'mode1',
      name: 'Flow',
      description: '',
      revision: 1,
      nodes: [db, agent],
      lines: [{ id: 'db-line', source: db.id, target: agent.id, sourceHandle: 'db-out', targetHandle: 'db-in' }],
    }
    const english = dbToolHintOf(flow, agent.id, 'English')
    englishOnly(english)
    expect(english).toContain(db.id)
    expect(dbToolHintOf(flow, agent.id, '中文')).toContain('已连接数据库节点')
  })
})
