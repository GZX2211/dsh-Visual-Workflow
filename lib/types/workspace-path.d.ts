/**
 * 校验并规范化工作区路径（可选字段）：
 *   - 空串/未设置 → undefined；
 *   - 非空路径必须存在且为目录，否则抛错（错误消息面向用户，含原路径）；
 *   - 返回值恒为绝对路径：下游把它直接当作会话 cwd / 沙箱工作区根（官方以
 *     session.header.cwd 为 workspace-write 根），相对路径会让「同一份配置」随
 *     宿主进程 cwd 漂移到不同工作区，故按进程 cwd 解析成绝对路径后再交给下游。
 */
export declare function resolveWorkspacePath(value: unknown): Promise<string | undefined>;
