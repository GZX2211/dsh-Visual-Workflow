// Live DSH acceptance, using configured model credentials in the DSH host.
// This script creates a reviewable test session/flow, never approves experience cards.
import assert from "node:assert/strict"
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

if (process.argv.includes("--help")) {
  console.log(`Run inside the DSH container, or on a machine sharing its workspace filesystem.
Required: DSH_BASE_URL, DSH_TEST_PROVIDER, DSH_TEST_MODEL (exact DSH routing identifiers).
Optional: DSH_WEB_LOG (local DSH web log used for authentication; never printed),
DSH_TEST_WORKSPACE (fresh host-visible directory), SALES_CSV, DSH_TEST_TIMEOUT_MS.
--text: three serial Agents receiving text; --json: two serial Agents receiving JSON.
Default: five sales Agents receiving an explicitly uploaded file. All default to auto,
with no File Node and no ctx edges. --explicit retains the original sales ctx fixture.
--prepare-only creates a test session and workflow without starting any model run;
only DSH_BASE_URL is required in this mode. --help has no side effects.
This script checks real child IDs, node settlement, artifacts and report contents.
Mock checks do not constitute a real Docker/model E2E result.`)
  process.exit(0)
}
const origin = process.env.DSH_BASE_URL
assert.ok(origin, "Set DSH_BASE_URL to the actual DSH web endpoint")
assert.ok(["http:", "https:"].includes(new URL(origin).protocol), "DSH_BASE_URL must use HTTP or HTTPS")
const provider = process.env.DSH_TEST_PROVIDER
const model = process.env.DSH_TEST_MODEL
const prepareOnly = process.argv.includes("--prepare-only")
const testCase = process.argv.includes("--text") ? "text" : process.argv.includes("--json") ? "json" : "sales"
const explicit = process.argv.includes("--explicit")
assert.ok(!explicit || testCase === "sales", "--explicit supports the legacy sales fixture only")
assert.ok(prepareOnly || (provider && model), "Set DSH_TEST_PROVIDER and DSH_TEST_MODEL to configured DSH routing names; credentials remain in DSH settings")
const timeoutMs = Number(process.env.DSH_TEST_TIMEOUT_MS ?? 600000)
assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0, "DSH_TEST_TIMEOUT_MS must be positive")
const workspace = resolve(process.env.DSH_TEST_WORKSPACE ?? await mkdtemp(join(tmpdir(), "dsh-sales-live-")))
const sourceCsv = resolve(process.env.SALES_CSV ?? fileURLToPath(new URL("../tests/fixtures/sales_workflow_test.csv", import.meta.url)))
if (testCase === "sales") await readFile(sourceCsv, "utf8") // actual input must be readable in the same host filesystem
await mkdir(workspace, { recursive: true })
await mkdir(resolve(workspace, "output"), { recursive: true })
const csv = resolve(workspace, "sales_workflow_test.csv")
if (testCase === "sales" && sourceCsv !== csv) await copyFile(sourceCsv, csv)
const login = new URL("/", origin)
const token = process.env.DSH_WEB_LOG ? (await readFile(process.env.DSH_WEB_LOG, "utf8")).match(/[?&]token=([^\s&]+)/)?.[1] : undefined
if (token) login.searchParams.set("token", token)
const response = await fetch(login, { redirect: "manual", signal: AbortSignal.timeout(10000) })
assert.ok(response.ok || [302, 303].includes(response.status), `boot HTTP ${response.status}`)
const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ")
const headers = { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) }
async function api(endpoint, args) {
  const response = await fetch(new URL(`/visual-workflow/${endpoint}`, origin), { method: "POST", headers, body: JSON.stringify({ args }), signal: AbortSignal.timeout(30000) })
  const result = await response.json()
  if (!response.ok || result.ok !== true) throw new Error(`${endpoint}: ${result.error?.code ?? response.status}`)
  return result.value
}
const created = await api("createSession", { workspacePath: workspace, label: `${testCase} 运行输入验收` })
const sessionId = created.sessionId
assert.ok(typeof sessionId === "string", "createSession did not return sessionId")
const ids = testCase === "sales" ? ["load_data", "quality_check", "sales_stats", "summary_gen", "report_gen"] : testCase === "text" ? ["uppercase", "annotate", "summarize"] : ["produce", "consume"]
const outputs = ["raw.json", "quality.json", "stats.json", "summary.md", "final_report.md"].map((name) => resolve(workspace, "output", name))
const salesTasks = [
  `实际使用 read 读取运行输入或显式 ctx 给出的 CSV 路径，按表头解析全部记录，保留重复行与空单元格（空字符串），不得把空值转换成零。写 JSON 记录数组到 ${outputs[0]}。最终回复准确给出该文件绝对路径。`,
  `实际读取上游 raw.json，统计原始记录数、全部原始记录中的空单元格数、完全重复记录数（六列完全相同，首次以外每条计一次）；先去重再剔除任何有缺失单元格的记录。写 JSON {records,duplicates,missingCells,valid:[记录对象]} 到 ${outputs[1]}。最终回复准确给出文件绝对路径。`,
  `实际读取上游 quality.json，仅以 valid 中的 sales_amount 数值计算总额、平均额（两位小数字符串）、最大/最小记录，按原始 date 和 product 分组求和。写 JSON {records,duplicates,missingCells,valid:有效记录数,total,average,maximum:{id:order_id,amount},minimum:{id:order_id,amount},dailyTotals:{日期:销售额},productTotals:{产品:销售额}} 到 ${outputs[2]}，分组金额之和须与 total 一致。精确计算优先使用已授权脚本或数据库能力（若可用），以实际工具结果为依据，不以自述代替计算。最终回复准确给出文件绝对路径。`,
  `实际读取上游 stats.json，不重新估算统计。生成中文摘要，列出数量、总额、平均额、最大/最小记录及订单号、每天和每种产品的金额；按 dailyTotals 的实际变化解释趋势，区分统计事实与解释，无依据不声称持续上升或增长。写入 ${outputs[3]}，最终回复准确给出文件绝对路径。`,
  `实际读取上游 summary.md，并使用 read 读取本次工作区已生成的 ${outputs[2]} 核对数值。生成完整中文 Markdown 报告，列出全部统计、每日和产品金额、趋势依据、完全去重与缺失值剔除及有效记录口径，不能照抄未经事实支持的解释。写入 ${outputs[4]}，最终回复准确给出文件绝对路径。`,
]
const salesContracts = [
  { purpose: "保真解析销售输入", input: "运行输入 source 或显式 ctx 提供的 CSV 文件", output: "raw.json：全部原始记录对象数组，保留重复与空字符串" },
  { purpose: "核查并清洗记录", input: "实际读取上游 raw.json", output: "quality.json：{records,duplicates,missingCells,valid:[完整且去重的记录]}" },
  { purpose: "对有效记录做精确统计", input: "实际读取上游 quality.json 的 valid 记录", output: "stats.json：{records,duplicates,missingCells,valid:数量,total,average:两位小数字符串,maximum:{id,amount},minimum:{id,amount},dailyTotals:{原始日期:金额},productTotals:{产品:金额}}" },
  { purpose: "解释已核验的销售事实", input: "实际读取上游 stats.json，含 dailyTotals/productTotals，按数值解释趋势与产品表现", output: "summary.md：所有统计、每日/产品金额与有事实依据的解释，事实与解释分开" },
  { purpose: "交付可复核销售报告", input: `实际读取上游 summary.md 和 ${outputs[2]}，按统计事实核对摘要`, output: "final_report.md：完整统计、每日/产品金额、质量处理口径及有依据的趋势" },
].map(({ purpose, input, output }, index) => ({ responsibility: { id: ids[index], purpose, deliverable: output }, inputSchema: input, outputSchema: `${output}；真实写入 ${outputs[index]}，最终回复实际文件路径` }))
const tasks = testCase === "sales" ? salesTasks : testCase === "text" ? [
  "将运行输入 source 中的英文文本转为大写，最终回复仅包含转换后的文本。",
  "读取自动交接的 upstreamText，最终回复为 NOTE: 加空格再加上游全文，不省略。",
  "总结自动交接的 upstreamText，必须逐字保留 NOTE: HELLO WORKFLOW。",
] : [
  '读取运行输入 source 的 JSON，最终回复仅为原始 JSON 对象，不使用代码围栏。',
  '解析自动交接的 upstreamText，将 value 乘以 2，最终回复仅为 {"doubled":数字}，不使用代码围栏。',
]
const role = (id, kind, systemPrompt, execution, contract = {}) => ({ id, kind, position: { x: 0, y: 0 }, data: { label: id, systemPrompt, provider: provider ?? "", model: model ?? "", presetId: "standard", retryLimit: 2, reactLimit: 50, inputSchema: "", outputSchema: "", ...contract, ...(execution ? { execution } : {}) } })
const flowId = `inputs-${testCase}-${Date.now()}`
const flow = {
  id: flowId, sessionId, mode: "mode1", revision: 0, name: `${testCase} 运行输入验收`, description: `${testCase}: ${explicit ? "legacy explicit ctx" : "runtime inputs + serial auto handoff"}`,
  nodes: [
    { id: "start", kind: "start", position: { x: 0, y: 0 }, data: { label: "启动" } },
    role("parent", "parent", `你是编排父代理。只按流程调度 ${ids.length} 个子代理，等待有效结算后调度下游，不代替它们执行节点任务。核对节点状态和已声明产物后调用 wf_finish；节点失败须如实处理并报告。`),
    ...ids.map((id, index) => role(id, "agent", tasks[index], testCase === "sales" ? { ...(explicit ? { inputSource: "ctx" } : index === 0 ? { inputs: { source: { kind: "file" } } } : {}), requiredTools: ["read", "write"], outputFiles: [outputs[index]] } : index === 0 ? { inputs: { source: { kind: testCase } } } : {}, testCase === "sales" ? salesContracts[index] : { inputSchema: index === 0 ? `运行输入 source：${testCase}` : "自动交接 upstreamText", outputSchema: testCase === "text" ? "仅返回任务指定文本，不添加额外字段" : "仅返回任务指定 JSON 对象，不添加字段或代码围栏" })),
    { id: "end", kind: "end", position: { x: 0, y: 0 }, data: { label: "结束" } },
    ...(explicit ? [{ id: "csv", kind: "file", position: { x: 0, y: 0 }, data: { label: "销售 CSV 输入", fileKind: "file" } }] : []),
  ],
  lines: [],
}
const chain = ["start", ...ids, "end"]
flow.lines.push(...chain.slice(1).map((target, index) => ({ id: `flow-${index}`, source: chain[index], target, sourceHandle: "flow-out", targetHandle: "flow-in" })))
if (explicit) flow.lines.push(...["csv", ...ids.slice(0, -1)].map((source, index) => ({ id: `ctx-${index}`, source, target: ids[index], sourceHandle: "ctx-out", targetHandle: "ctx-in" })))
await writeFile(resolve(workspace, "live-flow.json"), JSON.stringify(flow, null, 2))
await api("putWorkflow", { sessionId, flow })
if (prepareOnly) {
  console.log(JSON.stringify({ status: "prepared", sessionId, flowId, workspace, modelRunStarted: false }))
  process.exit(0)
}
const runtimeInputs = { workflowInputs: {}, nodeInputs: {} }
if (!explicit) {
  const source = testCase === "sales"
    ? { kind: "file", fileRef: { source: "managed", path: (await api("fileUpload", { sessionId, name: `${flowId}-input.csv`, base64: (await readFile(csv)).toString("base64") })).managedPath } }
    : testCase === "text" ? { kind: "text", value: "hello workflow" } : { kind: "json", value: { value: 21 } }
  runtimeInputs.nodeInputs[ids[0]] = { source: [source] }
}
const runStartedAt = Date.now()
const { runId } = await api("run", { sessionId, flowId, ...(explicit ? { fileBindings: { csv: [csv] } } : { handoffPolicy: "auto", runtimeInputs }) })
console.log(JSON.stringify({ phase: "started", runId, sessionId, flowId, provider, model, workspace }))
const deadline = Date.now() + timeoutMs
let snapshot
let progress = ""
while (Date.now() < deadline) {
  snapshot = await api("runStatus", { sessionId, runId })
  const state = JSON.stringify({ status: snapshot.status, nodes: snapshot.nodes.filter((node) => ids.includes(node.nodeId)).map(({ nodeId, status, attempts }) => ({ nodeId, status, attempts })) })
  if (state !== progress) { console.log(state); progress = state }
  if (!["running", "paused"].includes(snapshot.status)) break
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
await writeFile(resolve(workspace, "live-run.json"), JSON.stringify(snapshot, null, 2))
// runStatus has no independent Agent usage counters; never infer them from attempts.
await writeFile(resolve(workspace, "live-metrics.json"), JSON.stringify({
  runId, testCase, durationMs: Date.now() - runStartedAt, observedStatus: snapshot?.status ?? "unknown",
  parentRoute: snapshot?.parentRoute, parentTokenUsage: "NOT AVAILABLE: export independent usage from onsite DSH",
  nodes: (snapshot?.nodes ?? []).filter((node) => ids.includes(node.nodeId)).map(({ nodeId, childId, status, attempts, attemptHistory }) => ({ nodeId, childId, status, attempts, attemptHistory, tokenUsage: "NOT AVAILABLE: export independent usage from onsite DSH" })),
}, null, 2))
if (!snapshot || ["running", "paused"].includes(snapshot.status)) {
  await api("runStop", { sessionId, runId })
  throw new Error(`Live acceptance timed out; stopped owned test run ${runId}`)
}
assert.equal(snapshot.status, "completed", `run ${runId}: ${snapshot.status}; inspect live-run.json and DSH session errors`)
for (const id of ids) {
  const node = snapshot.nodes.find((node) => node.nodeId === id)
  assert.equal(node?.status, "ok", `${id} did not complete`)
  assert.ok(node.childId && node.attempts > 0 && node.provider && node.model && (testCase !== "sales" || node.artifacts?.length), `${id} lacks actual child/route/artifact evidence`)
}
assert.ok(snapshot.parentRoute?.provider && snapshot.parentRoute?.model, "parent model route was not recorded")
if (testCase !== "sales") {
  const final = snapshot.nodes.find((node) => node.nodeId === ids.at(-1)).output.trim()
  if (testCase === "text") assert.ok(final.includes("NOTE: HELLO WORKFLOW"), "serial text content was not preserved")
  else assert.deepEqual(JSON.parse(final), { doubled: 42 })
  console.log(JSON.stringify({ status: "passed", testCase, runId, businessNodes: ids.length, result: final }))
  process.exit(0)
}
const raw = JSON.parse(await readFile(outputs[0], "utf8"))
assert.ok(Array.isArray(raw) && raw.length === 11, "raw.json must preserve all 11 input rows")
assert.equal(raw.filter((row) => row.order_id === "S008").length, 2, "raw.json lost the duplicated order")
const quality = JSON.parse(await readFile(outputs[1], "utf8"))
assert.equal(quality.records, 11)
assert.equal(quality.duplicates, 1)
assert.equal(quality.missingCells, 2)
assert.ok(Array.isArray(quality.valid) && quality.valid.length === 9, "quality.json must contain the nine valid input rows")
const stats = JSON.parse(await readFile(outputs[2], "utf8"))
const dailyTotals = { "2026/10/1": 6400, "2026/10/2": 2100, "2026/10/3": 3800, "2026/10/4": 3400, "2026/10/5": 200 }
const productTotals = { "电脑": 9000, "鼠标": 1200, "键盘": 1200, "显示器": 4500 }
assert.ok(stats.dailyTotals && stats.productTotals, "stats.json must include dailyTotals and productTotals")
assert.equal(Object.values(stats.dailyTotals).reduce((sum, amount) => sum + amount, 0), stats.total, "dailyTotals sum must equal total")
assert.equal(Object.values(stats.productTotals).reduce((sum, amount) => sum + amount, 0), stats.total, "productTotals sum must equal total")
assert.deepEqual(stats, { records: 11, duplicates: 1, missingCells: 2, valid: 9, total: 15900, average: "1766.67", maximum: { id: "S001", amount: 6000 }, minimum: { id: "S010", amount: 200 }, dailyTotals, productTotals }, "stats.json disagrees with the valid-record sales facts")
const summary = await readFile(outputs[3], "utf8")
const report = await readFile(outputs[4], "utf8")
// Fixed-fixture business assertions, not a general Runtime semantic validator.
for (const [name, content] of [["summary", summary], ["report", report]]) {
  const text = content.replace(/(?<=\d),(?=\d{3}\b)/g, "")
  for (const value of ["15900", "1766.67", "6000", "S001", "200", "S010"]) assert.ok(text.includes(value), `${name} missing ${value}`)
  for (const [date, amount] of Object.entries(dailyTotals)) {
    const day = date.split("/").at(-1)
    assert.ok(text.split("\n").some((line) => new RegExp(`(?:2026[/.-])?10[/.-]0?${day}(?!\\d)`).test(line) && new RegExp(`(?<![\\d.])${amount}(?:\\.0+)?(?![\\d.])`).test(line)), `${name} missing daily fact ${date}=${amount}`)
  }
  for (const [product, amount] of Object.entries(productTotals)) assert.ok(text.split("\n").some((line) => line.includes(product) && new RegExp(`(?<![\\d.])${amount}(?:\\.0+)?(?![\\d.])`).test(line)), `${name} missing product fact ${product}=${amount}`)
  const growth = "(?:(?:持续|稳步|逐日|每天)(?:上升|增长|增加|上涨)|(?:上升|增长|上涨)趋势)"
  const claims = text.replace(new RegExp(`(?:并非|并不|并不是|不是|不|非|不能(?:认为|说|称|视为)?|无法(?:认为|说|称|视为)?|没有|未)(?:呈现|表现为|是)?${growth}`, "g"), "")
  assert.ok(!new RegExp(growth).test(claims), `${name} falsely claims continuous growth despite fluctuating dailyTotals`)
}
console.log(JSON.stringify({ status: "passed", runId, businessNodes: 5, report: outputs[4] }))
