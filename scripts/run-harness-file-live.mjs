// Independent official Harness file probe. Boots a caller-selected test config; no Workflow Runtime.
import assert from "node:assert/strict"
import { randomBytes, randomUUID } from "node:crypto"
import { createRequire } from "node:module"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"

if (process.argv.includes("--help")) {
  console.log(`Run on the DSH host with a dedicated test config and the existing sandbox/permission services.
Required: DSH_RUNTIME_PACKAGE (installed @deepseek-ai/dsh/package.json), DSH_TEST_CONFIG (absolute Cordis config),
DSH_TEST_PROVIDER, DSH_TEST_MODEL (exact configured routing names).
Optional: DSH_TEST_PRESET (existing default if omitted), DSH_TEST_WORKSPACE (current directory if omitted),
DSH_TEST_TIMEOUT_MS (240000), DSH_TEST_REPORT (harness-file-live-result.json).
Creates one official attachment and one spawn child. Records admitted ref, durable delivery, official handle,
actual read outcomes, official per-step Usage, and elapsed time. No profile, provider, credentials or sandbox override.
Requires the official attachments, agents, agentPresets, llm, subagents/spawn and fs services in that config.
--sdk-check validates published methods without booting the config or calling a model.
This is a real model probe only when run; SDK smoke or --help is not a model E2E.`)
  process.exit(0)
}

const manifest = process.env.DSH_RUNTIME_PACKAGE
const config = process.env.DSH_TEST_CONFIG
const provider = process.env.DSH_TEST_PROVIDER
const model = process.env.DSH_TEST_MODEL
if (process.argv.includes("--sdk-check")) {
  assert.ok(manifest, "Set DSH_RUNTIME_PACKAGE")
  const requireRuntime = createRequire(resolve(manifest))
  const runtimeImport = (name) => import(pathToFileURL(requireRuntime.resolve(name)).href)
  const modules = await Promise.all(["@deepseek-ai/dsh-app-boot", "@deepseek-ai/dsh-agent", "@deepseek-ai/dsh-subagent", "@deepseek-ai/dsh-llm", "@deepseek-ai/dsh-attachment-local"].map(runtimeImport))
  assert.equal(typeof modules[0].boot, "function")
  for (const [index, method] of [[1, "create"], [2, "startContinuable"], [3, "fileRequestText"], [4, "saveFile"]]) assert.ok(Object.values(modules[index]).some((value) => typeof value === "function" && typeof value.prototype?.[method] === "function"), `Missing published ${method} API`)
  let presets
  try { presets = await runtimeImport("@deepseek-ai/dsh-agent-preset-registry") } catch { presets = await runtimeImport("@deepseek-ai/dsh-agent-presets") }
  assert.ok(Object.values(presets).some((value) => typeof value === "function" && typeof value.prototype?.mount === "function"))
  console.log(JSON.stringify({ status: "SDK_INTERFACE_PASSED", runtimeVersion: requireRuntime("./package.json").version, modelE2E: "NOT RUN" }))
  process.exit(0)
}
assert.ok(manifest && config && provider && model, "Set DSH_RUNTIME_PACKAGE, DSH_TEST_CONFIG, DSH_TEST_PROVIDER and DSH_TEST_MODEL; do not supply keys to the script")
assert.equal(resolve(config), config, "DSH_TEST_CONFIG must be absolute and reference a dedicated test configuration")
const timeoutMs = Number(process.env.DSH_TEST_TIMEOUT_MS ?? 240000)
assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0)
const workspace = resolve(process.env.DSH_TEST_WORKSPACE ?? process.cwd())
const reportPath = resolve(process.env.DSH_TEST_REPORT ?? "harness-file-live-result.json")
await mkdir(workspace, { recursive: true })
const requireRuntime = createRequire(resolve(manifest))
const runtimeImport = (name) => import(pathToFileURL(requireRuntime.resolve(name)).href)
const { boot, loadLayeredEnv } = await runtimeImport("@deepseek-ai/dsh-app-boot")
const { DSH_LAUNCH_ENVIRONMENT_KEY } = await runtimeImport("@deepseek-ai/dsh-launch-environment")
const startedAt = Date.now()
const report = { kind: "real-harness-model-probe", status: "NOT RUN", provider, model, phases: {}, tools: [], modelCalls: 0, usage: "unavailable" }
let root, parentHandle, childId, childFs
const modelEvents = []
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(new Error("file probe timed out")), timeoutMs)
try {
  const environment = loadLayeredEnv("harness-file-probe", workspace)
  root = await boot("harness-file-probe", config, [], (ctx) => { ctx[DSH_LAUNCH_ENVIRONMENT_KEY] = environment }, pathToFileURL(resolve(manifest)).href)
  const attachments = root.get("attachments")
  const agents = root.get("agents")
  const presets = root.get("agentPresets")
  const subagents = root.get("subagents")
  assert.ok(attachments?.saveFile && agents?.create && presets?.mount && subagents?.getProvider?.("spawn"), "The selected test config must provide the real services and isolated spawn provider")
  const expected = `Harness file probe: ${randomBytes(16).toString("hex")}\n`
  const ref = await attachments.saveFile({ name: `harness-probe-${randomUUID()}.txt`, data: Buffer.from(expected) })
  report.phases.authorizedReference = { attachmentId: ref.attachmentId, name: ref.name, bytes: ref.bytes }
  parentHandle = await agents.create({ sessionId: randomUUID(), meta: { cwd: workspace }, agentOptions: { provider, model }, signal: controller.signal,
    setup: async (ctx) => { await ctx.get("agentPresets").mount(ctx, process.env.DSH_TEST_PRESET) } })
  const parent = parentHandle.agent
  let resolveEnd
  const ended = new Promise((resolveEndValue) => { resolveEnd = resolveEndValue })
  // Created is earlier than the first tool dispatch and the start receipt.
  root.on("agent/created", ({ agent }) => {
    if (!childId && agent?.session?.header?.parentSession === parent.id) {
      childId = agent.id
      childFs = agent.ctx.get("fs")
      report.phases.readToolAvailable = root.get("tools")?.schemas(agent)?.some((schema) => schema.name === "read") ?? false
      report.phases.officialHandle = agent.ctx.get("llm")?.fileRequestText(ref) ?? "unavailable"
      report.sandboxMode = agent.ctx.get("fs")?.sandboxMode ?? "unavailable"
    }
  })
  root.on("session/event", (session, event) => {
    if (session.id !== childId && session.id !== parent.id) return
    if (session.id === childId && event.type === "user/message" && event.data?.content?.some((block) => block.type === "file" && block.attachment?.attachmentId === ref.attachmentId)) report.phases.durableDelivery = true
    if (event.type === "assistant/message" || event.type === "assistant/attempt") modelEvents.push({ role: session.id === childId ? "child" : "parent", type: event.type, usage: event.data?.usage })
  })
  root.on("llm/stream", (options, next) => {
    if (options.messages?.some((message) => message.content?.some((block) => block.type === "file" && block.attachment?.attachmentId === ref.attachmentId))) report.phases.requestIncludesFileRef = true
    return next()
  })
  root.on("tools/result", (exec, result) => {
    if (exec.agent?.id !== childId) return
    report.tools.push({ name: exec.name, callId: exec.callId, isError: result.isError, errorCode: result.error?.info?.code,
      ...(exec.name === "read" ? { filePath: exec.arguments?.file_path, matchesHandle: exec.arguments?.file_path === childFs?.processPathFromHostPath(attachments.fileHostPath(ref)), contentMatches: result.content?.some((block) => block.type === "text" && block.text.includes(expected.trim())) } : {}) })
  })
  root.on("subagent/end", (info) => { if (info.id === childId) resolveEnd(info) })
  const aborted = new Promise((_, reject) => {
    if (controller.signal.aborted) reject(controller.signal.reason)
    else controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true })
  })
  const started = await subagents.startContinuable({ provider: "spawn", label: "independent-file-read-probe", signal: controller.signal,
    request: { parent, agentOptions: { provider, model }, prompt: [
      { type: "text", text: "Read the attached file using your authorized official read tool and return its exact complete contents. Use the official file handle, not a guessed workspace path. If permissions or sandbox prevent reading, report the actual failure and stop. Do not change permissions, search unrelated files or retry the same failure." },
      { type: "file", attachment: ref },
    ] } })
  childId = started.childId
  report.childId = childId
  report.status = "RUNNING"
  const info = await Promise.race([ended, aborted])
  report.stopReason = info.stopReason
  report.phases.finalProviderProjection = "not exposed by public stream hook; official handle and read-path correlation recorded"
  report.phases.actualRead = report.tools.some((tool) => tool.name === "read" && !tool.isError && tool.contentMatches)
  const output = (info.lastAssistantMessage ?? []).filter((block) => block.type === "text").map((block) => block.text).join("")
  report.contentMatches = output.includes(expected.trim())
  assert.equal(info.stopReason, "completed", "child did not complete")
  assert.equal(report.phases.durableDelivery, true, "child durable prompt lacks the official file block")
  assert.equal(report.phases.actualRead, true, "no successful official read of the resolved attachment handle")
  assert.equal(report.contentMatches, true, "child did not report actual file contents")
  report.status = "PASSED"
} catch (error) {
  report.status = childId ? "FAILED" : "NOT RUN"
  report.errorCode = error.code ?? error.name
  process.exitCode = 1
} finally {
  clearTimeout(timer)
  if (root && childId) { try { await root.get("subagents").interrupt(childId, { kind: "user", parentSessionId: parentHandle.agent.id }) } catch {} }
  try { await parentHandle?.dispose() } catch (error) { report.cleanupError = error.name; process.exitCode = 1 }
  try { await root?.fiber.dispose() } catch (error) { report.cleanupError = error.name; process.exitCode = 1 }
  report.modelCalls = modelEvents.length
  report.modelCallsByRole = { parent: modelEvents.filter((event) => event.role === "parent").length, child: modelEvents.filter((event) => event.role === "child").length }
  const usages = modelEvents.filter((event) => Number.isFinite(event.usage?.inputTokens) && Number.isFinite(event.usage?.outputTokens)).map((event) => event.usage)
  if (usages.length) report.usage = { source: "official assistant/message Usage, one durable event per step", reportedSteps: usages.length, complete: usages.length === modelEvents.length,
    inputTokens: usages.reduce((sum, usage) => sum + usage.inputTokens, 0), outputTokens: usages.reduce((sum, usage) => sum + usage.outputTokens, 0),
    cacheReadTokens: usages.reduce((sum, usage) => sum + (usage.cacheReadTokens ?? 0), 0), cacheWriteTokens: usages.reduce((sum, usage) => sum + (usage.cacheWriteTokens ?? 0), 0) }
  report.modelE2E = report.modelCallsByRole.child ? "EXECUTED" : report.phases.requestIncludesFileRef ? "REQUESTED" : "NOT RUN"
  if (report.cleanupError) report.status = "FAILED"
  report.elapsedMs = Date.now() - startedAt
  await writeFile(reportPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: report.status, report: reportPath, elapsedMs: report.elapsedMs }))
}
