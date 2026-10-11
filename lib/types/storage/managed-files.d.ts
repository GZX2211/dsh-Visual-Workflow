/**
 * 受管文件名消毒：仅剔除路径分隔符与 Windows/会话危险字符，保留中文等
 * Unicode 字符（旧实现把非 ASCII 全部替换为 '_'，导致「任务清单规则.md」
 * 变成「______.md」，卡片显示错乱）。防目录穿越：剥 basename + 去 .. + 去控制字符。
 */
export declare function safeManagedName(name: string): string;
/** 受管文件绝对路径（data/files/<safeName>）。 */
export declare function managedFilePath(dataDir: string, name: string): string;
/**
 * 受管拷贝：base64 内容 → data/files/<safeName>（原子发布）。
 * 返回受管相对路径（managedPath）与文件名。
 *
 * 只接受 base64：内容必须来自调用方已持有的字节，不接受路径（否则即为
 * 「读宿主任意路径并落入可下载目录」的越权面）。零消费方的 sourcePath 分支已删除。
 *
 * 并发语义：写入经**组合锁**（磁盘锁在外 + 进程内锁在内，见 atomic 的 withJsonLock）
 * 串行化，再由通用原子原语发布（临时文件 + fsync + rename + 失败清理）。
 * 为什么必须是组合锁而不是进程内锁：受管文件的两个写入者不在同一进程——宿主（GUI 上传）
 * 与 service-runner（服务进程）共享同一 dataDir；只有进程内锁时，两侧各自原子 rename
 * 仍是「后写覆盖先写」，受管副本的深拷贝解耦语义会被破坏。
 * 行为变化（相对仅进程内锁）：同一受管名被并发占用时，后到者按磁盘锁超时（30s）抛
 * DiskLockError，**不再静默覆盖**；成功后锁文件即被释放（不残留）。
 */
export declare function copyIntoManagedFile(dataDir: string, input: {
    name: string;
    base64?: string;
}): Promise<{
    managedPath: string;
    fileName: string;
}>;
