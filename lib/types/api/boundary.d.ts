import type { FlowStore } from '../storage/flow-store.js';
import type { OrchestratorRuntime } from '../orchestrator/index.js';
import type { EmbeddingEngine } from '../embedding/engine.js';
import type { SchedulerEngine, SchedulerTaskStore } from '../scheduler/index.js';
import type { ToolSwitchStore } from '../tools/infrastructure/tool-switches.js';
/** 宿主能力缝（index.ts 装配；单测 fake）。 */
export interface ApiHost {
    orchestrator: OrchestratorRuntime;
    store: FlowStore;
    dataDir: string;
    engine: EmbeddingEngine;
    /** 新会话创建缝（「开启新会话」一次性动作：从模板创建实例时先新建主会话；缺失时建会话端点 501）。 */
    sessionProvider?: {
        createSession(options: {
            label: string;
            agentPreset?: string;
            cwd?: string;
        }): Promise<string>;
    };
    /** 解析某会话记录的工作目录（新会话继承创建者 cwd 用；不可用时省略）。 */
    sessionCwdOf?(sessionId: string): Promise<string | undefined>;
    /** 模式二服务管理器（服务管理阶段装配；缺失时服务端点返回 501）。 */
    serviceManager?: {
        start(serviceId: string): Promise<unknown>;
        stop(serviceId: string): Promise<unknown>;
        status(serviceId: string): Promise<unknown>;
    };
    /** 服务 apiKey（调试流式代理携带鉴权头用；null 表示未启用，密钥不落浏览器）。 */
    apiKey?: string | null;
    /** 定时任务引擎（scheduler 模块公共入口；缺失时调度端点返回 501）。 */
    scheduler?: SchedulerEngine;
    /** 定时任务存储（scheduler-tasks.json；缺失时调度端点返回 501）。 */
    schedulerTaskStore?: SchedulerTaskStore;
    /** 全局工具开关存储（tools/infrastructure/tool-switches.ts；缺失时开关端点返回 501）。 */
    toolSwitches?: ToolSwitchStore;
}
/**
 * GUI API 分发基座：按端点名分发（白名单禁止命中原型链方法）。
 * 所有方法为 async (args) => value；参数缺失抛 HttpError(400)。
 */
export declare class VisualWorkflowApiBase {
    protected readonly ctx: {
        get(name: string): unknown;
    };
    protected readonly host: ApiHost;
    constructor(ctx: {
        get(name: string): unknown;
    }, host: ApiHost);
    /** 端点白名单（共享协议常量表派生，与共享契约零漂移）。 */
    static ENDPOINTS: Set<string>;
    /** 按端点名分发；未知端点 404。 */
    handle(endpoint: string, args: unknown): Promise<unknown>;
}
/**
 * 把端点组的原型方法汇聚到最终类（组合替代继承串联）。
 * 只搬运组自身声明的方法（跳过 constructor）；基座方法仍由继承提供。
 * @param target 最终 API 类（继承基座）。
 * @param groups 端点组类清单（顺序无关，端点名必须全局唯一——冲突时后者覆盖）。
 */
export declare function mixInEndpointGroups(target: typeof VisualWorkflowApiBase, groups: ReadonlyArray<typeof VisualWorkflowApiBase>): void;
