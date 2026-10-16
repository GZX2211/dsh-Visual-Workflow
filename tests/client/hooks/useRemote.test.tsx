// @vitest-environment jsdom

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import React from "react"
import { useRemote, type RemoteFace } from "../../../src/client/hooks/useRemote.js"
import { en, zh, type Dict } from "../../../src/client/i18n.js"
import {
  REMOTE_CONNECTION_CODE,
  REMOTE_EMPTY_STREAM_CODE,
  REMOTE_PARSE_CODE,
  REMOTE_TIMEOUT_CODE,
  type RemoteError,
} from "../../../src/client/lib/remote.js"

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  container = document.createElement("div")
  document.body.append(container)
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function renderRemote(copy: Dict, language?: string): Promise<RemoteFace> {
  let remote: RemoteFace | null = null
  function Harness(): null {
    remote = useRemote(copy, language)
    return null
  }
  await act(async () => {
    root = createRoot(container!)
    root.render(React.createElement(Harness))
  })
  return remote!
}

describe("useRemote transport errors", () => {
  it("test_connection_failure_uses_copy_and_preserves_diagnostic_code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed") }))
    const remote = await renderRemote(en)
    const error = await remote.call("list").then(() => null, (reason: unknown) => reason as RemoteError)
    expect(error).toMatchObject({
      message: en.remoteConnection.replace("{detail}", "fetch failed"),
      code: REMOTE_CONNECTION_CODE,
      detail: "fetch failed",
    })
  })

  it("test_host_business_error_message_and_code_are_not_rewritten", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error: { message: "Host-owned business message", code: "ERR_BUSINESS" },
    }), { status: 409 })))
    const remote = await renderRemote(en)
    const error = await remote.call("save").then(() => null, (reason: unknown) => reason as RemoteError)
    expect(error).toMatchObject({ message: "Host-owned business message", code: "ERR_BUSINESS" })
  })

  it("test_empty_host_message_with_business_code_is_not_reclassified_as_transport", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error: { message: "", code: "ERR_EMPTY_MESSAGE" },
    }), { status: 409 })))
    const remote = await renderRemote(en)
    const error = await remote.call("save").then(() => null, (reason: unknown) => reason as RemoteError)
    expect(error?.message).toBe("ERR_EMPTY_MESSAGE")
    expect(error?.code).toBe("ERR_EMPTY_MESSAGE")
    expect(error?.transportKind).toBeUndefined()
  })

  it("test_timeout_uses_localized_copy_and_keeps_the_stable_code", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))
    })))
    const remote = await renderRemote(zh)
    const pending = remote.call("slowEndpoint", {}, { timeoutMs: 25 }).then(
      () => null,
      (reason: unknown) => reason as RemoteError,
    )
    await act(async () => { await vi.advanceTimersByTimeAsync(25) })
    const error = await pending
    expect(error).toMatchObject({
      message: zh.remoteTimeout.replace("{endpoint}", "slowEndpoint"),
      code: REMOTE_TIMEOUT_CODE,
      endpoint: "slowEndpoint",
    })
  })

  it("test_empty_stream_uses_localized_copy_and_stable_code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })))
    const remote = await renderRemote(en)
    const error = await remote.stream("debug", {}, () => {}).then(
      () => null,
      (reason: unknown) => reason as RemoteError,
    )
    expect(error).toMatchObject({ message: en.remoteEmptyStream, code: REMOTE_EMPTY_STREAM_CODE })
  })
})

describe("useRemote 成功响应体校验", () => {
  it("test_ok_response_with_empty_body_is_a_failure_not_undefined_success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })))
    const remote = await renderRemote(en)
    const error = await remote.call("saveWorkflow").then(
      () => null,
      (reason: unknown) => reason as RemoteError,
    )
    expect(error).toMatchObject({ code: REMOTE_PARSE_CODE, message: en.remoteParse.replace("{endpoint}", "saveWorkflow") })
  })

  it("test_ok_response_without_value_field_is_a_failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })))
    const remote = await renderRemote(zh)
    const error = await remote.call("saveWorkflow").then(
      () => null,
      (reason: unknown) => reason as RemoteError,
    )
    expect(error).toMatchObject({ code: REMOTE_PARSE_CODE, message: zh.remoteParse.replace("{endpoint}", "saveWorkflow") })
  })

  it("test_ok_response_with_null_value_still_resolves", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, value: null }), { status: 200 })))
    const remote = await renderRemote(en)
    expect(await remote.call("deleteWorkflow")).toBeNull()
  })
})

describe('active workflow locale', () => {
  it.each(['run', 'runResume'])('sends the active locale on %s', async endpoint => {
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify({ ok: true, value: {} })))
    vi.stubGlobal('fetch', fetch)
    const remote = await renderRemote(en, 'en-US')
    await remote.call(endpoint, { sessionId: 's1', flowId: 'f1' })
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).args).toEqual({ sessionId: 's1', flowId: 'f1', language: 'en-US' })
  })
  it('does not add locale fields to unrelated endpoints', async () => {
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(JSON.stringify({ ok: true, value: {} })))
    vi.stubGlobal('fetch', fetch)
    const remote = await renderRemote(zh, 'zh')
    await remote.call('list', { sessionId: 's1' })
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).args).toEqual({ sessionId: 's1' })
  })
})
