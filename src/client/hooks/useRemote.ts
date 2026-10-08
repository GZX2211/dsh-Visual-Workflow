// src/client/hooks/useRemote.ts
//
// Remote-call integration seam: stable references and localized transport errors.

import { useMemo } from "react"
import type { Dict } from "../i18n.js"
import {
  remoteCall,
  streamCall,
  type RemoteCallOptions,
  type RemoteError,
} from "../lib/remote.js"

export interface RemoteFace {
  /** POST /visual-workflow/<endpoint>, body { args }, returning value. */
  call(endpoint: string, args?: Record<string, unknown>, options?: RemoteCallOptions): Promise<unknown>
  /** SSE call for service debugging; lifecycle is controlled by signal. */
  stream(endpoint: string, args: Record<string, unknown>, onLine: (line: string) => void, signal?: AbortSignal): Promise<void>
}

function messageForTransportFailure(error: RemoteError, copy: Dict): string | null {
  switch (error.transportKind) {
    case "timeout":
      return copy.remoteTimeout.replace("{endpoint}", error.endpoint ?? "")
    case "connection":
      return copy.remoteConnection.replace("{detail}", error.detail ?? "")
    case "http":
      return copy.remoteHttpStatus.replace("{status}", String(error.status ?? ""))
    case "emptyStream":
      return copy.remoteEmptyStream
    default:
      return null
  }
}

function localizeTransportError(error: unknown, copy: Dict): unknown {
  if (!(error instanceof Error)) return error
  const remoteError = error as RemoteError
  const message = messageForTransportFailure(remoteError, copy)
  if (message === null) return error
  const localized = new Error(message) as RemoteError
  localized.code = remoteError.code
  localized.transportKind = remoteError.transportKind
  localized.detail = remoteError.detail
  localized.endpoint = remoteError.endpoint
  localized.status = remoteError.status
  return localized
}

/** Stable remote-call face; dictionary changes replace only the error-copy mapping. */
export function useRemote(copy: Dict): RemoteFace {
  return useMemo(() => ({
    call: async (endpoint: string, args?: Record<string, unknown>, options?: RemoteCallOptions): Promise<unknown> => {
      try {
        return await remoteCall(endpoint, args, options)
      } catch (error) {
        throw localizeTransportError(error, copy)
      }
    },
    stream: async (endpoint: string, args: Record<string, unknown>, onLine: (line: string) => void, signal?: AbortSignal): Promise<void> => {
      try {
        await streamCall(endpoint, args, onLine, signal)
      } catch (error) {
        throw localizeTransportError(error, copy)
      }
    },
  }), [copy])
}
