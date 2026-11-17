import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { MigratedToolRegistry } from "../../../src/host/migrated-tools/index.js"

const cleanups: string[] = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("MigratedToolRegistry", () => {
  it("loads a converted package and invokes its private worker through the DSH tool ref", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-migrated-tools-"))
    cleanups.push(root)
    const directory = join(root, "migrated-tools", "dsh_dify__example__echo@0.0.1")
    await mkdir(join(directory, "runtime"), { recursive: true })
    await mkdir(join(directory, "payload"), { recursive: true })
    await writeFile(join(directory, "dsh-tool-package.json"), JSON.stringify({
      schemaVersion: 1,
      id: "dsh_dify__example__echo",
      name: "echo",
      version: "0.0.1",
      description: "fixture",
      origin: { platform: "dify", targetVersion: "1.13.3", packageId: "example/echo:0.0.1@hash", sha256: "a".repeat(64), author: "example", plugin: "echo" },
      runtime: { kind: "python-dify-tool-worker", command: "python3", workerPath: "runtime/worker.py", payloadPath: "payload", timeoutMs: 5000 },
      credentials: [],
      tools: [{ ref: "dsh_migrated__example__echo__echo", name: "echo", label: "Echo", description: "Echo", provider: "echo", implementationPath: "tools/echo.py", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }],
    }))
    const worker = join(directory, "runtime", "worker.py")
    await writeFile(worker, "import json,sys\nr=json.load(sys.stdin)\njson.dump({'ok':True,'messages':[{'type':'text','value':'echo:'+r['arguments']['query']}]},sys.stdout)\n")
    await chmod(worker, 0o700)

    const registry = new MigratedToolRegistry(root)
    await registry.load()
    expect(registry.has("dsh_migrated__example__echo__echo")).toBe(true)
    expect(registry.list()).toEqual([expect.objectContaining({ origin: "dify", packageId: "dsh_dify__example__echo" })])
    await expect(registry.invoke("dsh_migrated__example__echo__echo", { query: "hello" })).resolves.toMatchObject({ text: "echo:hello" })
  })

  it("selects the requested migrated package version while exposing the newest version globally", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-migrated-versions-"))
    cleanups.push(root)
    await writeVersionedPackage(root, "0.0.1")
    await writeVersionedPackage(root, "0.0.2")

    const registry = new MigratedToolRegistry(root)
    await registry.load()

    expect(registry.list()).toEqual([expect.objectContaining({ version: "0.0.2" })])
    expect(registry.has("dsh_migrated__example__echo__echo", "example/echo:0.0.1@source-hash")).toBe(true)
    expect(registry.has("dsh_migrated__example__echo__echo", "example/echo:9.0.0@source-hash")).toBe(false)
    await expect(registry.invoke(
      "dsh_migrated__example__echo__echo",
      { query: "hello" },
      undefined,
      "example/echo:0.0.1@source-hash",
    )).resolves.toMatchObject({ text: "0.0.1:hello" })
  })
})

async function writeVersionedPackage(root: string, version: string): Promise<void> {
  const directory = join(root, "migrated-tools", `dsh_dify__example__echo@${version}`)
  await mkdir(join(directory, "runtime"), { recursive: true })
  await mkdir(join(directory, "payload"), { recursive: true })
  await writeFile(join(directory, "dsh-tool-package.json"), JSON.stringify({
    schemaVersion: 1,
    id: "dsh_dify__example__echo",
    name: "echo",
    version,
    description: "fixture",
    origin: { platform: "dify", targetVersion: "1.13.3", packageId: `example/echo:${version}@hash`, sha256: "a".repeat(64), author: "example", plugin: "echo" },
    runtime: { kind: "python-dify-tool-worker", command: "python3", workerPath: "runtime/worker.py", payloadPath: "payload", timeoutMs: 5000 },
    credentials: [],
    tools: [{ ref: "dsh_migrated__example__echo__echo", name: "echo", label: "Echo", description: "Echo", provider: "echo", implementationPath: "tools/echo.py", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } }],
  }))
  const worker = join(directory, "runtime", "worker.py")
  await writeFile(worker, `import json,sys\nr=json.load(sys.stdin)\njson.dump({'ok':True,'messages':[{'type':'text','value':'${version}:'+r['arguments']['query']}]},sys.stdout)\n`)
  await chmod(worker, 0o700)
}
