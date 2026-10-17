/** 插件上下文的最小形状（服务经 get 运行时解析）。 */
export interface WorkspacePickerContext {
    get?(name: string): unknown;
}
/** 目录选择器能力（宿主接入后向业务层暴露的最小接口）。 */
export interface WorkspacePicker {
    /** 当前环境是否具备官方目录选择器（实时判定：官方服务可能晚于插件激活）。 */
    available(): boolean;
    /** 打开官方目录选择器；取消返回 null，不可用/失败抛错。 */
    pick(): Promise<string | null>;
}
/** 官方目录选择器不可用（稳定错误类型，调用方据此显示词典文案而非通用错误）。 */
export declare class WorkspacePickerUnavailableError extends Error {
    constructor();
}
/**
 * 构造官方目录选择器接入缝。
 * @param ctx - 官方 client 插件上下文（只读服务，不持有生命周期）。
 * @returns 选择器能力（可用性每次调用实时判定）。
 */
export declare function createWorkspacePicker(ctx: WorkspacePickerContext): WorkspacePicker;
