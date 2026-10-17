import type { InstanceOptions } from './instance-options.js';
import type { StorageLike } from '../lib/storage.js';
/**
 * 落盘防抖窗口。300ms 与「输入停顿即视为一次编辑」的交互节奏对齐：
 * 用户连点/切换不写盘，停手后一次写入；同时短于用户能感知的「记忆延迟」。
 */
export declare const INSTANCE_OPTIONS_DEBOUNCE_MS = 300;
/**
 * 把资产态 instanceOptions 防抖落盘到注入的存储（浏览器环境默认 localStorage；
 * 初始读取在 useStudioState 初始化工厂完成，本 hook 只写不读）。
 * @param options - 需要记忆的临时选项；null 表示当前文档没有（模板态/实例态），不落盘。
 * @param storage - 存储抽象（测试注入；缺省 localStorage）。
 */
export declare function useInstanceOptionsCache(options: InstanceOptions | null, storage?: StorageLike | null): void;
