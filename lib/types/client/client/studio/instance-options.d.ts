import type { StorageLike } from '../lib/storage.js';
/** instanceOptions 持久化键。 */
export declare const INSTANCE_OPTIONS_KEY = "visual-workflow:instance-options";
/** 资产态一次性「开启新会话」记忆。 */
export interface InstanceOptions {
    /** 创建实例前是否新建主会话（资产态「开启新会话」复选框）。 */
    newSession: boolean;
}
/** 默认实例选项（与 createInitialState 一致）。 */
export declare function defaultInstanceOptions(): InstanceOptions;
/** 读取缓存（缺失/损坏回退默认值；隐私模式等异常静默）。 */
export declare function restoreInstanceOptions(storage: StorageLike): InstanceOptions;
/** 写入缓存（newSession 布尔化后落盘；不含路径——模板态的路径不在此）。 */
export declare function keepInstanceOptions(storage: StorageLike, options: InstanceOptions): void;
