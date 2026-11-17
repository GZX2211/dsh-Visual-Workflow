import { spawn } from "node:child_process";
import { readdir, readFile, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
const MAX_WORKER_OUTPUT = 8 * 1024 * 1024;
/** DSH is the only public registry. The private Python worker is an implementation detail. */
export class MigratedToolRegistry {
    dataDirectory;
    tools = new Map();
    credentials = {};
    disposers = [];
    constructor(dataDirectory) {
        this.dataDirectory = dataDirectory;
    }
    async load() {
        this.tools.clear();
        this.credentials = await readCredentials(this.dataDirectory);
        const root = join(this.dataDirectory, "migrated-tools");
        const directories = await readdir(root, { withFileTypes: true }).catch((error) => {
            if (error.code === "ENOENT")
                return [];
            throw error;
        });
        for (const entry of directories.sort((left, right) => left.name.localeCompare(right.name))) {
            if (!entry.isDirectory() || entry.name.startsWith("."))
                continue;
            const packageDirectory = join(root, entry.name);
            const manifest = await readManifest(join(packageDirectory, "dsh-tool-package.json"));
            for (const tool of manifest.tools) {
                const versions = this.tools.get(tool.ref) ?? [];
                if (versions.some((loaded) => loaded.manifest.version === manifest.version)) {
                    throw new Error(`迁移工具版本冲突：${tool.ref}@${manifest.version}`);
                }
                versions.push({ packageDirectory, manifest, tool });
                versions.sort((left, right) => compareVersions(right.manifest.version, left.manifest.version));
                this.tools.set(tool.ref, versions);
            }
        }
    }
    register(ctx) {
        const service = ctx.get("tools");
        this.disposeRegistrations();
        // Some embedded/test hosts intentionally omit the public tool catalog. An empty migrated
        // registry is still valid there; installed tools, however, must never be silently hidden.
        if (!service || typeof service.register !== "function") {
            if (this.tools.size > 0)
                throw new Error("DSH tools service unavailable while migrated tools are installed");
            return;
        }
        for (const loaded of this.activeTools()) {
            const definition = {
                name: loaded.tool.ref,
                description: `${loaded.tool.description || loaded.tool.label} [Migrated from Dify: ${loaded.manifest.origin.packageId}]`,
                parameters: loaded.tool.inputSchema,
                output: {
                    schema: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                            text: { type: "string" },
                            messages: { type: "array", items: { type: "object", additionalProperties: true } },
                        },
                        required: ["text", "messages"],
                    },
                    render: (_argumentsValue, value) => [{ type: "text", text: renderResult(value) }],
                },
                execute: (argumentsValue, execution) => this.invoke(loaded.tool.ref, argumentsValue, execution.signal),
                timeoutMs: loaded.manifest.runtime.timeoutMs,
            };
            this.disposers.push(service.register(definition));
        }
    }
    async reload(ctx) {
        await this.load();
        this.register(ctx);
    }
    disposeRegistrations() {
        for (const dispose of this.disposers.splice(0))
            dispose();
    }
    has(toolRef, requestedPackage) {
        return this.select(toolRef, requestedPackage) !== undefined;
    }
    list() {
        return this.activeTools().map(({ tool, manifest }) => ({
            ref: tool.ref,
            label: tool.label,
            packageId: manifest.id,
            version: manifest.version,
            origin: "dify",
        }));
    }
    async invoke(toolRef, argumentsValue, signal, requestedPackage) {
        const loaded = this.select(toolRef, requestedPackage);
        if (!loaded)
            throw new Error(`未安装或未加载迁移工具：${toolRef}${requestedVersionOf(requestedPackage) ? `@${requestedVersionOf(requestedPackage)}` : ""}`);
        const credentials = this.credentials[loaded.manifest.id] ?? {};
        const missing = loaded.manifest.credentials.filter((credential) => credential.required && credentials[credential.name] === undefined);
        if (missing.length > 0)
            throw new Error(`迁移工具 ${loaded.manifest.id} 缺少凭据：${missing.map((item) => item.name).join("、")}`);
        return invokeWorker(loaded, argumentsValue, credentials, signal);
    }
    activeTools() {
        return [...this.tools.values()].flatMap((versions) => versions[0] ? [versions[0]] : []);
    }
    select(toolRef, requestedPackage) {
        const versions = this.tools.get(toolRef) ?? [];
        const requestedVersion = requestedVersionOf(requestedPackage);
        return requestedVersion ? versions.find((loaded) => loaded.manifest.version === requestedVersion) : versions[0];
    }
}
function requestedVersionOf(value) {
    const match = value?.match(/^[^/]+\/[^:]+:([^@]+)(?:@|$)/);
    return match?.[1];
}
function compareVersions(left, right) {
    return left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
}
async function invokeWorker(loaded, argumentsValue, credentials, signal) {
    const runtime = loaded.manifest.runtime;
    const packageDirectory = await realpath(loaded.packageDirectory);
    const workerPath = await safeRealpath(packageDirectory, runtime.workerPath);
    const payloadPath = await safeRealpath(packageDirectory, runtime.payloadPath);
    const request = JSON.stringify({
        payloadPath,
        implementationPath: loaded.tool.implementationPath,
        arguments: argumentsValue,
        credentials,
    });
    return await new Promise((resolvePromise, reject) => {
        const controller = new AbortController();
        const onAbort = () => controller.abort(signal?.reason);
        signal?.addEventListener("abort", onAbort, { once: true });
        const timeout = setTimeout(() => controller.abort(new Error("migrated tool timeout")), runtime.timeoutMs);
        const child = spawn(runtime.command, [workerPath], {
            cwd: payloadPath,
            env: workerEnvironment(),
            stdio: ["pipe", "pipe", "pipe"],
            signal: controller.signal,
            windowsHide: true,
        });
        const stdout = [];
        const stderr = [];
        let outputBytes = 0;
        const collect = (target, chunk) => {
            outputBytes += chunk.byteLength;
            if (outputBytes > MAX_WORKER_OUTPUT)
                controller.abort(new Error("migrated tool output limit exceeded"));
            else
                target.push(chunk);
        };
        child.stdout.on("data", (chunk) => collect(stdout, chunk));
        child.stderr.on("data", (chunk) => collect(stderr, chunk));
        child.on("error", finishError);
        child.on("close", (code) => {
            cleanup();
            let response;
            try {
                response = JSON.parse(Buffer.concat(stdout).toString("utf8"));
            }
            catch {
                reject(new Error(`迁移工具返回无效 JSON（exit ${code ?? "unknown"}）：${Buffer.concat(stderr).toString("utf8").slice(0, 2000)}`));
                return;
            }
            if (code !== 0 || response.ok !== true) {
                reject(new Error(`迁移工具执行失败：${String(response.error?.message ?? (Buffer.concat(stderr).toString("utf8") || `exit ${code}`))}`));
                return;
            }
            const messages = parseMessages(response.messages);
            resolvePromise({ text: messages.map(messageText).filter(Boolean).join("\n"), messages });
        });
        child.stdin.end(request);
        function cleanup() {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", onAbort);
        }
        function finishError(error) {
            cleanup();
            reject(error);
        }
    });
}
async function safeRealpath(root, relativePath) {
    const candidate = await realpath(resolve(root, relativePath));
    if (candidate !== root && !candidate.startsWith(root + sep))
        throw new Error(`迁移工具路径越界：${relativePath}`);
    return candidate;
}
async function readManifest(path) {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.id !== "string" || typeof value.version !== "string"
        || !isRecord(value.origin) || value.origin.platform !== "dify" || !isRecord(value.runtime) || value.runtime.kind !== "python-dify-tool-worker"
        || !Array.isArray(value.credentials) || !Array.isArray(value.tools))
        throw new Error(`无效的 DSH 迁移工具包：${path}`);
    const manifest = value;
    if (manifest.tools.some((tool) => !tool.ref.startsWith("dsh_migrated__") || !tool.implementationPath || !isRecord(tool.inputSchema))) {
        throw new Error(`无效的 DSH 迁移工具声明：${path}`);
    }
    return manifest;
}
async function readCredentials(dataDirectory) {
    const path = join(dataDirectory, "migrated-tool-credentials.json");
    try {
        const value = JSON.parse(await readFile(path, "utf8"));
        if (!isRecord(value))
            throw new Error("credential root must be an object");
        return Object.fromEntries(Object.entries(value).filter((entry) => isRecord(entry[1])));
    }
    catch (error) {
        if (error.code === "ENOENT")
            return {};
        throw new Error(`迁移工具凭据文件无效：${path}`, { cause: error });
    }
}
function workerEnvironment() {
    // Deliberately omit the Host's PYTHONPATH and every application/model secret.
    const keys = ["PATH", "SYSTEMROOT", "WINDIR", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "PYTHONHOME"];
    return Object.fromEntries(keys.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
}
function parseMessages(value) {
    if (!Array.isArray(value))
        throw new Error("迁移工具输出缺少 messages 数组");
    return value.map((item) => {
        if (!isRecord(item) || typeof item.type !== "string" || !("value" in item))
            throw new Error("迁移工具 message 结构无效");
        return { type: item.type, value: item.value, ...(isRecord(item.meta) || item.meta === null ? { meta: item.meta } : {}) };
    });
}
function messageText(message) {
    if (message.type === "text" || message.type === "link" || message.type === "image")
        return String(message.value ?? "");
    return JSON.stringify(message.value);
}
function renderResult(value) {
    if (isRecord(value) && typeof value.text === "string")
        return value.text;
    return JSON.stringify(value);
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=registry.js.map