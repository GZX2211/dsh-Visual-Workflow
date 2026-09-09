/**
 * 受管文件名消毒：仅剔除路径分隔符与 Windows/会话危险字符，保留中文等
 * Unicode 字符（旧实现把非 ASCII 全部替换为 '_'，导致「任务清单规则.md」
 * 变成「______.md」，卡片显示错乱）。防目录穿越：剥 basename + 去 .. + 去控制字符。
 */
export declare function safeManagedName(name: string): string;
/** 受管文件绝对路径（data/files/<safeName>）。 */
export declare function managedFilePath(dataDir: string, name: string): string;
/**
 * 受管拷贝：base64 内容或本地源文件 → data/files/<safeName>（原子发布）。
 * 返回受管相对路径（managedPath）与文件名。
 */
export declare function copyIntoManagedFile(dataDir: string, input: {
    name: string;
    base64?: string;
    sourcePath?: string;
}): Promise<{
    managedPath: string;
    fileName: string;
}>;
/**
 * 注册受管文件下载路由（GET /visual-workflow/files/<name>）。
 * 文件名必须是纯 basename（含路径分隔符一律 404）；文件缺失 404。
 */
export declare function registerDownloadRoute(ctx: {
    get(name: string): unknown;
    logger?: {
        warn?(message: string): void;
    };
}, dataDir: string): () => void;
