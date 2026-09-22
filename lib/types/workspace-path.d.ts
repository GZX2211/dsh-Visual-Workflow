/**
 * 校验并规范化工作区路径（可选字段）：
 *   - 空串/未设置 → undefined；
 *   - 非空路径必须存在且为目录，否则抛错（错误消息面向用户，含原路径）。
 */
export declare function resolveWorkspacePath(value: unknown): Promise<string | undefined>;
