// tests/host/orchestrator/task-blocks.test.ts
//
// 节点任务块与交接契约测试（用户裁决 2026.09：方案 A+「按需自动兜底」）：
//   - inputContractOf：data.inputSchema → 任务块中段「输入结构」；
//   - outputContractOf：data.outputSchema 优先；**仅当该节点存在 ctx-out 出线**（确有下游要读它）
//     且未配置时，才注入系统默认结构（结论 / 产出文件路径 / 关键决策 / 未决问题）；
//     无 ctx-out 出线的终端节点不注入任何交接约束；
//   - buildNodeBlocks：把两者落在正确的段位（输入在中段、交接契约在末段注意力位）。
//
// 断言策略：不断言提示词具体文案（提示词属长期优化项），只断言「注入/不注入」与段位归属，
// 契约字段清单经 DEFAULT_OUTPUT_CONTRACT 常量引用。
import { describe, expect, it } from 'vitest'
import { readFileSync } from "node:fs"
import { buildNodeBlocks, inputContractOf, outputContractOf } from '../../../src/host/orchestrator/index.js'
import { DEFAULT_OUTPUT_CONTRACT, HEAD_MARKER, MID_MARKER, NODE_HARD_CONSTRAINTS, TAIL_MARKER } from '../../../src/host/prompts/index.js'
import type { RoleNode, WorkflowDocument } from '../../../src/host/shared/graph-model.js'
import type { RunSnapshot } from '../../../src/host/shared/types.js'

/** 角色节点（可覆盖 inputSchema / outputSchema）。 */
function role(id: string, kind: 'parent' | 'agent' = 'agent', overrides: Record<string, unknown> = {}): RoleNode {
  return {
    id,
    kind,
    position: { x: 0, y: 0 },
    data: {
      label: `节点${id}`,
      systemPrompt: `任务：${id}`,
      provider: '',
      model: '',
      presetId: 'combo-1',
      retryLimit: 3,
      reactLimit: null,
      inputSchema: '',
      outputSchema: '',
      groupId: null,
      ...overrides,
    },
  }
}

/** 流程：start → a1 → a2 → end，可额外挂 ctx 线。 */
function makeFlow(withCtx: boolean, nodes?: RoleNode[]): WorkflowDocument {
  return {
    id: 'flow-1',
    sessionId: 'session-1',
    mode: 'mode1',
    name: '交接流程',
    description: '',
    revision: 1,
    nodes: nodes ?? [role('a1'), role('a2')],
    lines: [
      ...(withCtx ? [{ id: 'c1', source: 'a1', target: 'a2', sourceHandle: 'ctx-out' as const, targetHandle: 'ctx-in' as const }] : []),
    ],
  }
}

const emptySnapshot: RunSnapshot = {
  id: 'run-1',
  flowId: 'flow-1',
  flowName: '交接流程',
  sessionId: 'session-1',
  mode: 'mode1',
  status: 'running',
  startedAt: new Date(0).toISOString(),
  endedAt: null,
  summary: '',
  nodes: [],
}

function autoFlow(): WorkflowDocument {
  const flow = makeFlow(false)
  flow.lines = [{ id: "f1", source: "a1", target: "a2", sourceHandle: "flow-out", targetHandle: "flow-in" }]
  return flow
}

describe("auto Flow-only 输出合同", () => {
  const snapshot: RunSnapshot = { ...emptySnapshot, handoffPolicy: "auto" }
  it("test_auto_unique_direct_consumer_gets_existing_soft_contract", () => {
    const flow = autoFlow()
    expect(outputContractOf(flow, flow.nodes[0] as RoleNode, snapshot)).toEqual({ text: DEFAULT_OUTPUT_CONTRACT, defaulted: true })
    expect(buildNodeBlocks({ flow, node: flow.nodes[0] as RoleNode, snapshot, documentTextLimit: 20000, systemLanguage: "中文" })[0].text).toContain(DEFAULT_OUTPUT_CONTRACT)
    expect(outputContractOf(flow, flow.nodes[1] as RoleNode, snapshot)).toEqual({ text: "", defaulted: false })
  })

  it("test_auto_configured_schema_remains_exact_and_does_not_add_default_fields", () => {
    const flow = autoFlow()
    const node = flow.nodes[0] as RoleNode
    node.data.outputSchema = "最终只给自然语言结论"
    expect(outputContractOf(flow, node, snapshot)).toEqual({ text: node.data.outputSchema, defaulted: false })
  })

  it.each(["multiple", "conditional", "source-group", "target-group", "cycle", "ctx", "proxy-ctx", "declared-ctx", "binding", "workflow-binding", "dangling", "invalid-handle", "end"])("test_auto_%s_consumer_does_not_expand_handoff_semantics", (kind) => {
    const flow = autoFlow()
    const source = flow.nodes[0] as RoleNode
    const target = flow.nodes[1] as RoleNode
    const run = structuredClone(snapshot)
    if (kind === "multiple") { flow.nodes.push(role("a3")); flow.lines.push({ ...flow.lines[0], id: "other", source: "a3" }) }
    if (kind === "conditional") flow.lines[0].condition = { type: "pass" }
    if (kind === "source-group") source.data.groupId = "g"
    if (kind === "target-group") target.data.groupId = "g"
    if (kind === "cycle") flow.lines.push({ ...flow.lines[0], id: "back", source: "a2", target: "a1" })
    if (kind === "ctx" || kind === "proxy-ctx") {
      flow.nodes.push(role("a3"), { id: "p2", kind: "proxy", proxySourceId: "a2", position: { x: 0, y: 0 } })
      flow.lines.push({ id: "context", source: "a3", target: kind === "ctx" ? "a2" : "p2", sourceHandle: "ctx-out", targetHandle: "ctx-in" })
    }
    if (kind === "declared-ctx") target.data.execution = { inputSource: "ctx" }
    if (kind === "binding") run.runtimeInputs = { workflowInputs: {}, nodeInputs: { a2: { source: [{ kind: "text", value: "explicit" }] } } }
    if (kind === "workflow-binding") { run.workflowInputNodeId = "a2"; run.runtimeInputs = { workflowInputs: { source: [{ kind: "text", value: "explicit" }] }, nodeInputs: {} } }
    if (kind === "dangling") flow.lines[0].target = "unknown"
    if (kind === "invalid-handle") flow.lines[0].targetHandle = "ctx-in"
    if (kind === "end") { flow.nodes.push({ id: "end", kind: "end", position: { x: 0, y: 0 }, data: { label: "结束" } }); flow.lines[0].target = "end" }
    expect(outputContractOf(flow, source, run)).toEqual({ text: "", defaulted: false })
  })

  it("test_auto_proxy_edges_resolve_canonical_consumer_without_mutating_graph", () => {
    const flow = autoFlow()
    flow.nodes.push({ id: "p1", kind: "proxy", proxySourceId: "a1", position: { x: 0, y: 0 } }, { id: "p2", kind: "proxy", proxySourceId: "a2", position: { x: 0, y: 0 } })
    flow.lines[0].source = "p1"
    flow.lines[0].target = "p2"
    const before = structuredClone(flow)
    expect(outputContractOf(flow, flow.nodes[0] as RoleNode, snapshot)).toEqual({ text: DEFAULT_OUTPUT_CONTRACT, defaulted: true })
    expect(flow).toEqual(before)
  })

  it("test_auto_output_files_add_delivery_hint_without_forcing_undeclared_files", () => {
    const flow = autoFlow()
    const node = flow.nodes[0] as RoleNode
    node.data.execution = { outputFiles: ["output/result.json"] }
    const text = buildNodeBlocks({ flow, node, snapshot: { ...snapshot, workingDirectory: "/test/workspace" }, documentTextLimit: 20000, systemLanguage: "中文" })[0].text
    expect(text).toContain("/test/workspace/output/result.json")
    expect(text).toContain(NODE_HARD_CONSTRAINTS.declaredOutputFiles)
    delete node.data.execution
    expect(buildNodeBlocks({ flow, node, snapshot, documentTextLimit: 20000, systemLanguage: "中文" })[0].text).not.toContain(NODE_HARD_CONSTRAINTS.declaredOutputFiles)
  })

  it.each(["ctx-default", "ctx-custom-files", "flow-only", "terminal"])("test_explicit_%s_task_block_matches_merged_main_bytes", (key) => {
    const fixture = JSON.parse(readFileSync(new URL("../../fixtures/explicit-task-blocks.json", import.meta.url), "utf8")) as { baseline: string; expected: Record<string, Array<{ type: string; text: string }>> }
    const flow = key === "flow-only" ? autoFlow() : makeFlow(key.startsWith("ctx"))
    const node = flow.nodes[0] as RoleNode
    if (key === "ctx-custom-files") Object.assign(node.data, { inputSchema: "上游纪要", outputSchema: "自定义交付", execution: { outputFiles: ["output/result.json"] } })
    expect(buildNodeBlocks({ flow, node, snapshot: { ...emptySnapshot, handoffPolicy: "explicit", workingDirectory: "/test/workspace" }, documentTextLimit: 20000, systemLanguage: "中文" })).toEqual(fixture.expected[key])
    expect(outputContractOf(flow, node)).toEqual(outputContractOf(flow, node, { ...emptySnapshot, handoffPolicy: "explicit" }))
  })
})

describe('交接契约解析（outputContractOf / inputContractOf）', () => {
  it('有 ctx-out 出线且未配置 outputSchema → 注入默认结构并标记 defaulted', () => {
    const flow = makeFlow(true)
    const result = outputContractOf(flow, flow.nodes[0] as RoleNode)
    expect(result.defaulted).toBe(true)
    expect(result.text).toBe(DEFAULT_OUTPUT_CONTRACT)
  })

  it('无 ctx-out 出线（终端节点）→ 不注入任何交接约束', () => {
    const flow = makeFlow(false)
    const result = outputContractOf(flow, flow.nodes[0] as RoleNode)
    expect(result).toEqual({ text: '', defaulted: false })
  })

  it('已配置 outputSchema → 以配置为准（有下游时补「至少包含」默认字段）', () => {
    const configured = makeFlow(true, [role('a1', 'agent', { outputSchema: '{结论, 置信度}' }), role('a2')])
    const withConsumer = outputContractOf(configured, configured.nodes[0] as RoleNode)
    expect(withConsumer.defaulted).toBe(false)
    expect(withConsumer.text).toContain('{结论, 置信度}')
    expect(withConsumer.text).toContain(DEFAULT_OUTPUT_CONTRACT)

    // 无下游时逐字使用配置，不加补充
    const standalone = makeFlow(false, [role('a1', 'agent', { outputSchema: '{结论, 置信度}' }), role('a2')])
    const noConsumer = outputContractOf(standalone, standalone.nodes[0] as RoleNode)
    expect(noConsumer.text).toBe('{结论, 置信度}')
  })

  it('虚拟节点（proxy）不算消费方（ctx 出线必须来自角色节点本身）', () => {
    const flow: WorkflowDocument = {
      ...makeFlow(false, [role('a1'), role('a2')]),
      nodes: [role('a1'), role('a2'), { id: 'p1', kind: 'proxy', position: { x: 0, y: 0 }, proxySourceId: 'a1' }],
      lines: [{ id: 'c1', source: 'p1', target: 'a2', sourceHandle: 'ctx-out', targetHandle: 'ctx-in' }],
    }
    expect(outputContractOf(flow, flow.nodes[0] as RoleNode).text).toBe('')
  })

  it('inputContractOf：读取 data.inputSchema 并去空白；缺省为空串', () => {
    expect(inputContractOf(role('a1', 'agent', { inputSchema: '  上游纪要  ' }))).toBe('上游纪要')
    expect(inputContractOf(role('a1'))).toBe('')
  })

  it('纯函数：同输入两次解析结果相同', () => {
    const flow = makeFlow(true)
    expect(outputContractOf(flow, flow.nodes[0] as RoleNode)).toEqual(outputContractOf(flow, flow.nodes[0] as RoleNode))
  })
})

describe('buildNodeBlocks 交接契约段位', () => {
  it('输入结构注入中段、交接契约注入末段（注意力位），不污染首段', () => {
    const flow = makeFlow(true, [
      role('a1', 'agent', { inputSchema: '上游交付的调研纪要' }),
      role('a2'),
    ])
    const text = buildNodeBlocks({
      flow,
      node: flow.nodes[0] as RoleNode,
      snapshot: emptySnapshot,
      documentTextLimit: 20000,
      systemLanguage: '中文',
    })[0].text
    const head = text.slice(0, text.indexOf(MID_MARKER))
    const mid = text.slice(text.indexOf(MID_MARKER), text.indexOf(TAIL_MARKER))
    const tail = text.slice(text.indexOf(TAIL_MARKER))
    expect(text).toContain(HEAD_MARKER)
    expect(head).not.toContain('上游交付的调研纪要')
    expect(mid).toContain('上游交付的调研纪要')
    expect(mid).not.toContain(DEFAULT_OUTPUT_CONTRACT)
    expect(tail).toContain(DEFAULT_OUTPUT_CONTRACT)
  })

  it('终端节点（无 ctx-out）不注入交接契约段', () => {
    const flow = makeFlow(false, [role('a1'), role('a2')])
    const text = buildNodeBlocks({
      flow,
      node: flow.nodes[0] as RoleNode,
      snapshot: emptySnapshot,
      documentTextLimit: 20000,
      systemLanguage: '中文',
    })[0].text
    expect(text).not.toContain(DEFAULT_OUTPUT_CONTRACT)
    expect(text).not.toContain('输入结构')
  })

  it('未配置 inputSchema 时不组装输入结构段（不给节点添无关约束）', () => {
    const flow = makeFlow(true, [role('a1'), role('a2')])
    const text = buildNodeBlocks({
      flow,
      node: flow.nodes[0] as RoleNode,
      snapshot: emptySnapshot,
      documentTextLimit: 20000,
      systemLanguage: '中文',
    })[0].text
    expect(text).not.toContain('输入结构')
  })
})
