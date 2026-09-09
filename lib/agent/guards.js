// src/host/agent/guards.ts
//
// ReAct 软截停护栏（T-022；V-01 定稿语义）。
//
// 官方取证（需求文档 V-01 + 架构文档 §8 索引 #5、#22）：
//   - 官方无内置 turn 预算（packages/core/agent-loop/README.md Known Limitations：
//     "tool calls or steering continue the current turn; a policy that bounds
//     runaway turns must cancel from an existing lifecycle extension point"）；
//   - 因此按需求文档 §4.2.3.2 规则 3 实现插件侧「软截停（强制收尾）」——不硬性
//     中断代理：达到上限后子代理不再发起新的工具调用（工具调用被强制拒绝），
//     并被要求基于已有进展输出最终结论后正常结束。
//
// 机制（两线，架构文档 §4.2 L221）：
//   ① agent/pre-step 计步（waterfall，每步 ≈ 一次思考-行动迭代）：当前回合迭代数
//      达到上限时，替换本步进入消息为「强制收尾指令」，让模型直接产出最终结论
//      （官方扩展点：runtime-types L231 pre-step 可替换 messages，PreStepDecision
//      的 enter 分支，来自 §8 索引 #5 取证）；
//   ② tools.guard()（child scope，官方 core/tools L1110）：触达上限后同步拒绝
//      该子代理的一切工具调用（原因「已达迭代上限」）——即便模型无视指令继续
//      调用，调用也会被强制拒绝，双保险迫使模型输出结论。软截停完成后回合正常
//      结束（stopReason=completed），节点标记 react-capped（非失败，正常产出）。
//
// 生命周期（按 childId 隔离；经 registerContinuableSetup 注入每个子代理的
// 未发布 childCtx，§8 索引 #7）：每回合开始时（turn 变化）重置计数与软截停标记；
// 标记由编排器经 consumeCapped 在 subagent/end 观察时消费——若该 child 不属于
// 任何运行，下回合 pre-step 的重置会自然清掉未消费的标记（不残留）。
//
// 为什么工具拒绝走 tools.guard 而不是 tools.restrict（W-04 注释，§8 索引 #10）：
// guard 是「运行时判定拒绝」——只在软截停窗口内拒绝、回合结束即自动恢复；
// restrict 是「声明式掩码」——需要成对 disposer 管理且 unknown 名称会抛错。
// 软截停是瞬态窗口，guard 语义精确匹配。
/** 软截停的强制收尾指令（面向模型，英文；W-03 面向模型的文本与工具描述一致）。 */
export const REACT_CAP_MESSAGE = 'You have reached the ReAct iteration limit for this turn. ' +
    'Stop calling tools now and emit your final conclusion based on the progress made so far.';
/** tools.guard 拒绝原因（面向模型，英文）。 */
export const REACT_CAP_DENY_REASON = 'ReAct iteration limit reached — conclude this turn with your final output now.';
/**
 * 创建软截停护栏：返回桥（runner 登记上限/编排器消费标记）与贡献
 * （经 ctx.subagents.registerContinuableSetup 注入每个子代理的未发布 childCtx，
 * 官方 activation-setup-registry L26 契约：(childCtx) => disposer）。
 */
export function createReactGuard() {
    // childId → ReAct 上限（仅本插件创建的子代理；其他插件子代理不在表内即旁路）
    const limits = new Map();
    // childCtx → 回合状态（identity 键：同一 childCtx 对象即同一子代理）
    const states = new WeakMap();
    // childId → 待消费的软截停标记（编排器 subagent/end 观察时消费）
    const cappedFlags = new Set();
    const bridge = {
        setLimit(childId, limit) {
            limits.set(childId, limit);
        },
        drop(childId) {
            limits.delete(childId);
            cappedFlags.delete(childId);
        },
        consumeCapped(childId) {
            return cappedFlags.delete(childId);
        },
    };
    /** 读取 payload 中的 childId（官方 payload 携带 agent 对象）。 */
    function agentIdOf(payload) {
        return String(payload?.agent?.id ?? '');
    }
    /** 取某 childCtx 的回合状态（惰性建表）。 */
    function stateOf(ctx) {
        let state = states.get(ctx);
        if (!state) {
            state = { turn: -1, steps: 0, capped: false };
            states.set(ctx, state);
        }
        return state;
    }
    /** 取 childCtx 上的 tools 服务（child scope；直接字段或经 get 回退）。 */
    function toolsOf(childCtx) {
        const direct = childCtx.tools;
        if (direct && typeof direct.guard === 'function')
            return direct;
        if (typeof childCtx.get === 'function') {
            const viaGet = childCtx.get('tools');
            if (viaGet && typeof viaGet.guard === 'function')
                return viaGet;
        }
        return null;
    }
    const contribution = (rawChildCtx) => {
        // 官方契约 childCtx 为 unknown：运行时守卫收窄到最小结构
        const childCtx = rawChildCtx;
        const disposers = [];
        // ① pre-step 计步 + 触达上限后替换本步消息为强制收尾指令（waterfall 透传放行）
        try {
            disposers.push(childCtx.on('agent/pre-step', async (rawPayload, next) => {
                const payload = rawPayload;
                const childId = agentIdOf(payload);
                const limit = limits.get(childId);
                // 非本插件子代理或未设限：放行（保留 next 链）
                if (limit === undefined) {
                    if (next)
                        return next();
                    return undefined;
                }
                const state = stateOf(childCtx);
                const turn = Number(payload?.turn ?? -1);
                // 回合变化：新回合重置预算与软截停标记（未消费的旧标记在此自然清除）
                if (turn !== state.turn) {
                    state.turn = turn;
                    state.steps = 0;
                    state.capped = false;
                    cappedFlags.delete(childId);
                }
                state.steps += 1;
                if (state.steps >= limit && !state.capped) {
                    state.capped = true;
                    cappedFlags.add(childId);
                }
                if (!state.capped) {
                    if (next)
                        return next();
                    return undefined;
                }
                // 软截停：替换本步消息为强制收尾指令（enter 分支，官方 PreStepDecision）
                return {
                    kind: 'enter',
                    messages: [
                        {
                            role: 'user',
                            content: [{ type: 'text', text: REACT_CAP_MESSAGE }],
                            source: { kind: 'plugin' },
                        },
                    ],
                };
            }));
        }
        catch {
            // childCtx 形状不符（理论上不出现）：计步线失效，拒绝线仍可注册（降级不阻塞）
        }
        // ② tools.guard：软截停窗口内拒绝本子代理的工具调用（双保险；child scope 专属）。
        // 判定以 cappedFlags 为准（drop/回合重置都会清除——不读 state.capped，避免
        // drop 后残留状态误拒）；exec.agent.id 定位子代理（官方 ToolExecution.agent）。
        try {
            const tools = toolsOf(childCtx);
            if (tools) {
                disposers.push(tools.guard((exec) => {
                    const childId = String(exec?.agent?.id ?? '');
                    if (childId && cappedFlags.has(childId))
                        return REACT_CAP_DENY_REASON;
                    return undefined;
                }));
            }
        }
        catch {
            // tools 服务缺失：拒绝线失效，pre-step 指令线仍有效（软截停降级但不失效）
        }
        return () => {
            for (const dispose of disposers) {
                try {
                    dispose();
                }
                catch {
                    // 清理尽力而为
                }
            }
        };
    };
    return { bridge, contribution };
}
/** 从 bridge 派生 NodeRunner.consumeReactCapped 适配（runner 装配用）。 */
export function consumeReactCappedOf(bridge) {
    return (childId) => bridge.consumeCapped(childId);
}
//# sourceMappingURL=guards.js.map