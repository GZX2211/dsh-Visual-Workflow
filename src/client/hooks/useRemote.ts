// src/client/hooks/useRemote.ts
//
// 远端调用面（稳定引用；fetch 封装见 lib/remote.ts）。

import { useMemo } from 'react'
import { remoteCall } from '../lib/remote.js'

export interface RemoteFace {
  /** POST /visual-workflow/<endpoint>，body { args }，返回 value。 */
  call(endpoint: string, args?: Record<string, unknown>): Promise<unknown>
}

/** 远端调用面（remoteCall 为纯函数，hook 仅提供稳定引用）。 */
export function useRemote(): RemoteFace {
  return useMemo(() => ({ call: remoteCall }), [])
}
