import type { StorageLike } from './useWorkbenchView.js';
/** instanceOptions 持久化键。 */
export declare const INSTANCE_OPTIONS_KEY = "visual-workflow:instance-options";
/** 实例选项（对齐 StudioState.instanceOptions；创建实例时一次性消费）。 */
export interface InstanceOptions {
    /** 创建实例前是否新建主会话（模板态「开启新会话」复选框）。 */
    newSession: boolean;
    /** 新会话工作区路径（留空继承当前主会话工作区）。 */
    workspacePath: string;
}
/** 默认实例选项（与 createInitialState 一致）。 */
export declare function defaultInstanceOptions(): InstanceOptions;
/** 读取缓存（缺失/损坏回退默认值；隐私模式等异常静默）。 */
export declare function restoreInstanceOptions(storage: StorageLike): InstanceOptions;
/** 写入缓存（newSession 布尔化、workspacePath 字符串化后落盘）。 */
export declare function keepInstanceOptions(storage: StorageLike, options: InstanceOptions): void;
