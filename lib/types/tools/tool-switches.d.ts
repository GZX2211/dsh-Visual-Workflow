/** 全局工具开关文档形态（tool-switches.json）。 */
export interface ToolSwitchDoc {
    /** 被关闭（父代理不可见）的工具名清单。 */
    disabled: string[];
}
/** 磁盘指纹（ensureFresh 的比对基准：mtimeMs + size）。 */
export interface FileStamp {
    mtimeMs: number;
    size: number;
}
/** 空文档（默认全部工具开启）。 */
export declare function emptyToolSwitchDoc(): ToolSwitchDoc;
/** 工具开关存储：持久化 + 内存快照（瀑布过滤同步读取）+ 跨进程按需刷新。 */
export declare class ToolSwitchStore {
    private readonly root;
    /** 内存权威快照（load/set/ensureFresh 后即时生效；未 load 前为空集 = 不过滤）。 */
    private current;
    /** 上次读盘时的文件指纹（null = 文件不存在或尚未读盘）。 */
    private stamp;
    constructor(root: string);
    /** 文件路径（tool-switches.json，与 combos.json 平级）。 */
    private path;
    /**
     * 读取磁盘文档（损坏 JSON 按空文档容忍；保存会重写完整文件）。
     * 兼容历史字段：早期版本写过 `enabled` 记账键，现语义已废弃——读取时忽略，
     * 下一次原子写会把它自然清掉（无需迁移脚本）。
     */
    private readDoc;
    /** 当前文件指纹（不存在返回 null；其它 IO 错误按「无变化」处理，不抛给调用方）。 */
    private stampOf;
    /** 装载内存快照（Service.init 时调用；幂等）：默认全部开启，只含用户关闭项。 */
    load(): Promise<void>;
    /** 当前被关闭的工具名集合（瀑布过滤与白名单解析共用；同步读取）。 */
    currentDisabled(): ReadonlySet<string>;
    /** 读取关闭清单（磁盘权威；持久化往返断言用）。 */
    readDisabled(): Promise<string[]>;
    /** 生效态清单（异步；先跨进程刷新再取快照——GUI 端点与工具报告统一走这里）。 */
    effectiveDisabled(): Promise<string[]>;
    /**
     * 跨进程刷新（幂等、并发安全）：磁盘指纹变了才重读，未变零解析。
     *   - 同进程内的 setDisabled/setDisabledMany 已直接更新快照与指纹，不会重复读盘；
     *   - 文件被删除（指纹 null）而快照非空时按「空清单」重载（与损坏 JSON 同语义）。
     */
    ensureFresh(): Promise<void>;
    /**
     * 设置某个工具的开关状态（幂等）：
     *   - name 必须非空且非官方保留传输名 run_code（该名永远不可关闭）；
     *   - disabled=true 加入关闭清单；false 移出；
     *   - 原子落盘后刷新内存快照（全局过滤即时生效）。
     * @returns 更新后的完整关闭清单。
     */
    setDisabled(name: string, disabled: boolean): Promise<string[]>;
    /**
     * 批量设置一组工具的开关状态（幂等；组合管理「标签一键开关」用）：
     *   - 空名/空白名直接忽略（不报错——批量场景逐个校验收敛为「有效集合」）；
     *   - disabled=true 全部加入关闭清单；false 全部移出；
     *   - 单次原子落盘（与单工具 setDisabled 同一把锁），成功后一次性刷新内存快照。
     * @returns 更新后的完整关闭清单。
     */
    setDisabledMany(names: string[], disabled: boolean): Promise<string[]>;
}
/** system-prompt/assemble 瀑布的 assembly 最小形状（零官方类型依赖）。 */
export interface PromptAssemblyLike {
    sections?: Array<{
        name: string;
        text: string;
    }>;
    contexts?: unknown[];
    tools?: Array<{
        name: string;
        description?: string;
        parameters?: unknown;
    }>;
    variables?: Record<string, unknown>;
}
/** 瀑布上下文最小形状（on 方法；unscoped ctx 注册全局生效）。 */
export interface FilterContextLike {
    on(name: string, listener: (assembly: unknown, context: unknown, next: () => Promise<unknown>) => Promise<unknown>): () => void;
}
/**
 * 纯函数：从组装结果中剔除被关闭工具（assembly.tools Schema 与 tool:<name> 散文段）。
 * 幂等且确定性：同一输入同一输出；disabled 为空时原样返回（不改动官方组装）。
 */
export declare function filterToolsInAssembly(assembly: PromptAssemblyLike, disabled: ReadonlySet<string>): PromptAssemblyLike;
/**
 * 注册全局工具开关瀑布（host 层；unscoped ctx 对所有 agent 组装生效）：
 *   - 每次组装先跨进程刷新开关快照（别的 dsh 进程改过磁盘即重读），再执行官方/
 *     上游瀑布（next()），最后剔除被关闭工具；
 *   - 过滤读取内存快照（同步），开关切换即时生效；
 *   - 返回 disposer（插件卸载时撤销）。
 */
export declare function registerToolSwitchFilter(ctx: FilterContextLike, store: ToolSwitchStore): () => void;
