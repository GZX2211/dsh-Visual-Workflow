import type { ConditionType, Handle } from '../../shared/graph-model.js';
import type { OrgMeta } from '../../shared/types.js';
/** 工作流资产 id 前缀：可召回完整骨架。 */
export declare const WORKFLOW_ID_PREFIX = "flow-";
/** 角色资产 id 前缀：可召回完整 systemPrompt。 */
export declare const ROLE_ID_PREFIX = "role-";
/** 工作流资产内联角色复合键分隔符：`<工作流资产 id>#<节点 id>`。 */
export declare const INLINE_ROLE_SEPARATOR = "#";
/** ID 约定文本（判据本体；索引与错误提示共用同一份）。 */
export declare const ID_CONVENTION: {
    readonly workflow: "flow-* = 工作流资产 → 完整骨架（阶段节点 / 角色与协作组 / 连线 / 数据节点正文）";
    readonly role: "role-* = 角色资产 → 完整 systemPrompt 及其映射信息";
    readonly inlineRole: "flow-xxx#<节点 id> = 工作流资产内联角色 → 该节点固定引用版本的完整 systemPrompt";
};
/** 条目上限与摘要口径（超限截断并置 truncated，不做静默丢弃）。 */
export declare const CATALOG_LIMITS: {
    /** 角色资产条目上限。 */
    readonly roleAssets: 60;
    /** 工作流资产条目上限。 */
    readonly workflowAssets: 40;
    /** 组合条目上限。 */
    readonly combos: 30;
    /** 官方 preset 条目上限。 */
    readonly presets: 40;
    /** 模型条目上限。 */
    readonly models: 60;
    /** 角色摘要字数：只够判断职责，不替代完整提示词召回。 */
    readonly roleSummary: 60;
    /** 单次详情召回的 id 上限：超限拒绝并提示分批，避免一次拉爆上下文。 */
    readonly detailIds: 20;
};
/** 组合条目：组合 id 是节点 presetId 的取值来源，必须携带工具清单。 */
export interface CatalogComboEntry {
    id: string;
    name: string;
    tools: string[];
    mcpServers: string[];
}
/** 官方 preset 条目（节点 presetId 的另一取值来源）。 */
export interface CatalogPresetEntry {
    id: string;
    name: string;
    description?: string;
}
/** 模型条目：provider/model 配对 + 思考强度档位（节点 data.reasoning 的取值来源）。 */
export interface CatalogModelEntry {
    provider: string;
    model: string;
    efforts?: Array<{
        id: string;
        name: string;
    }>;
}
/**
 * 工作流资产索引条目。
 * 只给「够不够拿来参考」的判据（名称 + 描述 + 版本），完整骨架按 id 召回。
 */
export interface WorkflowAssetEntry {
    id: string;
    name: string;
    description: string;
    /** Active 版本号（展示为 vN）。 */
    versionId: number;
}
/**
 * 角色资产索引条目。
 * `roleAssetType` 决定改动代价：inline 可自由改，shared 的修改会级联到多个工作流资产。
 */
export interface RoleAssetEntry {
    id: string;
    name: string;
    kind: 'parent' | 'agent';
    versionId: number;
    roleAssetType: 'standalone' | 'inline' | 'shared';
    /** systemPrompt 前 N 字截断：只够判断职责，不替代完整提示词召回。 */
    summary: string;
}
/** 索引里的资产段（工作流资产 + 角色资产）。 */
export interface CatalogAssetIndex {
    workflows: WorkflowAssetEntry[];
    roles: RoleAssetEntry[];
}
/**
 * 编排规则段：图语义、设计方法与**写图契约**。
 * 为什么写图契约放在这里而不是工具描述里：字段形状与提交规则体积大且只在动手改图前才需要，
 * 常驻描述要为每次请求付费；放在按需召回的目录里可让描述只保留一份指引。
 * 文本本体在工具层基础设施的单一来源模块，此处只声明槽位（不复制常量）。
 */
export interface CatalogRules {
    graphSemantics: string;
    designMethod: string;
    /** 写图契约：op 字段形状、角色节点 data 契约、提交规则、错误码语义。 */
    patchContract: string;
    /** 闸门标记语义（mark_node 的适用时机与判定）。 */
    gateMarking: string;
}
/** 资产索引（第一次调用的返回体）。 */
export interface CatalogIndex {
    kind: 'index';
    idConvention: typeof ID_CONVENTION;
    detailHint: string;
    combos: CatalogComboEntry[];
    presets: CatalogPresetEntry[];
    models: CatalogModelEntry[];
    assets: CatalogAssetIndex;
    rules: CatalogRules;
    truncated: boolean;
}
/** 阶段节点条目。 */
export interface CatalogStageNodeEntry {
    id: string;
    kind: 'start' | 'end' | 'pause';
    label: string;
}
/**
 * 角色节点条目。
 * 为什么不含 systemPrompt：它是最长字段，走「复合 id 按需召回」；其余字段不可二次
 * 召回，必须一次性给全，否则骨架拼不出完整工作流。
 * `roleAssetId`/`roleVersionId` 指向工作流资产固定引用的角色资产与版本——同一个角色资产在
 * 不同工作流资产里可以钉在不同版本上，骨架必须交代清楚钉的是哪一版。
 */
export interface CatalogRoleNodeEntry {
    id: string;
    kind: 'agent' | 'parent';
    label: string;
    presetId: string | null;
    provider: string;
    model: string;
    reasoning?: string;
    inputSchema: string;
    outputSchema: string;
    /** 角色 Prompt 来源文件名（画布展示用；无来源时省略）。 */
    systemPromptSource?: string;
    groupId: string | null;
    /** 该节点引用的角色资产 id（无角色版本行映射时省略）。 */
    roleAssetId?: string;
    /**
     * 该节点固定引用的角色资产**版本号**（vN；无映射时省略）。
     * 注意与持久化层的 `WorkflowAssetRoleRef.roleVersionId` 区分：后者是**版本行 id**
     * （`<角色资产id>@<版本号>`，用于数据库引用），这里对模型公布的是可读版本号。
     */
    roleVersionId?: number;
}
/** 虚拟节点条目（主节点别名引用 + 闸门角色）。 */
export interface CatalogProxyNodeEntry {
    id: string;
    kind: 'proxy';
    label: string;
    proxySourceId: string;
    role: 'executor' | 'milestone';
}
/** 协作组条目（collabPrompt 不可二次召回，一次性给全）。 */
export interface CatalogGroupNodeEntry {
    id: string;
    kind: 'group';
    label: string;
    collabPrompt: string;
    memberIds: string[];
}
/** 文件数据源条目（正文无二次召回通道，一次性给全）。 */
export interface CatalogFileNodeEntry {
    id: string;
    kind: 'file';
    label: string;
    fileKind: 'text' | 'file';
    content?: string;
    fileName?: string;
    managedPath?: string;
    files?: Array<{
        fileName: string;
        managedPath: string;
    }>;
}
/** 数据库数据源条目（连接信息一次性给全；密钥字段已脱敏）。 */
export interface CatalogDatabaseNodeEntry {
    id: string;
    kind: 'database';
    label: string;
    description: string;
    dbType: 'local' | 'server';
    dbKind: string;
    localPath?: string;
    conn?: Record<string, unknown>;
    vectorSource?: string;
    vectorOptions?: Record<string, unknown>;
}
/** 骨架里的节点条目（按 kind 判别）。 */
export type CatalogNodeEntry = CatalogStageNodeEntry | CatalogRoleNodeEntry | CatalogProxyNodeEntry | CatalogGroupNodeEntry | CatalogFileNodeEntry | CatalogDatabaseNodeEntry;
/** 连线条目（条件分支语义是编排事实，必须给全）。 */
export interface CatalogLineEntry {
    id: string;
    source: string;
    target: string;
    sourceHandle: Handle;
    targetHandle: Handle;
    condition?: {
        type: ConditionType;
        label?: string;
    };
}
/** 工作流资产骨架（`flow-*` 的返回体）。 */
export interface CatalogWorkflowDetail {
    type: 'workflow';
    id: string;
    /** 等于 id（显式给出，避免模型在两种字段名之间猜测）。 */
    assetId: string;
    /** Active 版本号（展示为 vN）。 */
    versionId: number;
    name: string;
    description: string;
    mode: 'mode1' | 'mode2';
    meta?: OrgMeta;
    nodes: CatalogNodeEntry[];
    lines: CatalogLineEntry[];
    /** 该骨架内可直接召回的复合 id 清单（角色 systemPrompt 的召回入口）。 */
    inlineRoles: string[];
    note: string;
}
/** 角色资产详情（systemPrompt 完整返回，不截断）。 */
export interface CatalogRoleDetail {
    type: 'role';
    id: string;
    /** 等于 id（与 CatalogWorkflowDetail 同口径）。 */
    assetId: string;
    versionId: number;
    /** 角色资产类型：shared 的修改会级联到引用它的工作流资产。 */
    roleAssetType: 'standalone' | 'inline' | 'shared';
    name: string;
    kind: 'agent' | 'parent';
    presetId: string | null;
    provider: string;
    model: string;
    reasoning?: string;
    inputSchema: string;
    outputSchema: string;
    systemPromptSource?: string;
    systemPrompt: string;
}
/** 工作流资产内联角色详情（systemPrompt 完整返回，并标明它属于哪个工作流与节点）。 */
export interface CatalogInlineRoleDetail {
    type: 'inlineRole';
    id: string;
    containerId: string;
    nodeId: string;
    /** 该节点引用的角色资产 id（无角色版本行映射时省略）。 */
    roleAssetId?: string;
    /** 该节点固定引用的角色版本号（无角色版本行映射时省略）。 */
    roleVersionId?: number;
    label: string;
    presetId: string | null;
    provider: string;
    model: string;
    reasoning?: string;
    inputSchema: string;
    outputSchema: string;
    groupId: string | null;
    systemPromptSource?: string;
    systemPrompt: string;
}
/** 资产详情条目。 */
export type CatalogAssetDetail = CatalogWorkflowDetail | CatalogRoleDetail | CatalogInlineRoleDetail;
/** 坏 id 条目：单条失败不阻塞其余召回。 */
export interface CatalogDetailError {
    id: string;
    code: string;
    message: string;
}
/** 资产详情（第二次调用的返回体）。 */
export interface CatalogDetails {
    kind: 'details';
    assets: CatalogAssetDetail[];
    errors: CatalogDetailError[];
}
/** preset 数据源条目。 */
export interface CatalogPresetSource {
    id: string;
    name?: string;
    description?: string;
}
/** 模型数据源条目（efforts 为思考强度档位；适配器未公布时省略）。 */
export interface CatalogModelSource {
    provider: string;
    model: string;
    efforts?: Array<{
        id: string;
        name: string;
    }>;
}
