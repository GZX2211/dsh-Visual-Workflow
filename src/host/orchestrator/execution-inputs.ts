import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { ctxInEdges, nodeById, parseExecutionContract } from '../graph/index.js'
import type { FileNode, RoleNode, WorkflowDocument } from '../shared/graph-model.js'
import type { RunSnapshot } from '../shared/types.js'
import { WfError } from './errors.js'
import { authorizedInputPath, authorizedOutputPath, outputSignature } from "./execution-file-access.js"

function inputError(message: string, code: string): WfError {
  return Object.assign(new WfError(message, code), { phase: 'node_input', retryable: false })
}

export function executionOf(node: RoleNode) {
  const result = parseExecutionContract(node.data.execution)
  if (result.issue) throw inputError(`节点 ${node.id}：${result.issue}`, 'WF_EXECUTION_CONTRACT_INVALID')
  return result.value ?? {}
}

export function absoluteInputPath(path: string, cwd?: string): string {
  if (isAbsolute(path)) return resolve(path)
  if (!cwd || !isAbsolute(cwd)) throw inputError(`相对路径缺少实际会话工作目录：${path}`, 'WF_INPUT_PATH_UNRESOLVED')
  return resolve(cwd, path)
}

function configuredPaths(node: FileNode): string[] {
  return [...new Set([node.data.managedPath, ...(node.data.files ?? []).map((file) => file.managedPath)].filter((path): path is string => typeof path === 'string' && !!path.trim()).map((path) => path.trim()))]
}

function configuredAbsolutePath(path: string, snapshot: RunSnapshot, managedRoot?: string): string {
  // managedPath 的存储契约是相对 dataDir 的 data/files/...，不是相对 Agent cwd。
  if (managedRoot && /^data[/\\]files[/\\]/.test(path)) return resolve(managedRoot, path)
  return absoluteInputPath(path, snapshot.workingDirectory)
}

/** 运行绑定独立于图文档；未完成消费者需要的文件才参与启动/恢复预检。 */
export async function prepareRunInputs(flow: WorkflowDocument, snapshot: RunSnapshot, raw?: unknown, managedRoot?: string, authorizedFiles?: readonly string[]): Promise<void> {
  const bindings = { ...snapshot.fileBindings }
  if (raw !== undefined) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw inputError('fileBindings 必须为文件节点 id 到路径数组的对象', 'WF_BAD_FILE_BINDINGS')
    for (const [id, paths] of Object.entries(raw)) {
      const node = nodeById(flow, id)
      if (node?.kind !== 'file' || node.data.fileKind !== 'file' || !Array.isArray(paths) || !paths.length || paths.some((path) => typeof path !== 'string' || !path.trim())) {
        throw inputError(`文件绑定无效：${id}（需要受管文件节点和非空路径数组）`, 'WF_BAD_FILE_BINDINGS')
      }
      bindings[id] = [...new Set((paths as string[]).map((path) => path.trim()))]
    }
  }
  for (const node of flow.nodes) {
    if (node.kind !== 'file' || node.data.fileKind !== 'file') continue
    const required = flow.lines.some((line) => {
      const source = nodeById(flow, line.source)
      if ((source?.kind === "proxy" ? source.proxySourceId : line.source) !== node.id || line.targetHandle !== 'ctx-in') return false
      const target = nodeById(flow, line.target)
      const id = target?.kind === 'proxy' ? target.proxySourceId : line.target
      const status = snapshot.nodes.find((record) => record.nodeId === id)?.status
      return status !== 'ok' && status !== 'react-capped'
    })
    if (!required) continue
    const paths = bindings[node.id] ?? configuredPaths(node)
    if (!paths.length) throw inputError(`文件节点 ${node.id} 尚未绑定输入文件；请上传文件或传入 fileBindings`, 'WF_INPUT_FILE_UNBOUND')
    bindings[node.id] = paths.map((path) => bindings[node.id] ? absoluteInputPath(path, snapshot.workingDirectory) : configuredAbsolutePath(path, snapshot, managedRoot))
    bindings[node.id] = await Promise.all(bindings[node.id].map((path) => authorizedInputPath(path, snapshot.workingDirectory, managedRoot, authorizedFiles)))
  }
  if (Object.keys(bindings).length) snapshot.fileBindings = bindings
}

export async function preflightNodeInputs(flow: WorkflowDocument, node: RoleNode, snapshot: RunSnapshot, managedRoot?: string, authorizedFiles?: readonly string[], hasRuntimeInputs = false): Promise<Record<string, string | null>> {
  const contract = executionOf(node)
  const edges = ctxInEdges(flow, node.id)
  if (contract.inputSource === 'ctx' && !edges.length) throw inputError(`节点 ${node.id} 声明 ctx 输入却没有 ctx 连线；请连接显式 ctx。若要无 ctx 的自动交接，请明确将输入契约配置为 runtime 并启用 auto`, 'WF_INPUT_CONTEXT_MISSING')
  if (contract.inputSource === 'workspace' && !snapshot.workingDirectory) throw inputError(`节点 ${node.id} 缺少实际会话工作目录`, 'WF_INPUT_PATH_UNRESOLVED')
  if (contract.inputSource === 'runtime' && !hasRuntimeInputs && !edges.some((edge) => snapshot.fileBindings?.[edge.source]?.length)) throw inputError(`节点 ${node.id} 缺少连接到该节点的运行期文件绑定`, 'WF_INPUT_FILE_UNBOUND')
  for (const edge of edges) {
    const source = nodeById(flow, edge.source)
    const resolved = source?.kind === 'proxy' ? nodeById(flow, source.proxySourceId) : source
    if (contract.inputSource === "ctx" && (edge.sourceHandle !== "ctx-out" || !resolved)) throw inputError(`节点 ${node.id} 的 ctx 来源或端口无效：${edge.source}`, "WF_INPUT_CONTEXT_MISSING")
    if (resolved?.kind === 'file') {
      if (resolved.data.fileKind === 'text') {
        if (!resolved.data.content?.trim()) throw inputError(`上游文本文件节点为空：${resolved.id}`, 'WF_INPUT_CONTEXT_MISSING')
      } else {
        const paths = snapshot.fileBindings?.[resolved.id] ?? configuredPaths(resolved)
        if (!paths.length) throw inputError(`文件节点未绑定：${resolved.id}`, 'WF_INPUT_FILE_UNBOUND')
        const absolute = paths.map((path) => snapshot.fileBindings?.[resolved.id] ? absoluteInputPath(path, snapshot.workingDirectory) : configuredAbsolutePath(path, snapshot, managedRoot))
        const authorized = await Promise.all(absolute.map((path) => authorizedInputPath(path, snapshot.workingDirectory, managedRoot, authorizedFiles)))
        snapshot.fileBindings ??= {}
        snapshot.fileBindings[resolved.id] = authorized
      }
    } else if (resolved?.kind === 'agent' || resolved?.kind === 'parent' || (resolved?.kind === 'start' && flow.mode === 'mode2')) {
      const record = snapshot.nodes.find((entry) => entry.nodeId === resolved.id)
      if (record?.taskAcceptance && record.taskAcceptance.status !== "accepted") throw inputError(`上游 ${resolved.id} 尚未通过任务验收，不能作为 ctx 数据`, "WF_TASK_REVIEW_REQUIRED")
      if (contract.inputSource === 'ctx' && (!record || !['ok', 'react-capped', 'armed'].includes(record.status) || !record.output?.trim())) throw inputError(`上游 ctx 产出尚不可用：${resolved.id}`, 'WF_INPUT_CONTEXT_MISSING')
      if (record && ["ok", "react-capped", "armed"].includes(record.status) && (resolved.kind === "agent" || resolved.kind === "parent")) {
        try { await verifyNodeArtifacts(resolved, structuredClone(snapshot), Date.now()) } catch (error) {
          // 上游完成时的证据不能代替下游启动时的文件可读性；保留稳定错误码。
          if (error instanceof Error) Object.assign(error, { phase: "node_input" })
          throw error
        }
      }
    } else if (contract.inputSource === "ctx") {
      throw inputError(`节点 ${node.id} 的 ctx 来源不能提供输入：${edge.source}`, "WF_INPUT_CONTEXT_MISSING")
    }
  }
  await Promise.all((contract.requiredFiles ?? []).map((path) => authorizedInputPath(absoluteInputPath(path, snapshot.workingDirectory), snapshot.workingDirectory, managedRoot, authorizedFiles)))
  const outputBaseline: Record<string, string | null> = {}
  for (const path of contract.outputFiles ?? []) {
    const absolute = absoluteInputPath(path, snapshot.workingDirectory)
    const canonical = await authorizedOutputPath(absolute, snapshot.workingDirectory)
    let directory = dirname(absolute)
    while (true) {
      try {
        const info = await stat(directory)
        if (!info.isDirectory()) throw inputError(`输出父路径不是目录：${directory}`, 'WF_OUTPUT_PATH_UNWRITABLE')
        await access(directory, constants.W_OK)
        break
      } catch (error) {
        if ((error as { code?: unknown }).code !== 'ENOENT' || dirname(directory) === directory) throw inputError(`输出路径不可写：${absolute}`, 'WF_OUTPUT_PATH_UNWRITABLE')
        directory = dirname(directory)
      }
    }
    outputBaseline[absolute] = (await outputSignature(canonical))?.signature ?? null
  }
  return outputBaseline
}

/** 完成事件的产物检查只认文件系统事实，不根据最终回复中的路径判成功。 */
export async function verifyNodeArtifacts(node: RoleNode, snapshot: RunSnapshot, now: number): Promise<void> {
  const artifacts: NonNullable<RunSnapshot['nodes'][number]['artifacts']> = []
  for (const path of executionOf(node).outputFiles ?? []) {
    const absolute = absoluteInputPath(path, snapshot.workingDirectory)
    let current: Awaited<ReturnType<typeof outputSignature>>
    try { current = await outputSignature(await authorizedOutputPath(absolute, snapshot.workingDirectory)) } catch (error) {
      throw Object.assign(new WfError(`声明产物无法验证：${absolute}`, error instanceof WfError ? error.code : "WF_OUTPUT_FILE_MISSING"), { phase: "run_finish", retryable: false })
    }
    if (!current) throw Object.assign(new WfError(`节点声称完成但声明产物不存在或不可读：${absolute}`, "WF_OUTPUT_FILE_MISSING"), { phase: "run_finish", retryable: false })
    const baseline = snapshot.nodes.find((entry) => entry.nodeId === node.id)?.attemptHistory?.at(-1)?.outputBaseline
    if (!baseline || !(absolute in baseline) || baseline[absolute] === current.signature) throw Object.assign(new WfError(`声明产物没有本次尝试的写入证据：${absolute}；已有文件不能替代本次执行，请重新生成`, "WF_OUTPUT_FILE_STALE"), { phase: "run_finish", retryable: false })
    const record = snapshot.nodes.find((entry) => entry.nodeId === node.id)
    artifacts.push({ path: absolute, size: current.size, verifiedAt: new Date(now).toISOString(), runId: record?.resumed ? record.artifacts?.find((entry) => entry.path === absolute)?.runId ?? snapshot.resumedFromRunId : snapshot.id, nodeId: node.id, attempt: record?.attempts, signature: current.signature })
  }
  if (artifacts.length) {
    const record = snapshot.nodes.find((entry) => entry.nodeId === node.id)
    if (record) record.artifacts = artifacts
  }
}
