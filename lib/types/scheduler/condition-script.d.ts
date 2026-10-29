import { spawn } from 'node:child_process';
/** 条件脚本执行输入（引擎提供，脚本可经环境变量读取）。 */
export interface ConditionScriptInput {
    scriptPath: string;
    taskId: string;
    taskName: string;
    templateId: string;
    /** 理论触发时刻（UTC 毫秒）。 */
    triggerAt: number;
    timezone: string;
    ownerSessionId: string;
}
/** 条件脚本执行结果；pass=false 时 detail 为可展示的原因。 */
export interface ConditionScriptOutcome {
    pass: boolean;
    detail: string;
}
/** 执行器缝（引擎只依赖此接口）。 */
export interface ConditionScriptRunner {
    run(input: ConditionScriptInput): Promise<ConditionScriptOutcome>;
}
export interface ConditionScriptRunnerOptions {
    /** 测试注入；缺省使用 node:child_process.spawn。 */
    spawnImpl?: typeof spawn;
    /** 测试注入；缺省 process.execPath。 */
    execPath?: string;
    /** 超时毫秒（缺省 10_000）。 */
    timeoutMs?: number;
    /** 测试注入；缺省 process.env。 */
    env?: NodeJS.ProcessEnv;
    /** 测试注入；缺省 Boolean(process.versions.electron)。 */
    isElectron?: boolean;
}
/** 保存时校验：路径必须是存在且可访问的普通文件（入参已是 Host 校验过的绝对路径）。 */
export declare function validateConditionScriptPath(raw: string): Promise<void>;
/** 创建条件脚本执行器（依赖可注入，测试用 fake spawn 控制事件顺序）。 */
export declare function createConditionScriptRunner(options?: ConditionScriptRunnerOptions): ConditionScriptRunner;
