import { FloatingWindow } from './studio/floating-window.js';
import './entry.css';
/** i18n 命名空间（注册进官方 locale 服务）。 */
export declare const I18N_NS = "visualWorkflow";
/**
 * 会话树根 id 解析（疑点二修复）：DSH 中每个子代理对话持有独立 childSessionId
 * （官方 dsh-subagent：childId = SessionId(randomUUID())，header.parentSession 记录
 * 父链），若工作台直接绑定「当前选中会话」，在子代理对话界面打开时列表按子代理
 * 会话过滤为空，实例被误认为「跟随代理 ID」。实例/服务按**会话树根**隔离：
 * 沿官方 sessions.list summaries 的 parentSessionId 上溯到无父（根）会话，
 * 主代理与其全部后代子代理共享同一实例列表。快照无该字段（旧运行时）时回退
 * 当前会话自身（行为不变，单代理场景无回归）。
 */
export declare function rootSessionIdOf(current: string, sessions: {
    list?: {
        getSnapshot?(): {
            current?: unknown;
            byId?: Record<string, unknown>;
        };
        get?(): {
            current?: unknown;
            byId?: Record<string, unknown>;
        };
    };
} | null | undefined): string;
export declare const inject: string[];
/** 测试导出（client-smoke 渲染路径验证）。 */
export declare const VisualWorkflowView: null;
export declare const __test: {
    FloatingWindow: typeof FloatingWindow;
};
export declare function apply(ctx: {
    get?(name: string): unknown;
    effect?(fn: () => (() => void) | void, label?: string): unknown;
    locale?: unknown;
}): void;
