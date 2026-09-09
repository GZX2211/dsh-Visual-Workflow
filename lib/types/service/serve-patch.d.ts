/** 服务进程内挂载的 webServer 行 id。 */
export declare const SERVICE_WEBSERVER_ROW_ID = "visual-workflow-webserver";
/** 服务进程入口插件行 id（serve.patch.yml 与插件 Config 校验用）。 */
export declare const SERVICE_PLUGIN_ROW_ID = "visual-workflow-service";
export interface ServePatchInput {
    /** 服务稳定标识（已消毒）。 */
    serviceId: string;
    /** 数据根目录（服务进程内 FlowStore 落盘位置）。 */
    dataDir: string;
    /** 分配的监听端口。 */
    port: number;
    /** 鉴权密钥（null 关闭）。 */
    apiKey: string | null;
    /** 单服务并发请求上限。 */
    maxConcurrent: number;
    /** 服务进程入口插件模块的绝对 file URL（Loader 直接导入）。 */
    pluginEntryUrl: string;
}
/**
 * 渲染 serve.patch.yml 文本（纯函数；输出字节稳定）。
 * webserver 固定绑定 127.0.0.1（默认安全姿态；对外暴露属部署决策）。
 */
export declare function renderServePatch(input: ServePatchInput): string;
