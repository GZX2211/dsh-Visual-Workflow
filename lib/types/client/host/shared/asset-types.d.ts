import type { GraphNode, Line, WorkflowMode } from './graph-model.js';
import type { OrgMeta } from './org-meta.js';
/** 资产种类：工作流资产 / 角色资产（V1 只此两类）。 */
export type AssetKind = 'workflow' | 'role';
/** 角色资产的父/子角色种类（与 RoleNode.kind 同域）。 */
export type RoleAssetKind = 'parent' | 'agent';
/**
 * 角色资产类型（用户裁决）：
 *   - standalone：直接由角色模版晋升，且未被任何工作流资产登记引用；
 *   - inline：由工作流模版晋升带来的内联角色，且未被其他工作流资产引用、也未与 standalone 重复；
 *   - shared：被多个工作流资产登记引用，或 standalone 与 inline 发生重复（修改会触发级联）。
 */
export type RoleAssetType = 'standalone' | 'inline' | 'shared';
/** 资产版本来源：human=人类创建/修改；agent=代理生成（V1 入库只由人类触发，agent 预留）。 */
export type AssetVersionSource = 'human' | 'agent';
/** 资产版本条目（回滚上拉列表与版本展示；不含版本内容）。 */
export interface AssetVersionEntry {
    /** 整数版本号（展示为 vN）。 */
    versionId: number;
    /** 该版本行的全局唯一 id（角色版本会被工作流资产按此引用）。 */
    rowId: string;
    /** 该版本名称（列表展示）。 */
    name: string;
    /** 该版本创建时间（epoch 毫秒）。 */
    createdAt: number;
    /** 该版本来源（human / agent）。 */
    source: AssetVersionSource;
    /** 是否为当前 Active 版本。 */
    active: boolean;
}
/** 工作流资产索引条目（Active 版本投影；归档资产取最新版本行投影）。 */
export interface WorkflowAssetSummary {
    assetId: string;
    versionId: number;
    name: string;
    description: string;
    /** 晋升来源模版 id（非模版晋升时省略）。 */
    sourceTemplateId?: string;
    /** 晋升时来源模版的内容指纹（入库按钮锁定判据）。 */
    sourceFingerprint?: string;
    /**
     * 该资产绑定的来源模版**当前**内容指纹（由 API 边界读取模版后填充；AssetStore 不读模版）。
     * 客户端判定「入库按钮锁定」= sourceFingerprint === currentTemplateFingerprint；
     * 模版已删除时省略（视为未锁定）。
     */
    currentTemplateFingerprint?: string;
    /** Active 索引最后更新时间（epoch 毫秒）。 */
    updatedAt: number;
}
/**
 * 引用某个角色资产的工作流资产（按资产聚合去重后的引用事实）。
 *
 * 为什么必须按资产聚合：reference_workflow_ids 记的是工作流**版本行** id，且新版本行
 * 的引用从零开始计数——直接读 Active 版本行的数组长度会得出「shared 资产被 0 个工作流引用」
 * 这种自相矛盾的结论。语义上「谁在引用这个角色资产」是资产级事实。
 */
export interface RoleAssetReference {
    /** 引用方工作流资产 id。 */
    assetId: string;
    /** 该工作流资产的当前名称（取最新版本行；行缺失时回退 assetId）。 */
    name: string;
    /** 该工作流资产引用本角色资产的版本行数量（同一资产的多版本只聚合为一条）。 */
    versionCount: number;
}
/** 角色资产索引条目（Active 版本投影；归档资产取最新版本行投影）。 */
export interface RoleAssetSummary {
    assetId: string;
    versionId: number;
    name: string;
    kind: RoleAssetKind;
    /** 角色资产类型（standalone / inline / shared）。 */
    roleAssetType: RoleAssetType;
    /**
     * 角色职责摘要（Active 版本 systemPrompt 前 60 字；由 AssetStore 在列表查询里
     * JOIN 当前 Active 版本行生成，供父代理判断适用性）。
     */
    summary?: string;
    /** 晋升来源模版 id（非模版晋升时省略）。 */
    sourceTemplateId?: string;
    /** 晋升时来源模版的内容指纹（入库按钮锁定判据）。 */
    sourceFingerprint?: string;
    /** 该资产绑定的来源模版**当前**内容指纹（由 API 边界填充；语义同 WorkflowAssetSummary）。 */
    currentTemplateFingerprint?: string;
    /** Active 索引最后更新时间（epoch 毫秒）。 */
    updatedAt: number;
}
/**
 * 角色资产详情（Active 版本）。
 * 与 RoleTemplate 字段同域，便于客户端属性栏直接编辑与回写；
 * 检索上下文（retrieval_context）与向量字段是 V1 预留，不进本契约。
 */
export interface RoleAssetDetail {
    assetId: string;
    versionId: number;
    rowId: string;
    kind: RoleAssetKind;
    roleAssetType: RoleAssetType;
    name: string;
    systemPrompt: string;
    provider: string;
    model: string;
    reasoning?: string;
    presetId?: string | null;
    retryLimit: number;
    reactLimit?: number | null;
    inputSchema?: string;
    outputSchema?: string;
    systemPromptSource?: string;
    injectSystemPrompt?: boolean;
    injectToolSections?: boolean;
    promptFilePath?: string;
    /** 引用过该角色版本的工作流资产版本行 id 列表（统计缓存；单调递增）。 */
    referenceWorkflowIds: string[];
    /**
     * 已归档标记（Active 行已移除）。缺省即活跃。
     * 归档资产没有 Active 指针，其详情与版本列表一律以**最新版本行**为准。
     */
    retired?: boolean;
    /**
     * 引用了本角色资产**任一版本**的工作流资产（已按资产聚合去重；仅详情读填充）。
     * 保存前的影响面告知与归档确认框都消费它，因此必须是资产级事实而非单版本行事实。
     */
    referencingWorkflowAssets?: RoleAssetReference[];
    /** 晋升来源模版 id（非模版晋升时省略）。 */
    sourceTemplateId?: string;
    /** 该版本创建时间（epoch 毫秒）。 */
    createdAt: number;
}
/** 工作流资产里的角色节点 → 角色版本行引用（固定回放用）。 */ export interface WorkflowAssetRoleRef {
    /** 工作流图内的角色节点 id。 */
    nodeId: string;
    /** 被引用的角色版本行 id（role_asset_history.id）。 */
    roleVersionId: string;
}
/** 工作流资产详情（Active 版本；nodes 已按固定版本把角色节点字段 join 回填）。 */
export interface WorkflowAssetDetail {
    assetId: string;
    versionId: number;
    rowId: string;
    mode: WorkflowMode;
    name: string;
    description: string;
    /** 全量节点（角色节点已 join 回角色版本字段；非角色节点为晋升时快照）。 */
    nodes: GraphNode[];
    lines: Line[];
    meta?: OrgMeta;
    /** 角色节点 → 角色版本行 id（与 nodes 中的角色节点一一对应）。 */
    roleVersionIds: WorkflowAssetRoleRef[];
    /**
     * 已归档标记（Active 行已移除）。缺省即活跃。
     * 归档资产没有 Active 指针，其详情与版本列表一律以**最新版本行**为准。
     */
    retired?: boolean;
    /** 晋升来源模版 id（非模版晋升时省略）。 */
    sourceTemplateId?: string;
    /** 该版本创建时间（epoch 毫秒）。 */
    createdAt: number;
}
/** 资产 Active 详情（按 kind 判别）。 */
export type AssetDetail = WorkflowAssetDetail | RoleAssetDetail;
/**
 * 经验主体类型：经验必须对应主体实际承担的工作职责。
 *   - agent：一个执行主体（含子代理、以及未承担编排职责的父代理）完成实际任务后的经验；
 *   - team：一个团队（协作组）完成协作任务后的协作经验；
 *   - orchestrator：编排父代理完成组织/编排任务后的组织经验。
 */
export type ExperienceType = 'agent' | 'team' | 'orchestrator';
/**
 * 经验条目（磁盘行的对外投影）。
 *
 * 分层（与数据结构文档一致）：
 *   - Identity：id / experienceType；
 *   - Semantic Core：responsibility / taskType / decisionDomain / situation / trigger /
 *     principle / recommendedAction / exclusions；
 *   - Evidence：evidence（支撑事实，不是经验本体）；
 *   - Retrieval Projection：taskRetrievalText / decisionRetrievalText 与 embedding 元信息
 *     （系统生成，模型不得提交）；
 *   - Provenance：sourceRunId / generationPromptId / generationPromptVersion；
 *   - Lifecycle：active / createdAt / updatedAt。
 *
 * 经验没有版本控制：状态只有「活跃 / 已归档」两态，归档 = 退出召回面且内容全保留。
 */
export interface ExperienceEntry {
    id: string;
    /** 是否活跃（磁盘列 `experiences.is_active`；缺省即活跃）。 */
    active: boolean;
    /** 经验主体类型（决定召回面与主体边界）。 */
    experienceType: ExperienceType;
    /** 主体承担的责任范围（我对什么负责）。 */
    responsibility: string;
    /** 轻量任务分类标签（用于结构化检索，不是具体任务名称）。 */
    taskType: string;
    /** 经验涉及的决策领域（这是哪一类决策问题）。 */
    decisionDomain: string;
    /** 经验成立时所面对的实际情境或状态。 */
    situation: string;
    /** 未来再次出现什么可识别信号时应当回忆该经验。 */
    trigger: string;
    /** 从运行结果中抽象出的核心规律、因果关系或判断原则。 */
    principle: string;
    /** 将原则转化为未来可执行的行为建议。 */
    recommendedAction: string;
    /** 不应直接迁移该经验的条件列表（防止负迁移）。 */
    exclusions: string[];
    /** 支撑该经验的关键事实列表（不保存完整运行日志）。 */
    evidence: string[];
    /** 任务侧检索文本（系统由 responsibility + taskType + situation + trigger 生成）。 */
    taskRetrievalText: string;
    /** 决策侧检索文本（系统由 decisionDomain + principle + recommendedAction + exclusions 生成）。 */
    decisionRetrievalText: string;
    /** 生成向量所用的嵌入模型名（无向量能力的历史行为 undefined）。 */
    embeddingModel?: string;
    /** 向量维度（记录用；与向量字节长度互相印证）。 */
    embeddingDimension?: number;
    /** 产生该经验的运行 id（由主体解析得到，模型不得填写）。 */
    sourceRunId: string;
    /** 生成该经验时使用的 Prompt 行 id。 */
    generationPromptId: string;
    /** 生成该经验时使用的 Prompt 版本。 */
    generationPromptVersion: string;
    /** 创建时间（epoch 毫秒）。 */
    createdAt: number;
    /** 最后更新时间（epoch 毫秒；编辑语义字段即刷新）。 */
    updatedAt: number;
    /**
     * 长期质量统计（派生投影；由评价历史聚合而来，不是经验本体的一部分）。
     *
     * 为什么挂在条目上而不是单开一条读路径：统计值只服务于「界面展示」与「召回排序」两类消费，
     * 两处都已经在读取条目；单开一条路径会让「条目已读到、统计还没到」成为可能状态。
     * 无统计行时省略（读侧按中性值解释，而不是伪造一个 0.5 的假事实）。
     */
    stats?: ExperienceStatsEntry;
}
/**
 * 经验可编辑字段补丁（属性栏「保存」载荷）。
 *
 * `undefined` = 本次不改，`null` = 清空：两者语义不同，因此不能用 `??` 合并。
 * 数组字段允许 null（清空为空数组）；必填字符串字段被清空即拒绝（经验没有版本，改坏无从回滚）。
 * 检索文本与向量不在补丁内：它们由系统按语义字段重算，模型与界面都不能直接改。
 */
export interface ExperiencePatch {
    responsibility?: string;
    taskType?: string;
    decisionDomain?: string;
    situation?: string;
    trigger?: string;
    principle?: string;
    recommendedAction?: string;
    exclusions?: string[] | null;
    evidence?: string[] | null;
}
/**
 * 经验候选（模型提交侧的最小形状）。
 * 只含九个语义字段：主体类型与 provenance 由系统按当前主体解析结果补充，
 * 两个检索文本与向量由系统生成——模型无法伪造来源与生成规则。
 */
export interface ExperienceInsertDraft {
    experienceType: ExperienceType;
    responsibility: string;
    taskType: string;
    decisionDomain: string;
    situation: string;
    trigger: string;
    principle: string;
    recommendedAction: string;
    exclusions: string[];
    evidence: string[];
}
/** 经验生成 Prompt 表投影（Prompt 本身不是经验，不参与向量检索）。 */
export interface ExperienceGenerationPromptEntry {
    id: string;
    experienceType: ExperienceType;
    name: string;
    description?: string;
    prompt: string;
    promptVersion: string;
    /** 是否为该经验类型当前生效的唯一 Prompt。 */
    active: boolean;
    createdAt: number;
    updatedAt: number;
}
/**
 * 经验召回候选（召回第一阶段的模型可见结果）。
 * `summary` 固定为 responsibility + decisionDomain + exclusions + situation 的投影，
 * 供模型判断是否需要第二阶段按 id 取回完整内容。
 */
export interface ExperienceRecallHit {
    id: string;
    /** 相似度得分（语义检索为单位向量内积；BM25 回退为词法得分）。 */
    score: number;
    summary: string;
    /** 本次得分来源：semantic 语义检索 / bm25 词法回退。 */
    source: 'semantic' | 'bm25';
}
/**
 * 经验写入行：系统补全 provenance、检索投影与向量之后的**完整行事实**。
 * 与 ExperienceEntry 的差别只有一处——行内携带向量本身，条目投影只带向量元信息。
 */
export interface ExperienceInsertRow {
    id: string;
    experienceType: ExperienceType;
    responsibility: string;
    taskType: string;
    decisionDomain: string;
    situation: string;
    trigger: string;
    principle: string;
    recommendedAction: string;
    exclusions: string[];
    evidence: string[];
    taskRetrievalText: string;
    taskEmbedding: Float64Array;
    decisionRetrievalText: string;
    decisionEmbedding: Float64Array;
    embeddingModel?: string;
    embeddingDimension?: number;
    sourceRunId: string;
    generationPromptId: string;
    generationPromptVersion: string;
}
/** 判重判据的候选侧事实（同一 experienceType 的语义核心向量）。 */
export interface ExperienceDuplicateCandidate {
    experienceType: ExperienceType;
    decisionEmbedding: Float64Array;
    decisionRetrievalText: string;
}
/** 判重判据的既有侧事实（库中或本批已写入的 active 行）。 */
export interface ExperienceDuplicateExisting {
    id: string;
    decisionEmbedding: Float64Array;
    decisionRetrievalText: string;
}
/** 判重结论：重复时给出可直接呈现给模型的原因。 */
export type ExperienceDuplicateVerdict = {
    duplicate: true;
    reason: string;
} | {
    duplicate: false;
};
/**
 * 判重判据（纯函数，由经验域注入资产库）。
 *
 * 为什么以闭包注入而不是在资产库内实现相似度：相似度算法与阈值属于经验域
 * （向量来源可换、阈值可演进），而「读 active 行 → 判定 → 写入」必须原子，
 * 因此资产库只保证事务边界，判定规则由调用方提供。
 */
export type ExperienceDuplicateJudge = (candidate: ExperienceDuplicateCandidate, existing: ExperienceDuplicateExisting) => ExperienceDuplicateVerdict;
/** 批量判重写入入参：判定与写入落在同一笔事务内。 */
export interface ExperienceInsertCheckedInput {
    rows: ExperienceInsertRow[];
    duplicateOf: ExperienceDuplicateJudge;
}
/**
 * 编辑保存时一并刷新的检索投影与向量。
 * 由经验域在**事务外**算好（向量可能走远程端点），事务内只做校验与写入。
 */
export interface ExperienceRetrievalUpdate {
    taskRetrievalText: string;
    decisionRetrievalText: string;
    taskEmbedding: Float64Array;
    decisionEmbedding: Float64Array;
    embeddingModel?: string;
    embeddingDimension?: number;
}
/**
 * 五级语义锚点（0 / 0.25 / 0.50 / 0.75 / 1.00）。
 *
 * 为什么用离散联合而不是 number：模型侧只允许选锚点，连续小数（0.73）表达的是不存在的精度，
 * 且会让评价重新退化成「凭感觉给数字」。类型层收窄后，越界值在编译期与运行期都被拦住。
 */
export type ExperienceScoreAnchor = 0 | 0.25 | 0.5 | 0.75 | 1;
/** 决策效果的五级锚点（-1 / -0.50 / 0 / +0.50 / +1）：唯一跨零维度的取值域。 */
export type ExperienceDecisionEffectAnchor = -1 | -0.5 | 0 | 0.5 | 1;
/** 一次使用评价的四个维度（统一尺度；字段名与磁盘列一致）。 */
export interface ExperienceEvaluationScores {
    /** 适用性：这条经验是否真正适用于本次场景（0～1）。 */
    fitScore: ExperienceScoreAnchor;
    /** 决策效果：使用相比不使用，决策/结果实际改变了多少（-1～+1）。 */
    decisionEffect: ExperienceDecisionEffectAnchor;
    /** 信息增益：提供了多少具有区分度的决策信息（0～1）。 */
    informationGain: ExperienceScoreAnchor;
    /** 因果归因置信度：效果多大程度上确实来自该经验（0～1）。 */
    causalConfidence: ExperienceScoreAnchor;
}
/**
 * 评价写入行（评分锚点已由校验层收窄；provenance 全部由系统补齐）。
 *
 * 为什么没有 id：行 id 的命名空间与格式属磁盘契约（与经验 id 同口径），只能由资产库在
 * 写入事务内发号；调用方持有 id 只会引出第二套格式，且域层没有任何使用 id 的语义。
 */
export interface ExperienceEvaluationInsert extends ExperienceEvaluationScores {
    experienceId: string;
    /** 该次使用所属运行 id；无运行来源时为空串（与经验 provenance 同口径）。 */
    runId: string;
    /** 支撑本次评价的事实说明（可为空串）。 */
    evidence: string;
    /** 评分者主体身份（子代理取 childId，父代理取会话 id）。 */
    evaluatorSubjectId: string;
    /** 评分者模型名；无法确定时为空串（不伪造）。 */
    evaluatorModel: string;
}
/** 评价历史行投影（不可 update / delete 的历史事实）。 */
export interface ExperienceEvaluationEntry extends ExperienceEvaluationInsert {
    id: string;
    createdAt: number;
}
/** 使用事实写入行（「该经验被显式注入过 agent 上下文」这一事实；id 同由资产库发号）。 */
export interface ExperienceUsageInsert {
    experienceId: string;
    /** 显式注入发生时所属运行 id；无运行来源时为空串。 */
    runId: string;
    /** 被注入的主体身份（子代理 childId / 父代理会话 id）。 */
    subjectId: string;
}
/** 使用事实历史行投影。 */
export interface ExperienceUsageEntry extends ExperienceUsageInsert {
    id: string;
    createdAt: number;
}
/**
 * 统计投影的数值部分（除主键与记账时间外的全部列）。
 *
 * 字段语义（§10～§14）：
 *   - effectiveSampleCount = Σ 评价权重（不是使用次数，高置信高适用评价贡献更大）；
 *   - recalledCount = 被显式注入次数（来自使用事实，不由评价聚合得出）；
 *   - usedCount = 已提交评价的使用次数（来自评价条数）；
 *   - fitMean = 评价权重的加权平均 fit；
 *   - empiricalValue = 中性先验收缩后的经验价值（[-1,1]）；
 *   - variance / stability = 加权方差与其映射出的稳定性（[0,1]）；
 *   - evidenceStrength = 证据强度（随有效样本量饱和）；
 *   - harmCount / harmRate / harmSeverity = 负向效果条数、比例与加权严重度；
 *   - qualitySignal = 中心化质量信号（[-1,1]，召回修正的直接输入）；
 *   - trust = 面向展示的信任度（[0.05,0.95]，0.5 = 证据不足保持中性）。
 */
export interface ExperienceStatsValues {
    effectiveSampleCount: number;
    recalledCount: number;
    usedCount: number;
    fitMean: number;
    empiricalValue: number;
    variance: number;
    stability: number;
    evidenceStrength: number;
    harmCount: number;
    harmRate: number;
    harmSeverity: number;
    qualitySignal: number;
    trust: number;
}
/** 统计行投影（`experience_id` 主键 + 数值 + 记账时间）。 */
export interface ExperienceStatsEntry extends ExperienceStatsValues {
    experienceId: string;
    updatedAt: number;
}
/**
 * 聚合输入：某经验的全部评价历史与该经验的使用事实。
 *
 * 为什么把 recalledCount 作为输入而不是从评价推导：注入次数与评价次数是两个事实
 * （被注入不一定被评价），它来自使用事实表，聚合器只负责原样带入。
 */
export interface ExperienceStatsAggregateInput {
    evaluations: readonly ExperienceEvaluationScores[];
    recalledCount: number;
}
/**
 * 统计聚合器（纯函数，由经验域注入资产库）。
 *
 * 为什么以闭包注入而不是在资产库内实现公式：公式属于经验域且会演进（§25 的参数调整），
 * 而「读全部历史 → 聚合 → 覆盖写入」必须原子，因此资产库只保证事务边界。
 */
export type ExperienceStatsAggregate = (input: ExperienceStatsAggregateInput) => ExperienceStatsValues;
/** 首次建立某经验的统计行时的中性投影（不含 recalledCount，由资产库按本批条数填入）。 */
export type NeutralStatsValues = Omit<ExperienceStatsValues, 'recalledCount'>;
/** 评价批量写入入参：校验、聚合与写入落在同一笔事务内。 */
export interface ExperienceEvaluationInsertInput {
    rows: ExperienceEvaluationInsert[];
    aggregate: ExperienceStatsAggregate;
}
/** 使用事实批量写入入参：插入使用行并按首次建立统计行的中性投影同步 recalled_count。 */
export interface ExperienceUsageRecordInput {
    rows: ExperienceUsageInsert[];
    neutralStats: NeutralStatsValues;
}
/** 统计全量重建入参（读全部历史 → 聚合 → 覆盖写入，一笔事务）。 */
export interface ExperienceStatsRebuildInput {
    aggregate: ExperienceStatsAggregate;
    neutralStats: NeutralStatsValues;
}
