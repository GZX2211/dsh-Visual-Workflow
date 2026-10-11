// Real Runtime/NodeAgentRunner, authorization, file IO, settlement and persistence;
// only the model transport produces deterministic business outputs, not model E2E.
import { afterEach, expect, it, onTestFinished } from 'vitest'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NodeStartInput } from '../../src/host/orchestrator/index.js'
import { DEFAULT_OUTPUT_CONTRACT, NODE_HARD_CONSTRAINTS } from "../../src/host/prompts/index.js"
import { copyIntoManagedFile } from "../../src/host/storage/managed-files.js"
import { NodeAgentRunner, createChildToolFilterSetup, createChildPromptSetup, createModelSelectionSetup, createReactGuard, type SubagentsServiceLike } from "../../src/host/agent/index.js"
import { agent, stage, fileNode, makeFlow, makeHarness, caller, cleanupTempDirs } from '../host/orchestrator/fixtures/harness.js'

afterEach(cleanupTempDirs)

it.each(["explicit", "auto", "attachment"] as const)('test_sales_five_real_runner_stages_%s_verify_actual_artifacts_with_fake_model_transport', async (policy) => {
  const files: import("../../src/host/shared/runtime-types.js").SessionInputFile[] = []
  const h = await makeHarness({ documentTextLimit: 20000, outputFullLimit: 20000 }, { workingDirectory: async () => h.dir, sessionInputFiles: async () => files })
  const ids = ['load_data', 'quality_check', 'sales_stats', 'summary_gen', 'report_gen']
  const flow = makeFlow()
  flow.nodes = [stage('start', 'start'), ...ids.map((id, index) => agent(id, id, {
    presetId: 'standard',
    execution: { ...(policy === "explicit" ? { inputSource: "ctx" as const } : index === 0 ? { inputs: { source: { kind: "file" as const } } } : {}), outputFiles: [`output/${['raw.json', 'quality.json', 'stats.json', 'summary.md', 'final_report.md'][index]}`] },
  })), stage('end', 'end'), ...policy === "explicit" ? [fileNode('csv', '用户提供的销售数据', { fileKind: 'file' })] : []]
  const chain = ['start', ...ids, 'end']
  flow.lines = chain.slice(1).map((target, index) => ({ id: `flow-${index}`, source: chain[index], target, sourceHandle: 'flow-out', targetHandle: 'flow-in' }))
  if (policy === "explicit") flow.lines.push(...['csv', ...ids.slice(0, -1)].map((source, index) => ({ id: `ctx-${index}`, source, target: ids[index], sourceHandle: 'ctx-out' as const, targetHandle: 'ctx-in' as const })))
  const csv = join(h.dir, 'sales_workflow_test.csv')
  await copyFile(fileURLToPath(new URL('../fixtures/sales_workflow_test.csv', import.meta.url)), csv)
  const upload = policy === "auto" ? await copyIntoManagedFile(h.store.root, { sessionId: "session-1", name: "sales.csv", base64: (await readFile(csv)).toString("base64") }) : undefined
  const ref = { attachmentId: "admitted-sales-csv", name: "sales_workflow_test.csv", bytes: (await readFile(csv)).length }
  if (policy === "attachment") files.push({ ...ref, path: csv })
  const inputFile = upload ? join(h.store.root, upload.managedPath) : csv
  await mkdir(join(h.dir, 'output'))
  const outputs = new Map<string, string>()
  const actualReads: string[] = []
  const toolFilter = createChildToolFilterSetup()
  let modelCalls = 0
  const transport: SubagentsServiceLike = { list: () => ["spawn"], startContinuable: async (spec) => {
    expect(toolFilter.peekPending?.()).toEqual(["read", "write"])
    const id = ids[modelCalls++]
    const index = ids.indexOf(id)
    const previous = index > 0 ? outputs.get(ids[index - 1])! : inputFile
    expect(spec.request.prompt[0].text).toContain(`「${id}」`)
    expect(spec.request.prompt[0].text).toContain(previous)
    if (index < 4) expect(spec.request.prompt[0].text).toContain(DEFAULT_OUTPUT_CONTRACT)
    else expect(spec.request.prompt[0].text).not.toContain(DEFAULT_OUTPUT_CONTRACT)
    if (policy !== "explicit") expect(spec.request.prompt[0].text).toContain(NODE_HARD_CONSTRAINTS.declaredOutputFiles)
    const read = async (path: string) => { actualReads.push(path); return readFile(path, 'utf8') }
    let content: string
    let output: string
    if (id === 'load_data') {
      const [header, ...lines] = (await read(inputFile)).trim().split(/\r?\n/)
      const keys = header.split(',')
      const rows = lines.map((line) => Object.fromEntries(line.split(',').map((value, i) => [keys[i], value])))
      expect(rows).toHaveLength(11)
      content = JSON.stringify(rows)
      output = 'output/raw.json'
    } else if (id === 'quality_check') {
      const rows = JSON.parse(await read(previous)) as Array<Record<string, string>>
      const seen = new Set<string>()
      let duplicates = 0
      const unique = rows.filter((row) => { const key = JSON.stringify(row); if (seen.has(key)) { duplicates++; return false }; seen.add(key); return true })
      const missingCells = rows.flatMap(Object.values).filter((value) => value === '').length
      const valid = unique.filter((row) => Object.values(row).every((value) => value !== ''))
      content = JSON.stringify({ records: rows.length, duplicates, missingCells, valid })
      output = 'output/quality.json'
    } else if (id === 'sales_stats') {
      const quality = JSON.parse(await read(previous)) as { records: number; duplicates: number; missingCells: number; valid: Array<Record<string, string>> }
      const sorted = [...quality.valid].sort((a, b) => Number(a.sales_amount) - Number(b.sales_amount))
      const total = quality.valid.reduce((sum, row) => sum + Number(row.sales_amount), 0)
      const dailyTotals: Record<string, number> = {}
      const productTotals: Record<string, number> = {}
      for (const row of quality.valid) {
        dailyTotals[row.date] = (dailyTotals[row.date] ?? 0) + Number(row.sales_amount)
        productTotals[row.product] = (productTotals[row.product] ?? 0) + Number(row.sales_amount)
      }
      content = JSON.stringify({ records: quality.records, duplicates: quality.duplicates, missingCells: quality.missingCells, valid: quality.valid.length, total, average: (total / quality.valid.length).toFixed(2), maximum: { id: sorted.at(-1)!.order_id, amount: Number(sorted.at(-1)!.sales_amount) }, minimum: { id: sorted[0].order_id, amount: Number(sorted[0].sales_amount) }, dailyTotals, productTotals })
      output = 'output/stats.json'
    } else if (id === 'summary_gen') {
      const stats = JSON.parse(await read(previous))
      content = `数据记录：${stats.records}\n完全重复记录：${stats.duplicates}\n缺失单元格：${stats.missingCells}\n有效销售记录：${stats.valid}\n总销售额：${stats.total}\n平均单条销售额：${stats.average}\n最大销售记录：${stats.maximum.amount}（${stats.maximum.id}）\n最小销售记录：${stats.minimum.amount}（${stats.minimum.id}）`
      content += `\n${Object.entries(stats.dailyTotals).map(([date, amount]) => `${date}：${amount}`).join("\n")}\n${Object.entries(stats.productTotals).map(([product, amount]) => `${product}：${amount}`).join("\n")}\n趋势：每日金额波动。`
      output = 'output/summary.md'
    } else {
      const stats = JSON.parse(await read(outputs.get("sales_stats")!))
      expect(Object.values(stats.dailyTotals).reduce<number>((sum, amount) => sum + Number(amount), 0)).toBe(stats.total)
      content = `# 销售分析报告\n\n${await read(previous)}\n\n已剔除完全重复记录和包含缺失值的记录。\n`
      output = 'output/final_report.md'
    }
    const path = join(h.dir, output)
    await writeFile(path, content)
    outputs.set(id, path)
    h.runtime.handleSubagentStart({ id: `sales-${id}`, runId: `epoch-${id}` })
    return { childId: `sales-${id}` }
  }, sendMessage: async () => { throw new Error("fixture expects first dispatch only") }, interrupt: () => {} }
  const runner = new NodeAgentRunner({ store: h.store, agents: () => ({ get: (id) => h.agents.getRootAgent(id) }), subagents: () => transport, teams: () => null,
    toolsView: { visibleToolNames: async () => ["read", "write"], agentToolNames: async () => ["read", "write"], presetToolNames: async () => ["read", "write"] },
    toolFilter, promptSetup: createChildPromptSetup(), modelSelection: createModelSelectionSetup(), react: createReactGuard().bridge,
  })
  h.runner.startNodeTask = (input: NodeStartInput) => runner.startNodeTask(input)
  h.runner.interruptChild = (childId, sessionId) => runner.interruptChild(childId, sessionId)
  onTestFinished(() => { h.runtime.dispose(); runner.dispose() })
  await h.store.saveWorkflow(flow, 'session-1')
  const { runId } = await h.runtime.startRun({ sessionId: 'session-1', flowId: flow.id, ...(policy !== "explicit" ? { handoffPolicy: "auto" as const, runtimeInputs: { nodeInputs: { load_data: { source: [{ kind: "file", fileRef: upload ? { source: "managed", path: upload.managedPath } : { source: "attachment", ...ref } }] } } } } : { fileBindings: { csv: [csv] } }) })
  for (const nodeId of ids) {
    await h.runtime.wfRunNode(caller, { nodeId })
    await h.runtime.handleSubagentEnd({ id: `sales-${nodeId}`, runId: `epoch-${nodeId}`, stopReason: 'completed', lastAssistantMessage: [{ type: 'text', text: outputs.get(nodeId)! }] })
  }
  expect(actualReads).toEqual([inputFile, ...ids.slice(0, 3).map((id) => outputs.get(id)!), outputs.get("sales_stats"), outputs.get("summary_gen")])
  const stats = JSON.parse(await readFile(outputs.get('sales_stats')!, 'utf8'))
  expect(stats).toEqual({ records: 11, duplicates: 1, missingCells: 2, valid: 9, total: 15900, average: '1766.67', maximum: { id: 'S001', amount: 6000 }, minimum: { id: 'S010', amount: 200 }, dailyTotals: { "2026/10/1": 6400, "2026/10/2": 2100, "2026/10/3": 3800, "2026/10/4": 3400, "2026/10/5": 200 }, productTotals: { "电脑": 9000, "鼠标": 1200, "键盘": 1200, "显示器": 4500 } })
  await h.runtime.wfFinish(caller, { status: 'completed', summary: '五个节点完成；报告已落盘并核验' })
  const snapshot = (await h.store.getRun(runId))!
  expect(snapshot.status).toBe('completed')
  expect(modelCalls).toBe(5)
  if (policy === "attachment") expect(snapshot).toMatchObject({ inputRevision: 1, runtimeInputs: { nodeInputs: { load_data: { source: [{ fileRef: { source: "attachment", ...ref, path: csv } }] } } } })
  expect(snapshot.nodes.filter((node) => ids.includes(node.nodeId))).toHaveLength(5)
  for (const node of snapshot.nodes.filter((node) => ids.includes(node.nodeId))) {
    expect(node).toMatchObject({ status: 'ok', attempts: 1, stopReason: 'completed', artifacts: [{ path: outputs.get(node.nodeId), size: expect.any(Number), verifiedAt: expect.any(String) }] })
  }
  const report = await readFile(join(h.dir, 'output/final_report.md'), 'utf8')
  for (const expected of ['数据记录：11', '完全重复记录：1', '缺失单元格：2', '有效销售记录：9', '总销售额：15900', '1766.67', '6000（S001）', '200（S010）']) expect(report).toContain(expected)
  for (const [fact, amount] of [...Object.entries(stats.dailyTotals), ...Object.entries(stats.productTotals)]) expect(report).toContain(`${fact}：${amount}`)
  expect(report).toContain("趋势：每日金额波动")
  expect(h.runtime.activeRunsForSession('session-1')).toHaveLength(0)
})
