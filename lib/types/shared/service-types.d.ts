import type { GraphNode, Line } from './graph-model.js';
import type { OrgMeta } from './org-meta.js';
/** 服务进程状态：停止/运行中/崩溃（架构文档 §6.2；需求文档 §4.1.3）。 */
export type ServiceStatus = 'stopped' | 'running' | 'crashed';
/**
 * 服务状态（模式二工作流实例 + 端口/鉴权/进程状态，架构文档 §6.2 逐字段）。
 * 一个服务 = 一个模式二工作流 + 一个常驻子进程 + 一个 REST API 端口（术语 §2）。
 */
export interface ServiceState {
    /** 服务稳定标识（serviceId）。 */
    id: string;
    /** 归属会话 id。 */
    sessionId: string;
    /** 服务名称。 */
    name: string;
    /** 服务描述。 */
    description: string;
    /** 修订版本号。 */
    revision: number;
    /** 节点列表（工作流定义，判别联合引用 graph-model）。 */
    nodes: GraphNode[];
    /** 连线列表（工作流定义）。 */
    lines: Line[];
    /**
     * 【已退役，仅旧数据兼容】「服务级新会话」（每次 API 请求新建独立会话执行）。
     * 新语义（工作台全局化改版）：服务实例创建时「开启新会话」为一次性临时选项
     * （实例绑定新建主会话），该字段不再写入——新服务实例恒等于 false（请求按
     * userId 映射固定会话并断点续跑）；旧服务文档磁盘残留字段仍生效（兼容，
     * 重新保存后被剥除）。
     */
    startNewSession?: boolean;
    /** 【已退役，仅旧数据兼容】新会话工作区（同上：仅旧数据读取）。 */
    workspacePath?: string;
    /** 创建时间（ISO 字符串）。 */
    createdAt: string;
    /** 最近更新时间（ISO 字符串）。 */
    updatedAt: string;
    /** 服务进程状态（崩溃标记可重启，需求文档 §4.1.3 规则 3）。 */
    status: ServiceStatus;
    /** 服务端口（端口池分配，基础 7860 起自动递增，需求文档 §4.1.3 规则 1）。 */
    port?: number;
    /** API Key 哈希（鉴权配置，需求文档 §4.1.3 REST API 鉴权行）。 */
    apiKeyHash?: string;
    /**
     * 元参数（可选，与 WorkflowDocument.meta 同语义）：模式二服务实例的元参数层。
     * 服务文档即模式二的工作流实例文档，运行期按「有效元参数」组装并冻结进 run 快照。
     */
    meta?: OrgMeta;
    /** 最近启动时间（ISO 字符串，可选）。 */
    lastStartedAt?: string;
    /** 最近停止时间（ISO 字符串，可选）。 */
    lastStoppedAt?: string;
}
/**
 * userId→sessionId 映射记录（services/<serviceId>.sessions.json 持久化，
 * 需求文档 §4.1.3 规则 7 多租户隔离 + §4.7 sessions-map）。
 * 不同 userId 的会话与对话日志完全隔离；映射持久化于服务实例内，服务重启后有效。
 */
export interface UserIdMap {
    /** 持久化键：userId。 */
    userId: string;
    /** 映射到的稳定 sessionId（同一 userId 稳定映射，需求文档 §4.1.3 规则 7）。 */
    sessionId: string;
}
