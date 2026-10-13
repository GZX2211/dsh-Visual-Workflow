import type { InstanceOptions } from './instance-options.js';
import type { StorageLike } from '../lib/storage.js';
/**
 * 落盘防抖窗口。300ms 与「输入停顿即视为一次编辑」的交互节奏对齐：
 * 用户连打不写盘，停手后一次写入；同时短于用户能感知的「记忆延迟」。
 */
export declare const INSTANCE_OPTIONS_DEBOUNCE_MS = 300;
/**
 * 把 instanceOptions 防抖落盘到注入的存储（浏览器环境默认 localStorage；
 * 初始读取在 useStudioState 初始化工厂完成，本 hook 只写不读）。
 */
export declare function useInstanceOptionsCache(options: InstanceOptions, storage?: StorageLike | null): void;
