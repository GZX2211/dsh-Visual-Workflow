// src/host/storage/flow-store.ts
//
// FlowStore：插件持久化事实层的唯一公共门面。
//
// 核心职责（见 ./AGENTS.md）：把 Host 的持久化文档以「单文件即单资源 + 原子发布 +
// 进程内/跨进程锁」保存与读取。目录布局与路径计算的稳定契约见 ./storage-paths.ts；
// 原子写/读与锁原语见 ./atomic.ts；写入字段与版本策略的纯逻辑见 ./document-policy.ts；
// 读取时的最小形状守卫见 ./document-shape.ts；模板种类判别见 ./template-model.ts；
// 服务↔工作流投影见 ./service-view.ts。
//
// 非职责：不做 Workflow/图语义决策（合法性、状态机、运行推进、结构编辑）；不持有
// 运行态内存事实（运行锁/快照/等待器归 orchestrator）；不定义第二套 Workflow 结构
// 事实源。
//
// 会话隔离（需求 §4.2.2 规则 3 / Q23）：workflow/service 文件内记录 sessionId，
// 列出/读取按 sessionId 过滤；模板（roles/data/groups/flow-templates）与工具组合
// 全局共享不隔离。
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { atomicWriteJson, readJson, withJsonLock, CorruptJsonError } from './atomic.js';
import { InvalidDocumentError, isBuiltinSeedState, isRunSnapshot, isServiceState, isSessionIdMap, isTemplate, isToolComboDocument, isWorkflowDocument, isWorkflowTemplate, } from './document-shape.js';
import { DIRS as DATA_DIRS, builtinSeedsPath, combosPath, flowTemplatePath, runsPath, servicePath, sessionsPath, templateDir, templatePath, workflowPath, } from './storage-paths.js';
import { isDatabaseTemplate } from './template-model.js';
import { FlowNotFoundError, publishDocument, publishVersionedDocument, } from './document-policy.js';
import { serviceToWorkflowView } from './service-view.js';
import { normalizeLegacyNodes } from '../graph/index.js';
export { FlowNotFoundError, FlowRevisionConflictError } from './document-policy.js';
// ---------------------------------------------------------------------------
// 按形状读取（持久化层策略）
// ---------------------------------------------------------------------------
/**
 * 列表场景逐文件读取：单个文件损坏（JSON 解析失败或形状不是该资源）时跳过该文件返回 null，
 * 不阻塞整个列表——一个坏文件不应让同目录其他正常文件全部不可见。跳过必须留下告警，
 * 否则「数据损坏」会退化成一个无人知道的空列表。
 * 其余读取失败（EACCES 等）仍上浮（保留可诊断性，防止把权限问题伪装成空列表）。
 * 注意：单资源读取不返回 null 兜底——坏文档必须抛错（见 ./AGENTS.md）。
 */
async function readListEntry(dir, name, guard) {
    const path = join(dir, name);
    try {
        const raw = await readJson(path, null);
        if (raw === null)
            return null;
        if (!guard(raw)) {
            warnSkippedDocument(path, '形状不匹配（缺少文档身份字段）');
            return null;
        }
        return raw;
    }
    catch (error) {
        if (error instanceof CorruptJsonError) {
            warnSkippedDocument(path, error.message);
            return null;
        }
        throw error;
    }
}
/**
 * 单资源读取：文件不存在返回 null；JSON 合法但形状不是该资源时抛带路径的错误。
 * 为什么不与列表读共用「跳过」语义：单资源读的调用方要立刻用它的字段，返回 null 会被
 * 当成「不存在」处理，损坏文件因此从视野里消失（见 ./AGENTS.md「读取语义」）。
 */
async function readDocument(path, guard) {
    const raw = await readJson(path, null);
    if (raw === null)
        return null;
    if (!guard(raw)) {
        throw new InvalidDocumentError(resolve(path), '缺少文档身份字段（id 非空字符串）');
    }
    return raw;
}
/** 坏文档告警（可追溯；列表读不因它整表不可用）。 */
function warnSkippedDocument(path, detail) {
    console.warn(`[storage] 跳过损坏的文档 ${path}：${detail}`);
}
/**
 * 目录级列表读取：目录不存在（ENOENT）→ 空列表（合法降级：该资源从未写过）；
 * 其余失败（EACCES/ENOTDIR 等）原样上浮。
 * 为什么只放过 ENOENT：把权限/结构故障一并吞成「空列表」，数据消失就无人可诊断
 * ——列表读的可用性只应覆盖「本来就没有」这一种情况（见 ./AGENTS.md「读取语义」）。
 */
async function readDirNames(dir) {
    try {
        return await readdir(dir);
    }
    catch (error) {
        if (error?.code === 'ENOENT')
            return [];
        throw error;
    }
}
/**
 * 码位序比较（契约排序，**不用 localeCompare**）。
 * 为什么：localeCompare 依赖运行环境的 ICU 数据与默认 locale，同一份数据在不同机器上
 * 会得到不同顺序（全量 ICU 与 small-icu、非 en 默认 locale 下 collation 不同），
 * 列表顺序与快照测试随之漂移。ISO 时间戳与 id/名称的确定性排序一律用码位序。
 */
function compareText(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
/** 按 updatedAt 倒序（缺失时间戳按空串处理，稳定排序）。 */
function byUpdatedAtDesc(a, b) {
    return compareText(String(b.updatedAt ?? ''), String(a.updatedAt ?? ''));
}
/**
 * 旧图读取/写入兼容：kind='file' 节点归一化为任务节点。
 * 读取时保证调用方看到新契约；写入时保证旧快照不会把退役形态重新落盘。
 */
function withTaskNodes(doc) {
    return { ...doc, nodes: normalizeLegacyNodes(doc.nodes) };
}
/** 已退役的任务模板字段（旧文件模板形状）：读取兼容，保存时剥除。 */
const RETIRED_TASK_TEMPLATE_FIELDS = ['fileKind', 'managedPath', 'fileName', 'files'];
/** 保存前的模板净化：任务模板不得把已退役的受管文件字段重新写盘。 */
function sanitizeTemplate(kind, template) {
    if (kind !== 'task')
        return template;
    const next = { ...template };
    for (const field of RETIRED_TASK_TEMPLATE_FIELDS)
        delete next[field];
    return next;
}
// ---------------------------------------------------------------------------
// FlowStore
// ---------------------------------------------------------------------------
export class FlowStore {
    root;
    /** 顶层数据目录（init 时创建；常量表供测试与外部工具断言布局）。 */
    static DIRS = DATA_DIRS;
    constructor(root) {
        this.root = root;
    }
    /** 初始化目录结构（幂等：mkdir recursive，重复调用安全）。 */
    async init() {
        for (const dir of FlowStore.DIRS) {
            await mkdir(join(this.root, dir), { recursive: true });
        }
    }
    // ---- 工作流（模式一；工作台全局化后列表按需跨会话） ------------------------
    /**
     * 列出工作流（按 updatedAt 倒序）。
     * 工作台全局化改版：sessionId 缺省时列出**全部会话**的工作流实例（工作台
     * 全局面板「所有实例」数据源）；传入 sessionId 时仍按会话过滤（定时任务
     * 检测目标会话已有实例、旧单会话面板兼容调用）。
     */
    async listWorkflows(sessionId) {
        const dir = join(this.root, 'workflows');
        const names = await readDirNames(dir);
        const items = [];
        for (const name of names) {
            if (!name.endsWith('.json'))
                continue;
            const doc = await readListEntry(dir, name, isWorkflowDocument);
            if (doc && (sessionId === undefined || doc.sessionId === sessionId))
                items.push(withTaskNodes(doc));
        }
        return items.sort(byUpdatedAtDesc);
    }
    /** 读取单个工作流；不属于该会话返回 null（隔离语义）。 */
    async getWorkflow(sessionId, flowId) {
        const doc = await readDocument(workflowPath(this.root, flowId), isWorkflowDocument);
        if (!doc || doc.sessionId !== sessionId)
            return null;
        return withTaskNodes(doc);
    }
    /** 保存工作流（创建/更新统一；revision 递增 + 冲突保护 + 原子写）。 */
    async saveWorkflow(flow, sessionId, options = {}) {
        if (!sessionId)
            throw new Error('saveWorkflow 需要 sessionId');
        if (!flow?.id)
            throw new Error('saveWorkflow 需要 flow id');
        const path = workflowPath(this.root, flow.id);
        return withJsonLock(path, async () => {
            const current = await readJson(path, null);
            // 会话归属校验：磁盘上已属于别的会话时拒绝覆盖，
            // 否则一个错误/恶意的 sessionId 入参就能改写他人工作流内容并把归属翻走。
            // 不存在（current === null）视为新建，照旧放行。
            // 抛稳定码（而非普通 Error）：边界据此映射 404，不得落成 500。
            if (current && current.sessionId !== sessionId)
                throw new FlowNotFoundError(flow.id);
            const saved = {
                ...publishVersionedDocument(withTaskNodes(flow), current, options, new Date().toISOString()),
                sessionId,
            };
            await atomicWriteJson(path, saved);
            return saved;
        });
    }
    /** 删除工作流；仅当归属会话匹配时删除（返回是否删除成功）。 */
    async deleteWorkflow(sessionId, flowId) {
        const path = workflowPath(this.root, flowId);
        return withJsonLock(path, async () => {
            const current = await readJson(path, null);
            if (!current || current.sessionId !== sessionId)
                return false;
            await rm(path, { force: true });
            return true;
        });
    }
    // ---- 服务（模式二；工作台全局化后列表按需跨会话） --------------------------
    /**
     * 列出服务（跳过 *.sessions.json 映射文件；按 updatedAt 倒序）。
     * 工作台全局化改版：sessionId 缺省时列出**全部会话**的服务实例；传入时按
     * 会话过滤（旧单会话面板兼容调用）。
     */
    async listServices(sessionId) {
        const dir = join(this.root, 'services');
        const names = await readDirNames(dir);
        const items = [];
        for (const name of names) {
            if (!name.endsWith('.json') || name.endsWith('.sessions.json'))
                continue;
            const doc = await readListEntry(dir, name, isServiceState);
            if (doc && (sessionId === undefined || doc.sessionId === sessionId))
                items.push(withTaskNodes(doc));
        }
        return items.sort(byUpdatedAtDesc);
    }
    /** 读取单个服务；不属于该会话返回 null。 */
    async getService(sessionId, serviceId) {
        const doc = await readDocument(servicePath(this.root, serviceId), isServiceState);
        if (!doc || doc.sessionId !== sessionId)
            return null;
        return withTaskNodes(doc);
    }
    /** 按 id 读取服务（不校验归属会话；服务管理器/服务进程用）。 */
    async getServiceById(serviceId) {
        const doc = await readDocument(servicePath(this.root, serviceId), isServiceState);
        return doc ? withTaskNodes(doc) : null;
    }
    /** 列出全部服务（不按会话过滤；自动恢复扫描用）。 */
    async listServicesAll() {
        const dir = join(this.root, 'services');
        const names = await readDirNames(dir);
        const items = [];
        for (const name of names) {
            if (!name.endsWith('.json') || name.endsWith('.sessions.json'))
                continue;
            const doc = await readListEntry(dir, name, isServiceState);
            if (doc)
                items.push(withTaskNodes(doc));
        }
        return items.sort(byUpdatedAtDesc);
    }
    /** 服务文档 → 模式二工作流视图（编排运行入口的 flow 形态；纯投影，不读盘）。 */
    async getServiceAsFlow(serviceId) {
        const service = await this.getServiceById(serviceId);
        if (!service)
            return null;
        return serviceToWorkflowView(service);
    }
    /**
     * 按「工作流视图」写回服务实例（补丁工具用）：只覆盖图结构与元参数，
     * 保留服务自身的运行字段（status/port/apiKeyHash/时间戳），避免调用方拼错形状。
     *
     * 并发契约：存在性/归属校验、合并、revision 记账与写盘全部在**同一把服务文件锁**内
     * 完成——若在锁外读取再锁内写回，会覆盖 ServiceManager 并发写入的运行字段（丢更新）。
     */
    async saveServiceAsFlow(doc, sessionId, options = {}) {
        if (!sessionId)
            throw new Error('saveServiceAsFlow 需要 sessionId');
        if (!doc?.id)
            throw new Error('saveServiceAsFlow 需要 service id');
        const path = servicePath(this.root, doc.id);
        return withJsonLock(path, async () => {
            const current = await readJson(path, null);
            if (!current)
                throw new Error(`服务不存在：${doc.id}`);
            if (current.sessionId !== sessionId)
                throw new Error(`服务不属于该会话：${doc.id}`);
            const merged = {
                ...current,
                name: doc.name ?? current.name,
                description: doc.description ?? current.description,
                nodes: doc.nodes,
                lines: doc.lines,
                ...(doc.meta ? { meta: doc.meta } : {}),
            };
            const saved = await this.writeServiceDoc(path, merged, current, sessionId, options);
            return serviceToWorkflowView(saved);
        });
    }
    /** 保存服务（revision 递增 + 冲突保护；status/port 等运行字段由服务管理器独立更新）。 */
    async saveService(service, sessionId, options = {}) {
        if (!sessionId)
            throw new Error('saveService 需要 sessionId');
        if (!service?.id)
            throw new Error('saveService 需要 service id');
        const path = servicePath(this.root, service.id);
        return withJsonLock(path, async () => {
            const current = await readJson(path, null);
            return this.writeServiceDoc(path, service, current, sessionId, options);
        });
    }
    /**
     * 服务文档写回（调用方必须已持该服务文件锁，且已完成各自的校验）：
     * 发布策略（净化 + revision 记账 + 时间戳继承）见 document-policy，返回落盘副本。
     */
    async writeServiceDoc(path, incoming, current, sessionId, options) {
        const saved = {
            ...publishVersionedDocument(withTaskNodes(incoming), current, options, new Date().toISOString()),
            sessionId,
        };
        await atomicWriteJson(path, saved);
        return saved;
    }
    /** 删除服务（级联删除其 sessions 映射文件）。 */
    async deleteService(sessionId, serviceId) {
        const path = servicePath(this.root, serviceId);
        return withJsonLock(path, async () => {
            const current = await readJson(path, null);
            if (!current || current.sessionId !== sessionId)
                return false;
            await rm(path, { force: true });
            await rm(sessionsPath(this.root, serviceId), { force: true });
            return true;
        });
    }
    /** 列出某类模板（roles/ 角色；groups/ Team；data/ 任务+数据库按字段判别过滤）。 */
    async listTemplates(kind) {
        const dir = join(this.root, templateDir(kind));
        const names = await readDirNames(dir);
        const items = [];
        for (const name of names) {
            if (!name.endsWith('.json'))
                continue;
            const t = await readListEntry(dir, name, isTemplate);
            if (!t)
                continue;
            // 数据模板同目录混存：task 与 database 以 dbType 字段判别（§6 目录规划）
            if (kind === 'task' && isDatabaseTemplate(t))
                continue;
            if (kind === 'database' && !isDatabaseTemplate(t))
                continue;
            items.push(t);
        }
        return items.sort((a, b) => compareText(String(a.name ?? ''), String(b.name ?? '')));
    }
    /**
     * 按 id 取单个模板（无则 null；导入导出用）。
     * 单资源读：直接按 id 定位文件并保持 file/database 子类判别；损坏 JSON 抛
     * CorruptJsonError，JSON 合法但形状不是模板则抛 InvalidDocumentError（携带 filePath）——
     * 两者都不伪装成「不存在」，避免导入路径静默覆盖损坏数据。
     */
    async getTemplate(kind, id) {
        const t = await readDocument(templatePath(this.root, kind, id), isTemplate);
        if (!t)
            return null;
        if (kind === 'task' && isDatabaseTemplate(t))
            return null;
        if (kind === 'database' && !isDatabaseTemplate(t))
            return null;
        return t;
    }
    /**
     * 保存模板（原子写；模板 id 由调用方生成；返回带 createdAt/updatedAt 的持久化副本）。
     * 时间戳与净化走共用发布策略（模板无 revision 记账，落盘字段不因此增减）。
     */
    async saveTemplate(kind, template) {
        if (!template?.id)
            throw new Error('saveTemplate 需要 template id');
        const path = templatePath(this.root, kind, template.id);
        return withJsonLock(path, async () => {
            const current = await readJson(path, null);
            const saved = publishDocument(sanitizeTemplate(kind, template), current, new Date().toISOString());
            await atomicWriteJson(path, saved);
            return saved;
        });
    }
    /** 删除模板（仅删文件，不影响画布中已深拷贝的节点——§4.2.1 解耦语义）。 */
    async deleteTemplate(kind, id) {
        const path = templatePath(this.root, kind, id);
        return withJsonLock(path, async () => {
            const exists = (await readJson(path, null)) !== null;
            if (!exists)
                return false;
            await rm(path, { force: true });
            return true;
        });
    }
    // ---- 工作流模板（flow-templates/，全局共享，不按会话隔离；图2 交互改造） ----
    /** 列出全部工作流模板（按 updatedAt 倒序；全局共享，所有会话可见）。 */
    async listFlowTemplates() {
        const dir = join(this.root, 'flow-templates');
        const names = await readDirNames(dir);
        const items = [];
        for (const name of names) {
            if (!name.endsWith('.json'))
                continue;
            const t = await readListEntry(dir, name, isWorkflowTemplate);
            if (t)
                items.push(withTaskNodes(t));
        }
        return items.sort(byUpdatedAtDesc);
    }
    /** 按 id 读取单个工作流模板（无则 null）。 */
    async getFlowTemplate(templateId) {
        const template = await readDocument(flowTemplatePath(this.root, templateId), isWorkflowTemplate);
        return template ? withTaskNodes(template) : null;
    }
    /** 保存工作流模板（新建/更新统一；revision 递增 + 冲突保护 + 原子写；无 sessionId 隔离）。 */
    async saveFlowTemplate(template, options = {}) {
        if (!template?.id)
            throw new Error('saveFlowTemplate 需要模板 id');
        const path = flowTemplatePath(this.root, template.id);
        return withJsonLock(path, async () => {
            const current = await readJson(path, null);
            const saved = publishVersionedDocument(withTaskNodes(template), current, options, new Date().toISOString());
            await atomicWriteJson(path, saved);
            return saved;
        });
    }
    /** 删除工作流模板（仅删文件，不影响已生成的实例——模板/实例深拷贝解耦语义）。 */
    async deleteFlowTemplate(templateId) {
        const path = flowTemplatePath(this.root, templateId);
        return withJsonLock(path, async () => {
            const exists = (await readJson(path, null)) !== null;
            if (!exists)
                return false;
            await rm(path, { force: true });
            return true;
        });
    }
    // ---- 内置模板播种标记（builtin-seeds.json；一次性标记，不随模板删除） ----
    /**
     * 读取已播种的内置模板 id（文件不存在 → 空数组）。
     *
     * 为什么损坏必须抛错而不是返回空数组：空数组会被播种逻辑理解为「从未播种」，
     * 于是一个已播种后被用户删除的模板会在重启时复活——「确实没有标记」与「标记读不到」
     * 必须可区分（见 ./AGENTS.md「读取语义」）。
     */
    async listAppliedBuiltinSeeds() {
        const state = await readDocument(builtinSeedsPath(this.root), isBuiltinSeedState);
        return state ? [...state.seededTemplateIds] : [];
    }
    /**
     * 合并写入已播种的内置模板 id（读改写在同一临界区内完成；重复 id 去重）。
     * 空列表是空操作：不创建标记文件，避免「没有播种」也留下一次性状态。
     * 既有标记损坏时上浮错误，绝不覆盖用户的标记文件。
     */
    async addAppliedBuiltinSeeds(ids) {
        const added = [...new Set(ids.map((id) => String(id)).filter((id) => id.trim() !== ''))];
        if (added.length === 0)
            return;
        const path = builtinSeedsPath(this.root);
        await withJsonLock(path, async () => {
            const current = await readDocument(path, isBuiltinSeedState);
            const merged = [...new Set([...(current?.seededTemplateIds ?? []), ...added])];
            const state = { seededTemplateIds: merged, updatedAt: new Date().toISOString() };
            await atomicWriteJson(path, state);
        });
    }
    // ---- 运行历史（runs/<runId>.json 单文件；按 flowId 过滤） ------------------
    /**
     * 列出某工作流的全部 run（按 startedAt 倒序）。
     * @param sessionId 可选会话过滤：传入时仅返回归属该会话的 run（历史查询端点
     *   必须传，防跨会话运行历史泄露；resume 侧因调用前已按会话定位 flow 可不传）。
     */
    async listRuns(flowId, sessionId) {
        const dir = join(this.root, 'runs');
        const names = await readDirNames(dir);
        const items = [];
        for (const name of names) {
            if (!name.endsWith('.json'))
                continue;
            const run = await readListEntry(dir, name, isRunSnapshot);
            if (run && run.flowId === flowId && (sessionId === undefined || run.sessionId === sessionId))
                items.push(run);
        }
        // 与工作流/模板列表同口径：码位序（localeCompare 会让顺序随运行环境 ICU 漂移）
        return items.sort((a, b) => compareText(String(b.startedAt ?? ''), String(a.startedAt ?? '')));
    }
    /**
     * 列出全部 run 快照（对账 / 接续 / 幂等判定等**扫描整个目录**的场景；顺序不保证）。
     *
     * 为什么不提供「先列 id 再逐个 getRun」的用法：getRun 是单资源读，形状不合法即抛错，
     * 而扫描场景的输入是整个目录——目录里混入任何非本资源文档（历史格式残留、外部文件）
     * 都会让整轮扫描失败。此处复用列表读语义逐文件跳过并告警：一个坏文件不影响其余记录，
     * 「跳过」仍可在日志中追溯。
     */
    async listAllRuns() {
        const dir = join(this.root, 'runs');
        const names = await readDirNames(dir);
        const items = [];
        for (const name of names) {
            if (!name.endsWith('.json'))
                continue;
            const run = await readListEntry(dir, name, isRunSnapshot);
            if (run)
                items.push(run);
        }
        return items;
    }
    /** 读取单个 run 快照。 */
    async getRun(runId) {
        return readDocument(runsPath(this.root, runId), isRunSnapshot);
    }
    /**
     * 保存 run 快照（断点持久化走同一入口；原子写保证崩溃不撕裂）。
     *
     * 为什么本资源不走文档发布策略（无净化 / 无 revision 记账 / 无时间戳继承）：
     * RunSnapshot 是编排器拥有的**运行态事实整体**——它没有 revision 列，也不需要
     * createdAt/updatedAt（时间语义在 startedAt/endedAt 上，由编排器按状态机推进），
     * 且不接受客户端回写（`_draft`/`lastPatch` 这类客户标记不会出现在快照里）。快照必须
     * 按调用方给出的完整对象原样落盘，任何字段级改写都会破坏断点续跑的一致性。
     */
    async saveRun(run) {
        if (!run?.id)
            throw new Error('saveRun 需要 run id');
        const path = runsPath(this.root, run.id);
        return withJsonLock(path, async () => {
            await atomicWriteJson(path, run);
            return run;
        });
    }
    // ---- 工具组合（combos.json 单文件） ---------------------------------------
    /**
     * 读取工具组合文档（combos.json，单资源）。
     * 文件不存在即空列表（既有降级语义）；形状不合法抛带路径的可诊断错误——读取方会直接
     * 展开该数组，把非数组当数组用会写出「按下标/字符切碎」的垃圾数据，比报错难排查得多。
     */
    async readComboState() {
        const path = combosPath(this.root);
        const state = await readJson(path, null);
        if (state === null)
            return { combos: [] };
        if (!isToolComboDocument(state)) {
            throw new InvalidDocumentError(resolve(path), '缺少 combos 数组');
        }
        // 元素级形状（ToolCombo 的字段）不在守卫范围：缺省字段由消费方各自降级
        return { combos: state.combos };
    }
    /** 列出全部工具组合（全局共享）。 */
    async listToolCombos() {
        return (await this.readComboState()).combos;
    }
    /** 保存工具组合（id 须为 combo- 前缀，§4.6 规则 2）。 */
    async saveToolCombo(combo) {
        if (!combo?.id || !combo.id.startsWith('combo-'))
            throw new Error('工具组合 id 必须以 combo- 前缀');
        if (!Array.isArray(combo.tools))
            throw new Error('工具组合 tools 必须为数组');
        const path = combosPath(this.root);
        return withJsonLock(path, async () => {
            const state = await this.readComboState();
            const combos = [combo, ...state.combos.filter((c) => c.id !== combo.id)];
            await atomicWriteJson(path, { combos });
            return combo;
        });
    }
    /** 删除工具组合。 */
    async deleteToolCombo(id) {
        const path = combosPath(this.root);
        return withJsonLock(path, async () => {
            const state = await this.readComboState();
            if (!state.combos.some((c) => c.id === id))
                return false;
            await atomicWriteJson(path, { combos: state.combos.filter((c) => c.id !== id) });
            return true;
        });
    }
    // ---- userId → sessionId 映射（模式二多租户隔离，§4.1.3 规则 7） -------------
    /**
     * 读取 userId 映射（返回副本，防调用方意外修改内部缓存）。
     *
     * 为什么这一处降级而不是抛错：映射是服务运行的旁路事实，文件损坏时抛错会让该服务的
     * 会话解析永久失败（连下次写入自愈的机会都没有）；按「无映射」降级只影响已损坏的旧值，
     * 下一次 mergeUserIdMap 写回即恢复。降级必须留告警，不得静默。
     */
    async readSessionIdMap(path) {
        const raw = await readJson(path, null);
        if (raw === null)
            return {};
        if (!isSessionIdMap(raw)) {
            warnSkippedDocument(path, '不是 userId → sessionId 映射（按空映射降级）');
            return {};
        }
        return { ...raw };
    }
    /** 读取某服务的 userId 映射（返回副本，防调用方意外修改内部缓存）。 */
    async userIdMap(serviceId) {
        return this.readSessionIdMap(sessionsPath(this.root, serviceId));
    }
    /**
     * 合并写入某服务的 userId 映射（读改写在同一把 withJsonLock 内完成）。
     * 为什么必须合并而不是「先读再整表写回」：后者是两次独立锁作用域内的读改-写，
     * 不同 userId 并发首解析时互相覆盖（丢失映射 → 重启后上下文断裂）。合并写把
     * read-modify-write 收进同一临界区，并发安全。
     *
     * 生命周期不变式（跨文件，见 ./AGENTS.md）：映射文件从属于服务文档。删除服务后
     * 不得再写映射；调用方在写入前须确认服务仍存在（storage 不保证跨文件事务）。
     */
    async mergeUserIdMap(serviceId, entries) {
        const path = sessionsPath(this.root, serviceId);
        return withJsonLock(path, async () => {
            const merged = { ...(await this.readSessionIdMap(path)), ...entries };
            await atomicWriteJson(path, merged);
            return merged;
        });
    }
}
//# sourceMappingURL=flow-store.js.map