// Controlled HTTP boundary checks for the live acceptance script, not model E2E.
import { afterEach, expect, it } from "vitest"
import { execFile } from "node:child_process"
import { createServer } from "node:http"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

const execute = promisify(execFile)
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())) })

it("test_sales_live_help_and_missing_configuration_never_start_a_run", async () => {
  const env = { ...process.env, DSH_BASE_URL: "", DSH_TEST_PROVIDER: "", DSH_TEST_MODEL: "", DSH_WEB_LOG: "" }
  const { stdout } = await execute(process.execPath, ["scripts/run-sales-live.mjs", "--help"], { env })
  expect(stdout).toContain("DSH_BASE_URL")
  expect(stdout).toContain("DSH_TEST_PROVIDER")
  expect(stdout).toContain("DSH_TEST_MODEL")
  await expect(execute(process.execPath, ["scripts/run-sales-live.mjs"], { env })).rejects.toMatchObject({ stderr: expect.stringContaining("Set DSH_BASE_URL") })
})

it.each([{ prepareOnly: true, explicit: false }, { prepareOnly: false, explicit: false }, { prepareOnly: true, explicit: true }])("test_sales_live_configurable_http_boundary_%j_keeps_route_and_rejects_missing_child_evidence", async ({ prepareOnly, explicit }) => {
  const workspace = await mkdtemp(join(tmpdir(), "sales-script-test-"))
  cleanups.push(() => rm(workspace, { recursive: true, force: true }))
  const requests: Array<{ endpoint: string; args: Record<string, unknown> }> = []
  const server = createServer(async (request, response) => {
    let body = ""
    for await (const chunk of request) body += String(chunk)
    const endpoint = request.url!.split("/").at(-1)!
    if (request.method === "GET") { response.end("ready"); return }
    const { args } = JSON.parse(body)
    requests.push({ endpoint, args })
    const values: Record<string, unknown> = {
      createSession: { sessionId: "controlled-session" }, fileUpload: { managedPath: "data/files/upload.csv" }, putWorkflow: {}, run: { runId: "controlled-run" },
      runStatus: { status: "completed", nodes: ["load_data", "quality_check", "sales_stats", "summary_gen", "report_gen"].map((nodeId) => ({ nodeId, status: "ok" })) },
    }
    response.setHeader("content-type", "application/json")
    response.end(JSON.stringify({ ok: true, value: values[endpoint] }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanups.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
  const port = (server.address() as { port: number }).port
  const env = { ...process.env, DSH_BASE_URL: `http://127.0.0.1:${port}`, DSH_TEST_PROVIDER: "site-specific-provider", DSH_TEST_MODEL: "site-specific-model", DSH_TEST_WORKSPACE: workspace, DSH_WEB_LOG: "", SALES_CSV: join(process.cwd(), "tests/fixtures/sales_workflow_test.csv"), DSH_TEST_TIMEOUT_MS: "1000" }
  const result = execute(process.execPath, ["scripts/run-sales-live.mjs", ...prepareOnly ? ["--prepare-only"] : [], ...explicit ? ["--explicit"] : []], { env })
  if (prepareOnly) {
    const { stdout } = await result
    expect(JSON.parse(stdout)).toMatchObject({ status: "prepared", modelRunStarted: false, workspace })
    expect(requests.map(({ endpoint }) => endpoint)).toEqual(["createSession", "putWorkflow"])
  } else {
    await expect(result).rejects.toMatchObject({ stderr: expect.stringContaining("load_data lacks actual child/route/artifact evidence") })
    expect(JSON.parse(await readFile(join(workspace, "live-run.json"), "utf8")).status).toBe("completed")
    expect(JSON.parse(await readFile(join(workspace, "live-metrics.json"), "utf8"))).toMatchObject({ observedStatus: "completed", durationMs: expect.any(Number), parentTokenUsage: expect.stringContaining("NOT AVAILABLE") })
  }
  const flow = requests.find(({ endpoint }) => endpoint === "putWorkflow")!.args.flow as { mode: string; lines: Array<{ targetHandle: string }>; nodes: Array<{ id: string; kind: string; data: { provider: string; model: string; presetId: string; inputSchema: string; outputSchema: string; responsibility: { id: string; purpose: string; deliverable: string }; execution?: { requiredTools: string[]; outputFiles: string[] } } }> }
  expect(flow.mode).toBe("mode1")
  expect(flow.nodes.some((node) => node.kind === "file")).toBe(explicit)
  expect(flow.lines.filter((line) => line.targetHandle === "ctx-in")).toHaveLength(explicit ? 5 : 0)
  if (!prepareOnly) {
    expect(requests.find(({ endpoint }) => endpoint === "run")?.args).toMatchObject({ handoffPolicy: "auto", runtimeInputs: { nodeInputs: { load_data: { source: [{ kind: "file", fileRef: { source: "managed", path: "data/files/upload.csv" } }] } } } })
    const upload = requests.find(({ endpoint }) => endpoint === "fileUpload")?.args as { base64: string }
    expect(Buffer.from(upload.base64, "base64").toString()).toBe(await readFile(env.SALES_CSV, "utf8"))
  }
  const nodes = flow.nodes.filter(({ kind }) => kind === "agent")
  expect(nodes).toHaveLength(5)
  for (const { id, data } of nodes) {
    expect(data).toMatchObject({ provider: "site-specific-provider", model: "site-specific-model", presetId: "standard", execution: { requiredTools: ["read", "write"] } })
    expect(data.responsibility).toMatchObject({ id, purpose: expect.any(String), deliverable: expect.any(String) })
    expect(data.inputSchema).not.toBe("")
    expect(data.outputSchema).toContain(data.execution!.outputFiles[0])
  }
  expect(nodes[2].data.outputSchema).toContain("dailyTotals")
  expect(nodes[2].data.outputSchema).toContain("productTotals")
  expect(nodes[3].data.inputSchema).toContain("dailyTotals/productTotals")
  expect(nodes[4].data.inputSchema).toContain(join(workspace, "output/stats.json"))
  expect(await readFile(join(workspace, "sales_workflow_test.csv"), "utf8")).toBe(await readFile(env.SALES_CSV, "utf8"))
})

it.each([
  ["raw", "raw.json must preserve all 11 input rows"], ["quality", "0 !== 2"], ["valid", ""],
  ["missing-totals", "stats.json must include dailyTotals and productTotals"],
  ["daily-sum", "dailyTotals sum must equal total"], ["product-sum", "productTotals sum must equal total"],
  ["daily-facts", "stats.json disagrees with the valid-record sales facts"], ["product-facts", "stats.json disagrees with the valid-record sales facts"],
  ["summary-trend", "summary falsely claims continuous growth"], ["report-trend", "report falsely claims continuous growth"],
  ["rising-trend", "summary falsely claims continuous growth"],
  ["summary-daily", "summary missing daily fact"], ["wrong-summary-amount", "summary missing daily fact"],
  ["report-product", "report missing product fact"], ["wrong-report-amount", "report missing product fact"], ["negated-trend", ""],
])("test_sales_live_fake_HTTP_%s_validates_actual_intermediate_files_not_model_E2E", async (kind, failure) => {
  const workspace = await mkdtemp(join(tmpdir(), "sales-artifacts-test-"))
  cleanups.push(() => rm(workspace, { recursive: true, force: true }))
  await mkdir(join(workspace, "output"))
  const source = join(process.cwd(), "tests/fixtures/sales_workflow_test.csv")
  const [header, ...lines] = (await readFile(source, "utf8")).trim().split(/\r?\n/)
  const columns = header.split(",")
  const rows = lines.map((line) => Object.fromEntries(line.split(",").map((value, index) => [columns[index], value])))
  await writeFile(join(workspace, "output/raw.json"), JSON.stringify(kind === "raw" ? rows.slice(0, 10) : rows))
  await writeFile(join(workspace, "output/quality.json"), JSON.stringify({ records: 11, duplicates: 1, missingCells: kind === "quality" ? 0 : 2, valid: rows.filter((row, index) => index !== 8 && row.order_id !== "S009") }))
  const dailyTotals = { "2026/10/1": 6400, "2026/10/2": 2100, "2026/10/3": 3800, "2026/10/4": 3400, "2026/10/5": 200 }
  const productTotals = { "电脑": 9000, "鼠标": 1200, "键盘": 1200, "显示器": 4500 }
  if (kind === "daily-sum") dailyTotals["2026/10/1"]++
  if (kind === "product-sum") productTotals["电脑"]++
  if (kind === "daily-facts") { dailyTotals["2026/10/1"]++; dailyTotals["2026/10/2"]-- }
  if (kind === "product-facts") { productTotals["电脑"]++; productTotals["鼠标"]-- }
  await writeFile(join(workspace, "output/stats.json"), JSON.stringify({ records: 11, duplicates: 1, missingCells: 2, valid: 9, total: 15900, average: "1766.67", maximum: { id: "S001", amount: 6000 }, minimum: { id: "S010", amount: 200 }, ...kind === "missing-totals" ? {} : { dailyTotals, productTotals } }))
  const facts = `15900 1766.67 6000 S001 200 S010\n${Object.entries(dailyTotals).map(([date, amount]) => `${date}：${amount}`).join("\n")}\n${Object.entries(productTotals).map(([product, amount]) => `${product}：${amount}`).join("\n")}\n`
  const summary = kind === "summary-daily" ? facts.replace("2026/10/2：2100", "") : kind === "wrong-summary-amount" ? facts.replace("2026/10/1：6400", "2026/10/1：16400") : facts
  const report = kind === "report-product" ? facts.replace("显示器：4500", "") : kind === "wrong-report-amount" ? facts.replace("显示器：4500", "显示器：14500") : facts
  await writeFile(join(workspace, "output/summary.md"), `${summary}${kind === "summary-trend" ? "销售持续上升" : kind === "rising-trend" ? "销售呈上升趋势" : kind === "negated-trend" ? "趋势并非持续上升，也不是上升趋势，而是波动" : "每日金额波动"}`)
  await writeFile(join(workspace, "output/final_report.md"), `${report}${kind === "report-trend" ? "销售稳步增长" : "每日金额波动"}`)
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) { /* Consume the HTTP body. */ }
    if (request.method === "GET") { response.end("ready"); return }
    const endpoint = request.url!.split("/").at(-1)!
    const values: Record<string, unknown> = {
      createSession: { sessionId: "controlled-session" }, fileUpload: { managedPath: "data/files/upload.csv" }, putWorkflow: {}, run: { runId: "controlled-run" },
      runStatus: { status: "completed", parentRoute: { provider: "fake", model: "fake" }, nodes: ["load_data", "quality_check", "sales_stats", "summary_gen", "report_gen"].map((nodeId) => ({ nodeId, status: "ok", childId: `fake-${nodeId}`, attempts: 1, provider: "fake", model: "fake", artifacts: [{ path: "controlled" }] })) },
    }
    response.setHeader("content-type", "application/json")
    response.end(JSON.stringify({ ok: true, value: values[endpoint] }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanups.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
  const port = (server.address() as { port: number }).port
  const result = execute(process.execPath, ["scripts/run-sales-live.mjs"], { env: { ...process.env, DSH_BASE_URL: `http://127.0.0.1:${port}`, DSH_TEST_PROVIDER: "fake", DSH_TEST_MODEL: "fake", DSH_TEST_WORKSPACE: workspace, DSH_WEB_LOG: "", SALES_CSV: source } })
  if (!failure) {
    const { stdout } = await result
    expect(JSON.parse(stdout.trim().split("\n").at(-1)!)).toMatchObject({ status: "passed", businessNodes: 5 })
  } else {
    await expect(result).rejects.toMatchObject({ stderr: expect.stringContaining(failure) })
  }
})

it.each(["text", "json"])("test_inputs_live_fake_HTTP_%s_uses_serial_auto_without_CSV_or_file_nodes", async (kind) => {
  const workspace = await mkdtemp(join(tmpdir(), "inputs-script-test-"))
  cleanups.push(() => rm(workspace, { recursive: true, force: true }))
  const requests: Array<{ endpoint: string; args: Record<string, unknown> }> = []
  const ids = kind === "text" ? ["uppercase", "annotate", "summarize"] : ["produce", "consume"]
  const final = kind === "text" ? "NOTE: HELLO WORKFLOW" : '{"doubled":42}'
  const server = createServer(async (request, response) => {
    let body = ""
    for await (const chunk of request) body += String(chunk)
    if (request.method === "GET") { response.end("ready"); return }
    const endpoint = request.url!.split("/").at(-1)!
    const { args } = JSON.parse(body)
    requests.push({ endpoint, args })
    const values: Record<string, unknown> = {
      createSession: { sessionId: "controlled-session" }, putWorkflow: {}, run: { runId: "controlled-run" },
      runStatus: { status: "completed", parentRoute: { provider: "fake", model: "fake" }, nodes: ids.map((nodeId) => ({ nodeId, status: "ok", childId: `fake-${nodeId}`, attempts: 1, provider: "fake", model: "fake", output: final })) },
    }
    response.setHeader("content-type", "application/json")
    response.end(JSON.stringify({ ok: true, value: values[endpoint] }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanups.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))
  const port = (server.address() as { port: number }).port
  const { stdout } = await execute(process.execPath, ["scripts/run-sales-live.mjs", `--${kind}`], { env: { ...process.env, DSH_BASE_URL: `http://127.0.0.1:${port}`, DSH_TEST_PROVIDER: "fake", DSH_TEST_MODEL: "fake", DSH_TEST_WORKSPACE: workspace, DSH_WEB_LOG: "", SALES_CSV: join(workspace, "absent.csv") } })
  expect(JSON.parse(stdout.trim().split("\n").at(-1)!)).toMatchObject({ status: "passed", testCase: kind, businessNodes: ids.length, result: final })
  const flow = requests.find(({ endpoint }) => endpoint === "putWorkflow")?.args.flow as { nodes: Array<{ kind: string; data: { outputSchema?: string } }>; lines: Array<{ targetHandle: string }> }
  expect(flow.nodes.some((node) => node.kind === "file")).toBe(false)
  expect(flow.lines.some((line) => line.targetHandle === "ctx-in")).toBe(false)
  expect(requests.some(({ endpoint }) => endpoint === "fileUpload")).toBe(false)
  for (const node of flow.nodes.filter((node) => node.kind === "agent")) expect(node.data.outputSchema).toContain(kind === "text" ? "文本" : "JSON")
  expect(requests.find(({ endpoint }) => endpoint === "run")?.args).toMatchObject({ handoffPolicy: "auto", runtimeInputs: { nodeInputs: { [ids[0]]: { source: [{ kind }] } } } })
})
