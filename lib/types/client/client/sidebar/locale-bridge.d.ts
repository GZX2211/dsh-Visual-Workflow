import { type Dict } from '../i18n.js';
/** 读取当前词典（useSyncExternalStore 的 getSnapshot；返回稳定引用）。 */
export declare function getWorkbenchDict(): Dict;
/** 订阅词典变化（useSyncExternalStore 的 subscribe）。 */
export declare function subscribeWorkbenchDict(listener: () => void): () => void;
/**
 * 更新当前词典并通知订阅者（entry.ts 在首次渲染与每次语言切换时调用）。
 * 同引用不通知（避免无意义重渲染）。
 * @param next - 新词典。
 */
export declare function setWorkbenchDict(next: Dict): void;
/** 订阅当前词典的 React hook（组件因此跟随语言切换重渲染）。 */
export declare function useWorkbenchDict(): Dict;
/** 测试用：复位为默认词典并清空订阅者。 */
export declare function resetWorkbenchDictForTest(): void;
