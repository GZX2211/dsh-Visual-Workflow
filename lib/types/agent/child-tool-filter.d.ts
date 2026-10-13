export declare class ChildToolPermissionError extends Error {
    readonly code = "WF_CHILD_TOOL_POLICY_FAILED";
    readonly phase = "tool_policy";
    readonly retryable = false;
}
export interface ChildToolFilterSetup {
    contribution(childCtx: unknown, scope?: unknown): () => void;
    withPending<T>(allow: readonly string[] | undefined, operation: () => Promise<T>): Promise<T>;
    remember(childId: string, allow: readonly string[] | undefined): void;
    restore(childId: string, childCtx: unknown, scope?: unknown, denyAll?: boolean): () => void;
    peekPending?(): readonly string[] | undefined;
}
/** 在实际创建作用域中验证继承权限；自己的工具由执行守卫约束。 */
export declare function installChildToolPolicy(raw: unknown, allow: readonly string[] | undefined, scope?: unknown, denyAll?: boolean): () => void;
export declare function createChildToolFilterSetup(): ChildToolFilterSetup;
