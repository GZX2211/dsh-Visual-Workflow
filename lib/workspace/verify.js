// src/host/workspace/verify.ts
//
// 工作区路径校验（「启动时开启新会话 + 选择工作区」需求）：
//   - 官方工作区 = 会话 header.cwd（dsh-workspace 按 cwd 校验归属；dsh-sandbox-policy
//     以 session.header.cwd 为 workspace-write 根）——因此保存配置时校验路径存在且为
//     目录，即可保证「输入路径 → 新会话 cwd → 沙箱工作区」的联动闭环；
//   - 空值视为未配置（返回 undefined，不校验）；
//   - 校验失败抛明确错误（宿主保存端点转 400，运行期创建会话失败按触发失败处理）。
import { stat } from 'node:fs/promises';
/**
 * 校验并规范化工作区路径（可选字段）：
 *   - 空串/未设置 → undefined；
 *   - 非空路径必须存在且为目录，否则抛错（错误消息面向用户，含原路径）。
 */
export async function resolveWorkspacePath(value) {
    const path = String(value ?? '').trim();
    if (!path)
        return undefined;
    let info;
    try {
        info = await stat(path);
    }
    catch (error) {
        const code = error?.code;
        if (code === 'ENOENT' || code === 'EACCES' || code === 'ENOTDIR' || code === 'EPERM') {
            throw new Error(`工作区路径不存在或不可访问：${path}（请填写存在的绝对路径目录）`);
        }
        throw error;
    }
    if (!info.isDirectory()) {
        throw new Error(`工作区路径不是目录：${path}（请填写存在的绝对路径目录）`);
    }
    return path;
}
//# sourceMappingURL=verify.js.map