import type { GraphNode, Line } from './graph-model.js';
/**
 * 角色模板：父代理或子代理模板（架构文档 §6.3）。
 * 左侧栏「角色」Tab 的复用壳；拖入画布深拷贝为 RoleNode（与模板断引用）。
 */
export interface RoleTemplate {
    /** 模板稳定标识（roleId）。 */
    id: string;
    /** 角色种类：父代理或子代理。 */
    kind: 'parent' | 'agent';
    /** 模板名称。 */
    name: string;
    /** 系统提示词。 */
    systemPrompt: string;
    /** 服务商。 */
    provider: string;
    /** 模型。 */
    model: string;
    /** 思考强度（可选）。 */
    reasoning?: string;
    /** 官方预设 id（父代理仅 preset）。 */
    presetId?: string | null;
    /** 回流重试次数上限。 */
    retryLimit: number;
    /** ReAct 迭代次数上限（可选）。 */
    reactLimit?: number | null;
    /** 输入结构描述（可选）。 */
    inputSchema?: string;
    /** 输出结构描述（可选）。 */
    outputSchema?: string;
    /** System Prompt 来源文件名（从 .md 加载时记录，左侧栏卡片展示用，需求文档 §4.2.3.1）。 */
    systemPromptSource?: string;
    /**
     * 官方系统提示词开关（默认 true；界面上是「人设段」开关）。
     * false = 清空除角色段 / tool:* 散文段 / Code Mode 协议段之外的全部官方段与 runtime context。
     * 设置角色 Prompt 时只替换 harness:identity + deployment:persona-prefix，
     * deployment:persona-suffix（工作目录事实）仍保留；本开关 OFF 时它同样被清空。
     */
    injectSystemPrompt?: boolean;
    /** 工具提示词（tool:* 散文段）注入开关（默认 true；false 仅移除 tool:* 段，保留 Code Mode 协议段与工具 Schema）。 */
    injectToolSections?: boolean;
    /** 角色 Prompt 的宿主绝对路径（可选；设置后运行时从文件读取，文件指纹纳入签名）。 */
    promptFilePath?: string;
    /**
     * 创建时间（ISO 字符串，可选）：由持久化层记账（调用方值 ?? 既有值 ?? now）。
     * 客户端新建草稿会带上该字段，持久化层不得因此丢失既有创建时间。
     */
    createdAt?: string;
    /** 最近更新时间（ISO 字符串，可选）：恒由持久化层在保存时刷新。 */
    updatedAt?: string;
}
/**
 * 文件模板（架构文档 §6.3）。
 * 非文本文件选择时复制到插件受管目录 data/files/（需求文档 §4.2.4.1 规则 2）。
 * 支持多选所有类型文件（files 列表，用户验收标注：已选文件列表显示在按钮下方）。
 */
export interface FileTemplate {
    /** 模板稳定标识。 */
    id: string;
    /** 模板名称。 */
    name: string;
    /** 文件类型。 */
    fileKind: 'text' | 'file';
    /** 文本内容（fileKind='text'）。 */
    content?: string;
    /** 受管文件路径（fileKind='file' 单选时的兼容字段）。 */
    managedPath?: string;
    /** 源文件名（fileKind='file' 左侧栏展示用，与 FileNode.data.fileName 对齐）。 */
    fileName?: string;
    /** 多选文件列表（fileKind='file'；每项含受管路径与源文件名）。 */
    files?: Array<{
        fileName: string;
        managedPath: string;
    }>;
    /** 创建时间（ISO 字符串，可选）：持久化层记账。 */
    createdAt?: string;
    /** 最近更新时间（ISO 字符串，可选）：持久化层保存时刷新。 */
    updatedAt?: string;
}
/**
 * 数据库模板（架构文档 §6.3）。
 * 服务器类型提供结构化只读查询；本地类型提供内置向量检索（需求文档 §4.2.4.2）。
 */
export interface DatabaseTemplate {
    /** 模板稳定标识。 */
    id: string;
    /** 模板名称。 */
    name: string;
    /** 模板描述。 */
    description: string;
    /** 类型：本地或服务器。 */
    dbType: 'local' | 'server';
    /** 数据库引擎。 */
    dbKind: 'sqlite' | 'mysql' | 'postgresql';
    /** 本地数据库文件路径。 */
    localPath?: string;
    /** 服务器连接信息。 */
    conn?: {
        host: string;
        port: number;
        user: string;
        password: string;
        db: string;
    };
    /** 向量检索模式。 */
    vectorSource?: 'embedding' | 'bm25';
    /** 检索高级选项（对应 DatabaseNode.data.vectorOptions，模板态可配置）。 */
    vectorOptions?: {
        topK?: number;
        chunkSize?: number;
        overlap?: number;
        scoreThreshold?: number;
        maxRows?: number;
    };
    /** 创建时间（ISO 字符串，可选）：持久化层记账。 */
    createdAt?: string;
    /** 最近更新时间（ISO 字符串，可选）：持久化层保存时刷新。 */
    updatedAt?: string;
}
/**
 * 协作组模板（架构文档 §6.4 BundleV2.embedded.groups 引用）。
 * 架构文档 §6.3 未单独列出 GroupTemplate，此接口为架构文档 §6.4 嵌入式 groups
 * 的约束形状；协作 Prompt 追加到组内成员**首条用户消息（任务块）末尾**、不注入
 * 系统提示词，且无论文本是否为空都默认列出组内全部成员 ID + 角色名
 * （需求文档 §4.2.5.2 规则 2；架构文档 §13.1 第 4 条）。
 */
export interface GroupTemplate {
    /** 模板稳定标识。 */
    id: string;
    /** 模板名称。 */
    name: string;
    /** 协作 Prompt。 */
    collabPrompt: string;
    /** 创建时间（ISO 字符串，可选）：持久化层记账。 */
    createdAt?: string;
    /** 最近更新时间（ISO 字符串，可选）：持久化层保存时刷新。 */
    updatedAt?: string;
}
/**
 * 工具组合（架构文档 §6.3）：用户自定义工具勾选清单（可含 MCP 服务器）。
 * id 以 `combo-` 模板字面量前缀标识（需求文档 §4.6 规则 2）。
 */
export interface ToolCombo {
    /** 组合 id：`combo-` 前缀模板字面量类型（需求文档 §4.6 规则 2；术语 §2）。 */
    id: `combo-${string}`;
    /** 组合名称。 */
    name: string;
    /** 工具勾选清单（含可选注入的 dsh-vw 工具 wf_ask/wf_ask_agent，需求文档 §4.6 规则 6）。 */
    tools: string[];
    /** 所选 MCP 服务器 id 列表（工具以 mcp__<server>__* 前缀解析，需求文档 §4.6 规则 4）。 */
    mcpServers: string[];
}
/**
 * 导入导出 v2 bundle（架构文档 §6.4 逐字段）。
 * 格式升级为 v2（含数据库节点/协作组/虚拟节点/双模式标记），不兼容旧文件
 * （需求文档 §9.1 导入导出行 / Q22）。
 * 语义不对称（跨模块契约）：`embedded.groups` 仅在导出时随包携带（由 group 节点推导），
 * 导入时不重建模板库——协作组信息已内联在图节点中，重建会产生第二份事实源。
 */
export interface BundleV2 {
    /** 格式标识：固定 'dsh-vw-bundle'。 */
    format: 'dsh-vw-bundle';
    /** 版本：固定 2。 */
    version: 2;
    /** 所属模式（导入时按模式落到 workflows/ 或 services/）。 */
    mode: 'mode1' | 'mode2';
    /** 工作流 payload（模式一导入导出；与 service 二选一）。 */
    workflow?: {
        name: string;
        description: string;
        nodes: GraphNode[];
        lines: Line[];
    };
    /** 服务 payload（模式二导入导出；与 workflow 二选一）。 */
    service?: {
        name: string;
        description: string;
        nodes: GraphNode[];
        lines: Line[];
    };
    /** 嵌入式资源（角色/文件/数据库/协作组模板与工具组合；导入时解耦创建模板）。 */
    embedded: {
        roles?: RoleTemplate[];
        files?: FileTemplate[];
        databases?: DatabaseTemplate[];
        groups?: GroupTemplate[];
        combos?: ToolCombo[];
    };
}
