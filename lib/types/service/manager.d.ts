import { type ChildProcess } from 'node:child_process';
import type { FlowStore } from '../storage/flow-store.js';
/** 服务管理器错误码（api.ts 路由层映射 HTTP 状态）。 */
export declare const SERVICE_ERR: {
    readonly NOT_FOUND: "WF_SERVICE_NOT_FOUND";
    readonly RUNNING: "WF_SERVICE_RUNNING";
    readonly BAD_ID: "WF_SERVICE_BAD_ID";
    readonly FLOW_INVALID: "WF_FLOW_INVALID";
    readonly DSH_NOT_FOUND: "WF_DSH_NOT_FOUND";
    readonly START_FAILED: "WF_SERVICE_START_FAILED";
};
/** 服务管理器错误（携带稳定 code 供路由层分支）。 */
export declare class ServiceManagerError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** SIGTERM 后的强制终止宽限期（架构：SIGTERM → 5s → SIGKILL）。 */
export declare const STOP_GRACE_MS = 5000;
/** 日志缝。 */
export interface ManagerLogger {
    info?(message: string): void;
    warn?(message: string): void;
    error?(message: string): void;
}
export interface ServiceManagerDeps {
    /** 数据层（服务文档读写）。 */
    store: FlowStore;
    /** 数据根目录（patch 产物落盘 + 子进程 cwd）。 */
    dataDir: string;
    /** 端口池基址 / 鉴权密钥 / 并发上限。 */
    config: {
        servicePortBase: number;
        apiKey: string | null;
        maxConcurrentPerService: number;
    };
    /** 日志缝（缺省静默）。 */
    logger?: ManagerLogger;
    /** 时钟注入（时间戳字段）。 */
    now?: () => number;
    /** dsh 可执行路径（缺省 PATH 解析；测试注入）。 */
    dshCommand?: string;
    /** 端口分配（缺省 findFreePort；测试注入）。 */
    findPort?: (base: number) => Promise<number>;
    /** 子进程工厂（测试注入 fake）。 */
    spawn?: (command: string, args: string[], options: {
        cwd: string;
        env: NodeJS.ProcessEnv;
        shell: boolean;
        stdio: readonly ('ignore' | 'pipe')[];
    }) => ChildProcess;
}
/**
 * 模式二服务管理器（每 Host 一个实例；内存仅持有存活子进程）。
 */
export declare class ServiceManager {
    private readonly deps;
    private readonly children;
    /** in-flight 启动集合（Bug 11 并发启动互斥：start 开头同步登记，finally 注销）。 */
    private readonly starting;
    constructor(deps: ServiceManagerDeps);
    private log;
    private isoNow;
    /** 启动服务（幂等护栏：已运行/正在启动 → 冲突错误）。 */
    start(serviceId: string): Promise<{
        serviceId: string;
        status: string;
        port: number;
        pid?: number;
    }>;
    /** start 实际执行体（starting 互斥集合保护下运行）。 */
    private startInner;
    /** 停止服务（SIGTERM → 5s → SIGKILL；立即持久化 stopped）。 */
    stop(serviceId: string): Promise<{
        serviceId: string;
        status: string;
    }>;
    /** 服务状态（内存存活进程的 pid + 文档状态）。 */
    status(serviceId: string): Promise<{
        serviceId: string;
        status: string;
        port?: number;
        pid?: number;
    }>;
    /** 自动恢复：扫描文档中 status=running 的服务并重启（端口冲突重分配）。 */
    autoRecover(): Promise<string[]>;
    /** 停止全部服务（主进程卸载时尽力而为）。 */
    dispose(): void;
    /** 清理内存条目（幂等；exit/error 路径共用）。 */
    private forget;
    /** patch 产物路径（<dataDir>/services/<serviceId>.serve.patch.yml）。 */
    private patchPath;
    private spawnChild;
    /** 更新服务文档的运行时字段（读最新磁盘值后合并写）。 */
    private persistRuntime;
}
/**
 * 从 PATH 解析 dsh 可执行文件（Windows 优先 dsh.cmd；Unix 直接 dsh）。
 * 找不到时抛明确错误（WF_DSH_NOT_FOUND）。
 */
export declare function resolveDshCommand(envPath?: string): string;
