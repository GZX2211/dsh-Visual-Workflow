import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** 稳定插件名（serve.patch.yml 的 insert 行 name 解析目标）。 */
export declare const name = "visual-workflow-service";
/** 核心服务：cmdlineArgs 由 launcher 在树挂载前提供（app 自持参数族）。 */
export declare const inject: string[];
/** 插件配置（serve.patch.yml 渲染写入；cmdlineArgs 为权威覆盖源）。 */
export interface Config {
    /** 服务 id（编排 flowId 与映射文件作用域）。 */
    serviceId: string;
    /** 数据根目录（与主进程共享磁盘数据层）。 */
    dataDir: string;
    /** 监听端口。 */
    port: number;
    /** 鉴权密钥（null 关闭）。 */
    apiKey: string | null;
    /** 单服务并发请求上限。 */
    maxConcurrent: number;
}
export declare const Config: z<Config>;
/** 进程 IO 缝（测试可替换）。 */
interface RunnerIo {
    stdout: {
        write(chunk: string): unknown;
    };
    stderr: {
        write(chunk: string): unknown;
    };
    exit(code: number): void;
}
/** 测试可见的进程流替换点。 */
export declare const internals: {
    stdout: RunnerIo['stdout'];
    stderr: RunnerIo['stderr'];
};
/** 解析内层参数族：--visual-workflow-serve <serviceId> --port <n>。 */
export declare function parseServiceArgs(args: readonly unknown[]): {
    serviceId: string;
    port: number;
} | null;
/**
 * 插件入口：启动异步装配（不阻塞树挂载）。
 * appExit 由 launcher 提供（缺失报错——服务进程必须能请求退出）。
 */
export declare function apply(ctx: Context, config: Config): void;
export {};
