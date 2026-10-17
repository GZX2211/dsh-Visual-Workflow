// src/client/hooks/useTeamMemberLimit.ts
//
// 宿主下发的 Team 成员上限（只读投影）：画布入组交互据此拒绝超限。
//
// 为什么经端点取而不是画布常量：官方名额是会话级累计值（agent-team.maxMembers），
// 由部署层决定；画布只有跟同一个值才谈得上「画布放得下 = 运行期排得进」。
// 下发失败 / 未下发一律回退 TEAM_MEMBER_LIMIT_FALLBACK（辅助路径失败不阻断编辑）。

import { useEffect, useState } from 'react'
import { resolveTeamMemberLimit, TEAM_MEMBER_LIMIT_FALLBACK } from '../lib/group-members.js'
import { EP } from '../lib/remote.js'
import type { RemoteFace } from './useRemote.js'

/** 订阅宿主下发的 Team 成员上限；请求中止与卸载校验由本 effect 负责。 */
export function useTeamMemberLimit(remote: RemoteFace): number {
  const [limit, setLimit] = useState(TEAM_MEMBER_LIMIT_FALLBACK)

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const value = await remote.call(EP.EP_RUNTIME_CONFIG, {}, { signal: controller.signal })
        if (!controller.signal.aborted) setLimit(resolveTeamMemberLimit(value))
      } catch {
        // 下发失败 / 卸载取消：保持回退上限（保守值，不会让用户配出排不进的名额）
      }
    })()
    return () => controller.abort()
  }, [remote])

  return limit
}
