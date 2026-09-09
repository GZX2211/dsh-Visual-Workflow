import z from '@deepseek-ai/schemastery';
/** 插件稳定标识名（亦是 cordis.patch.yml 中 insert 行的 name 解析目标）。 */
export declare const name = "dsh-visual-workflow";
export declare const inject: string[];
/** Host 插件的全部可配置键（已含默认值，应用后为必填）。 */
export interface Config {
    /** 数据根目录（工作流/服务/模板/运行历史/断点的落盘目录）。 */
    dataDir: string;
    /** 模式二服务端口池起始值（向上探测空闲端口）。 */
    servicePortBase: number;
    /** 模式二 REST API 鉴权密钥；null 表示鉴权关闭。 */
    apiKey: string | null;
    /** 模式二单服务并发请求上限。 */
    maxConcurrentPerService: number;
    /** wf_ask_agent 阻塞通信超时毫秒数。 */
    wfAskAgentTimeoutMs: number;
    /** 运行空闲超时毫秒数（无 in-flight 看护门限）。 */
    runIdleTimeoutMs: number;
    /** 运行状态回显轮询间隔毫秒数。 */
    runPollMs: number;
    /** ReAct 迭代次数默认上限（软截停强制收尾）。 */
    reactIterationLimitDefault: number;
    /** 单节点回流重试次数默认上限。 */
    retryLimitDefault: number;
    /** 节点完整输出持久化字节上限。 */
    outputFullLimit: number;
    /** 文本文件内容注入上下文字符上限。 */
    documentTextLimit: number;
    /** 本地嵌入模型资产目录；null 用随包分发资产。 */
    embeddingModelDir: string | null;
    /** 外部 OpenAI 兼容 /embeddings 端点；null 优先本地嵌入。 */
    embeddingEndpoint: string | null;
}
/** 导出的 Config schema，供 Loader 校验与默认值填充。 */
export declare const Config: z<Config>;
