// src/host/storage/graph-patch-log.ts
//
// 「会话曾成功提交图结构补丁」这一事实的持久化（单文件即单资源：graph-patches/<sessionId>.json）。
//
// 为什么需要它：编排经验（orchestrator 类型）的职责判据不能只看「当前有没有运行中的编排实例」——
// 规划期（尚未启动运行）与运行结束后的复盘同样是在履行编排职责，此时却会被判成「执行主体」而拒绝
// 沉淀编排经验。改过图就是编排行为的直接证据，且该事实必须**跨进程存活**（本插件的典型场景是
// 守护重启后接续，进程内记录会随重启丢失）。
//
// 职责边界：只记「发生过 + 最后一次的目标与规模」，不保存 op 明细——审计不是本表的目的；
// 单资源读损坏仍抛可诊断错误，列表读跳过损坏项以保证宿主启动装载不被单个坏文件拖垮。
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWriteJson, readJson, withJsonLock } from './atomic.js';
import { graphPatchLogPath } from './storage-paths.js';
/** 图补丁记录存储（读改写经同一把 withJsonLock，避免并发丢更新）。 */
export class GraphPatchLogStore {
    root;
    constructor(root) {
        this.root = root;
    }
    /**
     * 记录一次成功的图结构补丁（幂等语义之外的累加；返回最新记录）。
     * 事务外不读，读改写全部在同一临界区内完成——并发补丁不会互相覆盖计数。
     */
    async record(input) {
        const path = graphPatchLogPath(this.root, input.sessionId);
        return withJsonLock(path, async () => {
            const current = await readJson(path, null);
            const next = {
                sessionId: input.sessionId,
                count: (current?.count ?? 0) + 1,
                lastAt: new Date(input.now ?? Date.now()).toISOString(),
                lastTargetId: input.targetId,
                lastScope: input.scope,
            };
            await atomicWriteJson(path, next);
            return next;
        });
    }
    /** 单资源读：不存在返回 null；损坏 JSON 抛带路径的 CorruptJsonError（不伪装成不存在）。 */
    async read(sessionId) {
        return readJson(graphPatchLogPath(this.root, sessionId), null);
    }
    /** 列出已记录的会话 id（宿主启动时装载内存索引用；损坏项跳过以保证可用性）。 */
    async listSessionIds() {
        const dir = join(this.root, 'graph-patches');
        let names = [];
        try {
            names = await readdir(dir);
        }
        catch {
            // 目录不存在等价于「从未改过图」：空列表是正确事实，不是错误
            return [];
        }
        const ids = [];
        for (const name of names) {
            if (!name.endsWith('.json'))
                continue;
            try {
                const record = await readJson(join(dir, name), null);
                const sessionId = String(record?.sessionId ?? '').trim();
                if (sessionId)
                    ids.push(sessionId);
            }
            catch {
                // 列表读跳过损坏项（权限等其他错误不由 readJson 抛出，故不会被此处吞掉）
            }
        }
        return ids;
    }
}
//# sourceMappingURL=graph-patch-log.js.map