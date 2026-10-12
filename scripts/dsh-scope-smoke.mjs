// Optional integration check against an independently installed official DSH.
// No model mock, credential, or official runtime source patch is involved.
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { CordisToolsView, withPresetScope } from "../lib/agent/index.js"
import { installChildToolPolicy } from "../lib/agent/child-tool-filter.js"
import { createModelSelectionSetup } from "../lib/agent/model-selection.js"
import { createChildPromptSetup } from "../lib/agent/prompt-setup.js"

const manifest = process.env.DSH_RUNTIME_PACKAGE
assert.ok(manifest, "Set DSH_RUNTIME_PACKAGE to the absolute path of @deepseek-ai/dsh/package.json")
const requireRuntime = createRequire(manifest)
const runtimeImport = (name) => import(pathToFileURL(requireRuntime.resolve(name)).href)
const [{ Context }, { SystemPrompt }, { ToolRuntime }, { createScope }] = await Promise.all([
  runtimeImport("@deepseek-ai/cordis"), runtimeImport("@deepseek-ai/dsh-system-prompt"),
  runtimeImport("@deepseek-ai/dsh-tools"), runtimeImport("@deepseek-ai/dsh-scope"),
])
const root = new Context()
const owned = []
const presetDirectory = await mkdtemp(join(tmpdir(), "dsh-preset-compat-"))
try {
  await root.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: false })
  await root.plugin(ToolRuntime, { mode: "native" })
  const definition = (name) => ({
    name, description: name, parameters: { type: "object", properties: {}, additionalProperties: false },
    output: { schema: { type: "null" }, render: () => [{ type: "text", text: "executed" }] },
    execute: async () => null,
  })
  // Exercise the real public Registry and Loader with a controlled composition;
  // this is an interface/permission smoke, not shipped-standard or model E2E.
  const [{ Loader }, { SessionProjectionRegistry }] = await Promise.all([
    runtimeImport("@deepseek-ai/cordis-plugin-loader"), runtimeImport("@deepseek-ai/dsh-session-projection"),
  ])
  let registryPackage
  try {
    requireRuntime.resolve("@deepseek-ai/dsh-agent-preset-registry")
    registryPackage = "@deepseek-ai/dsh-agent-preset-registry"
  } catch { registryPackage = "@deepseek-ai/dsh-agent-presets" }
  const { COMPOSITION_FILE } = await runtimeImport(registryPackage)
  await root.plugin(Loader, { baseUrl: pathToFileURL(manifest).href })
  await root.plugin(SessionProjectionRegistry)
  root.get("loader").builtins["compat-tools"] = { apply(context) {
    for (const name of ["read", "write"]) context.get("tools").register(definition(name))
  } }
  await mkdir(join(presetDirectory, "compat-probe"))
  await writeFile(join(presetDirectory, "compat-probe", COMPOSITION_FILE ?? "agent.cordis.yml"), JSON.stringify([{ name: "cordis:compat-tools" }]))
  await root.get("loader").create({ name: registryPackage, config: {
    default: "compat-probe", roots: [{ path: presetDirectory, trust: "system" }], includeShippedRoot: false, includeUserRoot: false,
  } })
  await root.get("loader").await()
  const presets = root.get("agentPresets")
  const unregister = typeof presets.register === "function" ? await presets.register({ id: "compat-probe", plugins: [{ name: "cordis:compat-tools" }] }) : undefined
  const view = new CordisToolsView(root)
  for (let i = 0; i < 5; i++) assert.deepEqual(await view.presetToolNames("compat-probe"), ["read", "write"])
  const registryKey = await withPresetScope(presets, "compat-probe", (key) => key)
  if (unregister) {
    await unregister()
    assert.deepEqual(root.get("tools").schemas(registryKey), [], "released leases must allow the retired composition to unmount")
  }
  const presetScopeApi = typeof presets.acquireScope === "function" ? "acquireScope" : "standingKeyFor"
  for (const name of ["read", "write", "mcp__server__read", "wf_finish"]) root.get("tools").register(definition(name))
  const presetKey = {}
  const preset = createScope(root, presetKey)
  owned.push(preset)
  preset.ctx.get("tools").register(definition("str_replace_editor"))
  const parent = { id: "parent" }
  const parentScope = createScope(root, parent)
  owned.push(parentScope)
  parentScope.ctx.get("tools").register(definition("subagent"))
  let sequence = 0
  const invoke = (agent, name) => root.get("tools").execute({ callId: `scope-${++sequence}`, name, arguments: {}, agent, signal: new AbortController().signal })
  const child = { id: "child" }
  const scope = createScope(root, child, { parent: presetKey })
  owned.push(scope)
  for (const name of ["custom", "send_message", "wf_finish"]) scope.ctx.get("tools").register(definition(name))
  assert.equal(root.get("tools").get("subagent", child), undefined)
  assert.equal(root.get("tools").get("str_replace_editor", parent), undefined)
  assert.ok(root.get("tools").get("str_replace_editor", child))
  const dispose = installChildToolPolicy(scope.ctx, ["read", "subagent", "str_replace_editor", "mcp__server__read", "custom"], child)
  for (const name of ["read", "str_replace_editor", "mcp__server__read", "custom", "send_message"]) assert.equal((await invoke(child, name)).isError, false, `${name} must execute`)
  for (const name of ["write", "wf_finish"]) assert.equal((await invoke(child, name)).isError, true, `${name} must be denied`)
  dispose()
  const empty = installChildToolPolicy(scope.ctx, [], child)
  for (const name of ["read", "custom", "wf_finish"]) assert.equal((await invoke(child, name)).isError, true, `empty policy must deny ${name}`)
  assert.equal((await invoke(child, "send_message")).isError, false)
  empty()
  const unconfigured = installChildToolPolicy(scope.ctx, undefined, child)
  assert.equal((await invoke(child, "read")).isError, false)
  assert.equal((await invoke(child, "wf_finish")).isError, true)
  unconfigured()
  let dispatched = false
  assert.throws(() => {
    installChildToolPolicy(scope.ctx, ["ghost"], child)
    dispatched = true
  }, /实际子代理作用域不可用/)
  assert.equal(dispatched, false, "failed creation must not dispatch")
  assert.equal((await invoke(child, "custom")).isError, false, "failed installation must release its contributions")
  const replacement = installChildToolPolicy(scope.ctx, [], child)
  assert.equal((await invoke(child, "custom")).isError, true, "replacement scope policy must remain closed")
  replacement()
  let publicRecoveryHooksPassed = 0
  let modelRouteUpdates = 0
  await root.inject(["systemPrompt"], async (context) => {
    const hookAgent = { id: "hook-parent" }
    const hookScope = createScope(context, hookAgent)
    owned.push(hookScope)
    const models = createModelSelectionSetup()
    const prompts = createChildPromptSetup()
    prompts.bindParent(hookScope.ctx, { systemPrompt: "角色", injectSystemPrompt: true, injectToolSections: true }, hookAgent.id)
    for (const model of ["first-route", "resume-route"]) {
      models.bindParent(hookScope.ctx, { provider: "configured", model }, hookAgent.id)
      const assembled = await hookScope.ctx.waterfall("system-prompt/assemble", {}, {}, async () => ({ variables: {} }))
      assert.equal(assembled.variables.model, model)
      const config = await hookScope.ctx.waterfall("agent/request", {}, async () => ({ provider: "default", model: "default" }))
      assert.deepEqual(config, { provider: "configured", model })
      modelRouteUpdates++
    }
    // 官方恢复钩子的 next/重试结果必须穿过父代理贡献；这不是压缩或真实模型验收。
    const preStep = await hookScope.ctx.waterfall("agent/pre-step", { agent: hookAgent }, async () => true)
    const retry = await hookScope.ctx.waterfall("agent/request-error", { agent: hookAgent, failure: { code: "CONTEXT_WINDOW_EXCEEDED" } }, async () => ({ kind: "retry" }))
    assert.equal(preStep, true)
    assert.deepEqual(retry, { kind: "retry" })
    publicRecoveryHooksPassed = 2
  })
  assert.equal(publicRecoveryHooksPassed, 2)
  assert.equal(modelRouteUpdates, 2)
  // Exercise published attachment storage and file-block projection, without a model or custom file tool.
  const [{ LocalAttachmentStore }, { createUserMessage, projectFilesToText, fileHandleText }] = await Promise.all([
    runtimeImport("@deepseek-ai/dsh-attachment-local"), runtimeImport("@deepseek-ai/dsh-llm"),
  ])
  await root.plugin(LocalAttachmentStore, { dshHome: presetDirectory })
  const attachments = root.get("attachments")
  const bytes = Buffer.from("authorized task document")
  const ref = await attachments.saveFile({ data: bytes, name: "generic.payload" })
  assert.deepEqual(Object.keys(ref).sort(), ["attachmentId", "bytes", "name"])
  const hostPath = attachments.fileHostPath(ref)
  assert.deepEqual(await readFile(hostPath), bytes)
  const chunks = []
  for await (const chunk of attachments.readFileStream(ref)) chunks.push(chunk)
  assert.deepEqual(Buffer.concat(chunks), bytes)
  const message = createUserMessage({ content: [{ type: "file", attachment: ref }], source: { kind: "user" } })
  const projected = projectFilesToText([message], (file) => attachments.fileHostPath(file))
  assert.deepEqual(projected[0].content, [{ type: "text", text: fileHandleText(ref, hostPath) }])
  assert.deepEqual(message.content, [{ type: "file", attachment: ref }], "durable official file references must remain intact")
  console.log(JSON.stringify({ status: "passed", runtimeVersion: requireRuntime("./package.json").version, runtime: "@deepseek-ai/dsh-tools", presetScopeApi, actualPresetReads: 6, actualScopedExecutions: sequence, publicRecoveryHooksPassed, modelRouteUpdates, officialFileReferences: 1, officialFileBytes: bytes.length, modelE2E: "NOT RUN" }))
} finally {
  for (const scope of owned.reverse()) await scope.dispose()
  await root.fiber.dispose()
  await rm(presetDirectory, { recursive: true, force: true })
}
