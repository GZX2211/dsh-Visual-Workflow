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
