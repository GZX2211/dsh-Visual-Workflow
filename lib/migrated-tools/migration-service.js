import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024;
const MIGRATION_TIMEOUT_MS = 10 * 60 * 1000;
export class MigratedToolMigrationError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.code = code;
        this.name = "MigratedToolMigrationError";
    }
}
/** Owns upload staging and invokes the separately installed migration compiler. */
export class MigratedToolMigrationService {
    options;
    driver;
    constructor(options) {
        this.options = options;
        this.driver = options.driver ?? new CommandMigrationDriver(options.command);
    }
    async install(upload) {
        const extension = uploadExtension(upload.name);
        const bytes = decodeUpload(upload.base64);
        if (bytes.byteLength > MAX_UPLOAD_BYTES)
            throw new MigratedToolMigrationError("DIFY_UPLOAD_TOO_LARGE", `上传文件超过 ${MAX_UPLOAD_BYTES / 1024 / 1024}MB 限制`);
        await mkdir(this.options.dataDirectory, { recursive: true, mode: 0o700 });
        const staging = await mkdtemp(join(this.options.dataDirectory, ".dify-tool-migration-"));
        try {
            const inputPath = join(staging, `upload${extension}`);
            const outputDirectory = join(staging, "converted");
            await writeFile(inputPath, bytes, { mode: 0o600 });
            const report = parseReport(await this.driver.convert(inputPath, outputDirectory, this.options.dataDirectory));
            if (report.summary.installed > 0)
                await this.options.refresh();
            return { uploadName: basename(upload.name), packages: report.packages, summary: report.summary };
        }
        finally {
            await rm(staging, { recursive: true, force: true });
        }
    }
}
class CommandMigrationDriver {
    command;
    constructor(command) {
        this.command = command;
    }
    async convert(inputPath, outputDirectory, installDirectory) {
        const reportPath = join(outputDirectory, "..", "conversion-report.json");
        await runProcess(this.command, [
            "convert",
            inputPath,
            "--output",
            outputDirectory,
            "--install",
            installDirectory,
            "--report",
            reportPath,
        ]);
        try {
            return JSON.parse(await readFile(reportPath, "utf8"));
        }
        catch (error) {
            throw new MigratedToolMigrationError("DIFY_MIGRATION_REPORT_INVALID", "迁移器没有生成有效报告", { cause: error });
        }
    }
}
function runProcess(command, args) {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(command, args, {
            env: migrationEnvironment(),
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        const output = [];
        let outputBytes = 0;
        let settled = false;
        const timeout = setTimeout(() => {
            child.kill("SIGKILL");
            finish(new MigratedToolMigrationError("DIFY_MIGRATION_TIMEOUT", "Dify 工具包迁移超时"));
        }, MIGRATION_TIMEOUT_MS);
        const collect = (chunk) => {
            outputBytes += chunk.byteLength;
            if (outputBytes > MAX_PROCESS_OUTPUT_BYTES) {
                child.kill("SIGKILL");
                finish(new MigratedToolMigrationError("DIFY_MIGRATION_OUTPUT_LIMIT", "迁移器输出超过限制"));
            }
            else {
                output.push(chunk);
            }
        };
        child.stdout.on("data", collect);
        child.stderr.on("data", collect);
        child.on("error", (error) => {
            const code = error.code === "ENOENT" ? "DIFY_MIGRATOR_UNAVAILABLE" : "DIFY_MIGRATION_FAILED";
            finish(new MigratedToolMigrationError(code, error.code === "ENOENT" ? `找不到迁移器命令：${command}` : `无法启动迁移器：${error.message}`, { cause: error }));
        });
        child.on("close", (code) => {
            // Exit 2 means one or more packages failed; the report still contains all successful installs.
            if (code === 0 || code === 2)
                finish();
            else
                finish(new MigratedToolMigrationError("DIFY_MIGRATION_FAILED", Buffer.concat(output).toString("utf8").slice(0, 4000) || `迁移器退出码：${code ?? "unknown"}`));
        });
        function finish(error) {
            if (settled)
                return;
            settled = true;
            clearTimeout(timeout);
            if (error)
                reject(error);
            else
                resolvePromise();
        }
    });
}
function uploadExtension(name) {
    const extension = extname(name.trim()).toLowerCase();
    if (extension !== ".difypkg" && extension !== ".zip") {
        throw new MigratedToolMigrationError("DIFY_UPLOAD_INVALID", "仅支持 .difypkg 或包含多个 .difypkg 的 .zip 文件");
    }
    return extension;
}
function decodeUpload(value) {
    const normalized = value.replace(/\s/g, "");
    if (!normalized || !/^[a-zA-Z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
        throw new MigratedToolMigrationError("DIFY_UPLOAD_INVALID", "上传内容不是有效 Base64");
    }
    const bytes = Buffer.from(normalized, "base64");
    if (bytes.toString("base64").replace(/=+$/, "") !== normalized.replace(/=+$/, "")) {
        throw new MigratedToolMigrationError("DIFY_UPLOAD_INVALID", "上传内容不是有效 Base64");
    }
    return bytes;
}
function parseReport(value) {
    if (!isRecord(value) || !Array.isArray(value.packages) || !isRecord(value.summary)) {
        throw new MigratedToolMigrationError("DIFY_MIGRATION_REPORT_INVALID", "迁移报告结构无效");
    }
    const packages = value.packages.map(parsePackage);
    const summary = {
        discovered: integer(value.summary.discovered),
        installed: integer(value.summary.installed),
        converted: integer(value.summary.converted),
        skipped: integer(value.summary.skipped),
        duplicates: integer(value.summary.duplicates),
        failed: integer(value.summary.failed),
    };
    return { packages, summary };
}
function parsePackage(value) {
    if (!isRecord(value) || typeof value.sourcePath !== "string" || !["installed", "converted", "skipped", "duplicate", "failed"].includes(String(value.status))) {
        throw new MigratedToolMigrationError("DIFY_MIGRATION_REPORT_INVALID", "迁移报告包含无效包记录");
    }
    return {
        // The compiler runs in a private staging directory. Never expose that host path to the UI.
        sourcePath: basename(value.sourcePath),
        status: value.status,
        ...(typeof value.packageId === "string" ? { packageId: value.packageId } : {}),
        ...(typeof value.dshPackageId === "string" ? { dshPackageId: value.dshPackageId } : {}),
        ...(typeof value.version === "string" ? { version: value.version } : {}),
        ...(typeof value.disposition === "string" ? { disposition: value.disposition } : {}),
        ...(Array.isArray(value.tools) ? { tools: value.tools.filter((item) => typeof item === "string") } : {}),
        ...(Array.isArray(value.credentials) ? { credentials: value.credentials.filter((item) => typeof item === "string") } : {}),
        ...(isRecord(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string"
            ? { error: { code: value.error.code, message: value.error.message } }
            : {}),
    };
}
function integer(value) {
    if (!Number.isSafeInteger(value) || Number(value) < 0)
        throw new MigratedToolMigrationError("DIFY_MIGRATION_REPORT_INVALID", "迁移报告汇总字段无效");
    return Number(value);
}
function migrationEnvironment() {
    const keys = ["PATH", "SYSTEMROOT", "WINDIR", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "HOME"];
    return Object.fromEntries(keys.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]]));
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=migration-service.js.map