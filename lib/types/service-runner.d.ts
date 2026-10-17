import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
/** 稳定插件名（serve.patch.yml 的 insert 行 name 解析目标）。 */
export declare const name = "visual-workflow-service";
/**
 * 核心服务：保留 cmdlineArgs 依赖只为启动时序——apply 需要 launcher 已挂载完 app 服务
 * （appExit 由 launcher 提供，缺失即报错退出），本插件自身不再读取任何命令行参数。
 */
export declare const inject: string[];
/** 插件配置（serve.patch.yml 渲染写入；身份与端口的唯一来源）。 */
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
/**
 * 插件入口：启动异步装配（不阻塞树挂载）。
 * appExit 由 launcher 提供（缺失报错——服务进程必须能请求退出）。
 */
export declare function apply(ctx: Context, config: Config): void;
