import { VisualWorkflowApiEcosystem } from './api-ecosystem.js';
export declare class VisualWorkflowApiCatalog extends VisualWorkflowApiEcosystem {
    toolCombos(): Promise<unknown>;
    toolComboPut(args: {
        combo?: unknown;
    }): Promise<unknown>;
    toolComboDelete(args: {
        id?: unknown;
    }): Promise<unknown>;
    /**
     * 插件目录：工具（全局层 ∪ 存活 agent scope ∪ preset standing scope，含中文
     * 描述映射）+ MCP 服务器 + 已装载插件摘要。scope key 必须是 agent 对象本身
     * （官方 ScopeKey 语义），传错只能看到全局层。
     */
    pluginCatalog(args: {
        sessionId?: unknown;
    }): Promise<unknown>;
    /** 全部可见工具 schema（全局层 ∪ 存活 root agent ∪ preset standing scope）。 */
    private allToolSchemas;
    /** MCP 服务器：列表 / 增删改 / 启停（写入 profile 托管区，重启生效）。 */
    mcpList(): Promise<unknown>;
    mcpPut(args: {
        server?: unknown;
    }): Promise<unknown>;
    mcpDelete(args: {
        id?: unknown;
    }): Promise<unknown>;
    mcpToggle(args: {
        id?: unknown;
        disabled?: unknown;
    }): Promise<unknown>;
    /**
     * 全局工具开关列表（被关闭 = 父代理上下文不可见；独立于工作流运行状态）。
     * 生效态口径与 system-prompt/assemble 瀑布完全一致（effectiveDisabled 先做跨进程
     * 刷新再取内存快照）——历史上这里读「磁盘用户项」曾与生效态分叉，导致组合管理
     * 把被默认种子隐藏的工具显示成「已开启」（界面说谎 → 用户以为开关失灵）。
     */
    toolSwitches(): Promise<unknown>;
    /** 设置单个工具开/关状态（全局即时生效；返回更新后的完整关闭清单）。 */
    toolSwitchPut(args: {
        name?: unknown;
        disabled?: unknown;
    }): Promise<unknown>;
    /**
     * 批量设置一组工具开/关状态（组合管理「标签一键开关」：把某标签下全部工具统一关/开）。
     *   - names 必须非空数组；空白名忽略；官方保留传输名 run_code 静默跳过（不可关闭）；
     *   - 单次原子落盘 + 刷新内存快照，全局即时生效。
     * @returns 更新后的完整关闭清单。
     */
    toolSwitchPutMany(args: {
        names?: unknown;
        disabled?: unknown;
    }): Promise<unknown>;
}
/**
 * 组合管理卡片描述上限（字符）。
 * 模型侧工具 description 面向模型可以长（错误码/op 组约束等），但卡片只有几十像素宽：
 * 不截断就会把文本挤出卡片边框（2026.09 用户报障）。此处做数据层兜底，客户端另有
 * CSS 行数钳制（styles.ts `.wf-combo-card__desc`）与卡片最小高度（`.wf-combo-card`）。
 * 取 80：约合卡片内 2 行文本（10px 字号 / 约 200px 内容宽），与卡片最小高度 96px 匹配，
 * 保证「名称 + 描述 + 操作按钮」三者在卡片内互不重叠。
 */
export declare const CARD_DESC_MAX = 80;
/**
 * 组合管理卡片描述（纯函数，导出供单测）：
 *   - 命中 TOOL_ZH → 短中文；
 *   - 未命中 → schema 原文（英文加 [EN] 前缀；已是中文则原样）；
 *   - **一律按 CARD_DESC_MAX 截断**（超长描述不得撑破卡片）。
 */
export declare function zhDescription(name: string, fallback: string): string;
