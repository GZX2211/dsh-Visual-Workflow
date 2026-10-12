# 通用会话文件交付与显式运行输入

本文记录 #10–#12 的显式运行输入机制及后续 Harness 文件上下文适配。后续适配基于已合并 #12 的 main（12b64dc），以独立 PR 提交，不回退 #6–#12。

运行输入保存在 RunSnapshot，不写入 WorkflowDocument，不新增画布节点。Runtime 继承链仍为 `RuntimeBase → RuntimeLaunch → RuntimeExecute → RuntimeComm → RuntimeObserve → RuntimeLifecycle → OrchestratorRuntime`；NodeAgentRunner 的创建、复用、NOT_RESUMABLE 安全重建、权限与生命周期语义保持原样，仅扩展现有任务投递的内容块。

## Harness 会话文件上下文

普通 Agent 不再以 RuntimeInputs 或工作台绑定作为使用会话文件的前提。上传文件须已经由官方接纳为当前工作流实例所属会话的结构化 `file` 引用；父代理只见到自然语言路径、工具回复或另一会话上传的文件，都不构成授权。

每次合法 `wf_run_node` 派发先调用既有 `sessionInputFiles()`，取得当前会话授权的 attachmentId/name/bytes，复用既有附件解析及可读性校验。没有显式文件来源时，把所有可用引用交给子代理，由 Harness 根据节点任务选择并调用授权工具读取。多个附件不会被 Runtime 截成第一个，不按扩展名、节点名、职责或 Prompt 推断映射；无法确定时提示子代理请求一次必要确认。文件正文仍留在官方附件存储，不拷入 Prompt 或 snapshot。

明确的文件来源优先：已绑定的 attachment 仅交付选定引用；managed/上游文件、`requiredFiles` 或文件 ctx 保留原授权路径和合同，不夹带其他会话附件作为替代。显式必需输入仍须满足声明，缺失在 attempts/callCount 和 child 创建之前返回 `WF_INPUT_REQUIRED`。普通文本节点不增加文件合同；已经删除的可选附件记录诊断并略过，不使文本任务凭空失败。文件存在不等于授权，也不保证其在现场子代理 sandbox 中可读。

运行创建时，唯一授权附件可以填入每个尚未继承成功状态、仅声明一个必需 file 槽、且该槽没有有效绑定的 Agent。此快捷绑定不要求全图只有一个文件槽或唯一初始 Agent，但不会覆盖显式 ctx、requiredFiles、已有绑定或 auto 上游交接。仍通过 `inputSlotsOf()` 重新授权，实际写入既有 snapshot 并增加 inputRevision。多个候选附件或同一节点多个必需槽不自动猜测。

普通 Agent 使用文件上下文不创建 RuntimeInputs，也不增加 inputRevision。上传 B 不会修改正在执行的旧 attempt；再次调度仍返回 `WF_BUSY`。旧 attempt 合法结算后，原 retryLimit 内的新 attempt 可获得届时授权的 A/B 引用；合法恢复或新运行同样在自己的派发边界获取上下文。显式绑定则继续原 pending/attempts=0、版本与持久化约束，不热绑定、不清零次数、不自动恢复已派发节点。

在现有 `attemptHistory[].inputAttachments` 保存本轮准备交付的公开引用及 `source: session|binding`。已有 childId/phase 表示创建或投递是否被接纳；该字段本身不是“模型已经读取文件”的证据，失败派发也不能据此认定输入被消费。旧 child/epoch 不能覆盖新 attempt，已结算历史保持不变。

### 官方接口及数据流

已核实未修改的已发布 SDK 0.1.6-alpha.2 / 0.2.0-rc.2，使用的接口是公开能力，并非假设子代理继承父会话：

| 边界 | 接口与插件位置 | 职责 |
| --- | --- | --- |
| 会话 → Runtime | `CordisAgentHost.sessionInputFiles()`，`src/host/agent/agents-host.ts` | 仅接受当前 root Session 的 user/message、source.kind=user、结构化 file 引用；官方 `attachments.fileHostPath(ref)` 确认引用 |
| Runtime 预检 | `nodeInputAttachments()` / `runtimeInputsOf()`，`runtime-inputs.ts`；`wfRunNode()`，`runtime-execute.ts` | 精确匹配 id/name/bytes、复用授权路径和可读性检查、显式输入优先、尝试前校验 |
| Runtime → 子代理 | `NodeStartInput.attachments` → `NodeAgentRunner` 的 `taskContent()`，`runner.ts` | 初次 `subagents.startContinuable({request:{prompt}})`；合法复用 `subagents.sendMessage(parent, childId, content, ...)`；投递 `{type:"file",attachment:{attachmentId,name,bytes}}` |
| Harness → 模型/工具 | 官方 `dsh-llm` 的 `FileBlock`、`projectFilesToText()`、`fileReadPath()` | 保留 durable 文件引用，在模型请求阶段生成文件句柄；`attachments.fileHostPath(ref)` 经官方 `fs.processPathFromHostPath()` 映射到执行环境，工具访问仍受官方权限/sandbox 控制 |

`dsh-subagent` 的 `SubagentStartRequest.prompt` 和 sendMessage 内容均接受官方 `ContentBlock[]`。隔离的 spawn 不继承父上下文，因此由现有 Runner 明确投递授权引用。新会话上下文通道不拼接宿主路径；显式旧 RuntimeInputs 任务文本仍保留已有授权路径规则。插件不调用聊天 `send_message` 工具绕过 Runtime；上表中的 subagents.sendMessage 是原有受控复用通道。旧 queuePrompt 兼容路径同样保留内容块，NOT_RESUMABLE 重建提交最新内容且重新安装原权限，不扩大白名单。

### 删除、简化与保留

- 移除普通文件任务必须先绑定 RuntimeInputs 的交付前提。唯一初始节点/全图唯一文件槽只保留为客户端显式配置的快捷预选，不能限制普通节点的授权文件上下文；服务器快捷绑定也覆盖多个独立声明节点。
- 简化父代理输入、重试、结算和失败收尾说明，删除首段重复的推进/重试句子。保留首尾必要约束和 Runtime 的真实错误处理；Prompt 不负责确认授权、输入版本或执行成功。
- 保留工具 Preset 的 standingKeyFor/acquireScope 真实 Scope、tools.guard、用户禁用开关及 requiredTools。父代理编排工具对子代理隐藏是状态所有权隔离；fork 排除是父上下文隔离；run_code/Team 工具不列入全局 allow 是官方自身作用域装配要求，不禁用官方自身层的合法工具。未找到可无依据删除的 Guard/沙箱限制。
- 保留 DAG/条件语义、ctx/File Node/显式 RuntimeInputs/outputFiles、WF_BUSY、retryLimit、NOT_RESUMABLE、runId/attempt/childId/epoch、暂停停止恢复、当前写入和上游产物代际验证。auto 仍仅自动交接唯一无条件直接上游，不随机选择多来源；复杂图由原 ctx/合同和父代理决策处理。RuntimeObserve、DAG 核心、协作组、官方 DSH 和沙箱代码均未修改。

### 兼容性与尚存边界

没有声明文件合同的旧 Workflow 可以直接利用会话附件；没有文件或没有文件产物的普通文本/JSON任务照常运行。新的文件上下文及审计字段都是可选项，旧快照无需迁移。既有 explicit/auto 确定性交接仍使用原规则。

客户端未增加文件页面或输入状态层：普通无必需输入的运行不弹窗；高级工作台保留显式多槽配置、pending 绑定和新运行修复。freshStart 清空旧输入草稿，普通断点恢复保留合法历史输入，只有用户主动选择才复用旧输入；原生上下文取当前授权引用，不把它们当作旧输入绑定。

仍需高级输入选择的情况：显式命名必需槽存在多个候选/多个槽，或需要修改已经派发节点的绑定。前者可用已有工作台/API 明确选择，后者先停止旧运行，再用原新运行入口携带合法输入。未新增聊天热绑定工具。客户端的保守预选未扩展到多个声明目标，工作台可能仍显示这种显式配置；服务端调用运行入口已支持上面的无歧义多目标快捷绑定。

原生附件内容块目前经单角色 wf_run_node（含 proxy canonical 路径）交付。官方整组 Agent Team、父代理 hybrid 自执行的输入装配未新增这一通道，沿用宿主自身上下文及旧 ctx 机制；携带新 RuntimeInputs 的整组路径仍按原保护明确拒绝，而非静默丢弃。没有官方结构化引用或没有可解析存储路径的附件，不扫描目录猜测。现场官方 fs 映射/权限失败仍如实报告。既有插件路由身份认证部署边界未扩大或重构。

### 验证证据与现场验收

`pnpm check`：197 个测试文件、2434 项测试通过（较已合并 #12 增加 20 项），包含四个 TS Program、构建和 client-smoke。独立 `pnpm build` 通过，同步 17 个生成 lib 文件。5 个定向文件共 180 项通过；V8 定向覆盖统计中，本轮新增/修改且可计量的业务行 41/41 命中，不代表仓库整体覆盖率。

通用集成测试使用真实 Runtime、NodeAgentRunner、输入授权解析、权限/Prompt 装配、snapshot 和真实磁盘读写，由受控子代理传输提供结果：单附件两个读取节点、双附件双读取节点、上传后合法新 attempt、显式输入优先和失效引用均覆盖。通用图含文本、文件读取、多来源 ctx、条件分支与报告文件，实际派发/成功 6 个 Agent，每个 attempts=1，未选分支 skipped/attempts=0；测试验证实际报告内容和当前产物代际。工具实际执行另由官方 SDK Scope smoke 验证。这些测试不证明模型自主映射、确认次数或业务正确性。

官方 SDK smoke 在上述两个版本均通过：每版 6 次 Preset 读取、15 次真实作用域工具执行（含拒绝）、2 个公开恢复钩子、2 次模型路由更新，以及官方 LocalAttachmentStore 真实保存/流式读取/路径读取一个 24 字节文件、官方 file 块投影且 durable 引用不变。没有模型调用，没有修改 SDK 源码。

真实 DSH 模型 E2E：**NOT RUN**。用户内部 Docker 模型部署不在云环境可达范围；真实节点启动/成功/attempts、耗时、父子 Token 和性能改善：**NOT AVAILABLE**。定向测试套件耗时 3.54 秒（180 项），全量测试阶段 38.08 秒（2434 项），均不是模型 E2E 耗时。

现场通用验收：在工作流实例绑定的 DSH 会话中上传 `instructions.txt`（如“结果按整数四舍五入”）与 `data.json`（如 `{"value":21.4}`），建立文本计划、两个读取 Agent、汇总 Agent、检查/另一条条件分支、最终报告 Agent。普通读取节点不声明 execution.inputs；汇总/报告使用原多来源 ctx，报告按需声明 outputFiles。选择现场已授权的 Preset 和准确 provider/model，按各节点职责读取两个官方附件，再运行；如无法区分附件只确认一次。核查报告真实生成、每个节点 attempts、有效结算/最终 wf_finish，以及独立父子 Token。再验证显式合同案例和运行中上传不触发旧 attempt 重派发。

已有销售确定性验收命令仍保留，不能代替上述通用场景：

```bash
DSH_BASE_URL="$YOUR_DSH_BASE_URL" DSH_TEST_PROVIDER="$YOUR_DSH_PROVIDER" DSH_TEST_MODEL="$YOUR_DSH_MODEL" node scripts/run-sales-live.mjs
```

不预设 provider 标识、服务地址或凭据。官方接口 smoke 可通过 `DSH_RUNTIME_PACKAGE=/现场安装的/@deepseek-ai/dsh/package.json node scripts/dsh-scope-smoke.mjs` 独立执行，它也不是模型 E2E。

## 显式输入使用方式（#10–#12）

普通“运行”在没有缺失的必需运行输入时直接启动，不弹输入窗。需要补齐声明输入时打开弹窗；也可主动点击“配置输入后运行”，填写文本、JSON、选择当前会话的官方附件或受控上传文件，并选择 auto/explicit。取消弹窗不会发起运行，切换文档或卸载后旧请求不回写。恢复沿用已有合法输入及策略。为每项指定输入名称和目标：工作流或一个 Agent。文件上传只更新输入草稿，点击运行/绑定才交付；附件上传不等于文件绑定。

工作流级输入仅交付拥有真实 flow 入线、且入线全部来自无条件 Start 的唯一初始 Agent，节点级同名输入优先。孤立或仅接 ctx 的 Agent 不作为初始目标，proxy 按原 canonical ID 解析。多个初始 Agent、条件入口或无法明确目标时，应直接选择节点，服务端返回 `WF_INPUT_AMBIGUOUS`，不会选择一个候选。多个附件也不自动选择。没有声明必需输入的旧工作流允许空输入运行。

可在 Agent 的已有 execution 契约中声明简单输入要求，例如：

```json
{"execution":{"inputs":{"source":{"kind":"file","required":true}},"outputFiles":["output/result.json"]}}
```

输入类型仅支持 text/json/file；required 缺省为 true。初始节点及用户显式绑定节点的声明在唤醒父代理前检查；下游由上游生成的数据在下游首次派发前检查。支持 JSON 值的形状检查，不校验业务 JSON Schema。

运行中用“绑定节点输入”按钮补充尚未派发、attempt 为 0 的 pending Agent。主节点和 proxy 共用同一目标和版本。已开始过的节点不可重绑定；失败节点沿用已有 retryLimit 与重建机制。绑定失败保持原版本，版本冲突刷新版本并保留草稿等待用户重新确认。

## API 与持久化

### #12：会话附件选择与新运行修复

工作台继续从 sessionInputFiles 获取当前会话官方已接纳的附件，只展示 attachmentId/name/bytes。用户选择附件并加入目标输入后，以既有 source="attachment" 的 RuntimeInputs 提交；真实路径由 runtimeInputsOf 在宿主端重新授权解析，不需要复制容器路径，不信任调用方给出的附件 path/origin，也不搜索目录。

运行状态、运行历史、绑定返回值和 options.checkpoint 的 RuntimeInputs 也剔除附件 fileRef.path；投影不修改磁盘快照，重新提交公开引用仍由宿主解析真实路径。该裁剪仅针对附件运行输入引用，不宣称清除 managed 引用、旧 fileBindings、产物或自由文本中的所有宿主路径，也不修复下文已有路由认证限制。

runtimeInputOptions 额外返回可选 initialNodeId，使用原 workflowInputTarget 查询。新运行前，只有目标唯一、全图只有一个必需 file 输入槽、且只有一个授权附件时，工作台才预选到该槽；不会覆盖已有明确绑定。多个附件、多个文件目标/槽、条件/组/无初始目标、仅可选或未知输入类型都要求用户选择。规则只依赖图和 execution.inputs，不读节点名、职责、Prompt 或 CSV 扩展名。运行中的附件上传不触发自动选择或绑定，普通断点恢复也不新选附件。

默认销售 auto 样例的 load_data 已声明 `execution.inputs.source.kind="file"`；不能靠“请读取 CSV”之类 Prompt 替代声明。普通无必需输入的 Agent 不检查 CSV。首次必需输入缺失在 prepareRuntimeInputs/派发预检处返回 WF_INPUT_REQUIRED，发生在 attempts/callCount 计账及 child 创建之前；这些原有检查未重复实现。

尚未派发的 pending/attempts=0 节点继续通过“补充运行输入”保存绑定。成功后 snapshot 持久化且 inputRevision 增加；单纯上传或发送“已上传”不会改变版本。WF_BUSY、WF_INPUT_STATE_CONFLICT、WF_INPUT_REVISION_CONFLICT 保留稳定错误，失败不会自动循环调用。版本冲突仍刷新并保留草稿，请用户检查后提交。

已开始、已失败或已终止的运行不允许热绑定，也不清零旧 attempts。工作台显示不可绑定节点和修复说明：取消输入窗口，使用原停止按钮停止仍活跃的运行，再点击“配置输入并新建运行”，选择或检查附件绑定后启动同一工作流。新运行入口给原 run API 传可选 `freshStart:true`，调用已有 startRun，而非自动恢复旧快照；活跃运行仍受原锁保护，不能被该标志覆盖。普通“运行”仍自动续跑可恢复断点，历史“恢复”仍走原 runResume，缺省请求语义不变。

“配置输入并新建运行”默认从空 RuntimeInputs 草稿开始，旧 checkpoint 的附件、文本和 JSON 不会静默带入；唯一附件预选规则仍适用。若旧运行绑定 A、当前授权附件只有 B，新运行预选 B；若 A/B 均可选，必须手动选择。用户只有主动点击“复用上次运行输入（替换当前草稿）”才复制旧输入，提交时仍重新授权。普通运行的断点续跑及历史“恢复”继续保留原输入，不自动换成新上传附件。

新运行不继承旧成功/失败状态或产物证据，历史成功结果不会因“新运行”变成当前结果。本轮支持工作台绑定和新运行修复，**不支持在聊天中上传附件后自动恢复已派发节点**。父代理提示只补充 Runtime 绑定返回/inputRevision 与错误的区别，#11 的重试/失败收尾约束保持原样，没有新的 Token 预算或热恢复状态机。

本轮确定性五节点测试使用真实 Runtime、NodeAgentRunner、权限/Prompt 装配、持久化、附件授权解析及文件读写，覆盖 explicit、受管 auto 与会话附件 auto；模型传输提供可控结果。各业务节点有效 attempts 为 1，中间文件真实生成。这不能证明真实模型正确。现场 DSH 模型 E2E：**NOT RUN**；本轮真实 Token、耗时及现场节点 attempts：**NOT AVAILABLE**，不把测试耗时当作模型运行耗时，不报告性能改善比例。

#12 最终验证（含 freshStart 边界补充）：`pnpm check` 通过，197 个测试文件、2414 项测试（较已合并 #11 的 main 新增 41 项，较 #12 首轮增加 5 项），包含四个 TS Program、构建和 client-smoke；独立 `pnpm build` 通过。7 个定向文件共 163 项测试通过。定向统计的输入 Hook、输入窗口和 runtime-inputs 三个文件合计行覆盖率 97.29%、分支 86.18%，不代表仓库整体覆盖率。同步 17 个生成 lib 文件（6 个 JS、11 个声明；其中本轮更新 4 个客户端产物），无新增生产模块、依赖或版本调整。

现场验收可用已有脚本生成五节点流程，再在新会话聊天中上传 CSV，打开工作台检查 load_data/source 所选附件，并将交接策略选为“自动（确定的直接依赖）”后运行。prepare-only 不启动运行，也不替工作台选择运行策略：

```bash
# 使用现场 DSH_BASE_URL；模型运行还需准确的 DSH_TEST_PROVIDER/DSH_TEST_MODEL。
node scripts/run-sales-live.mjs --prepare-only
```

若附件没有官方公开结构化授权引用（例如工具回复仅包含自然语言路径），仍不会自动绑定。请通过现有工作台受控上传或官方会话附件选择；不扫描附件目录、不绕过 sandbox。现场保留完整快照、真实 wf_finish 返回和父/子独立 Token 记录。原脚本的 A/B/C 模型验收及 live-metrics.json 继续可用。

`run`、`runResume` 的原有参数均保留，增加可选 `runtimeInputs`、`handoffPolicy`。不传策略缺省为 explicit；恢复运行保留之前的输入和策略，新传 runtimeInputs 完整替换输入集合。

```json
{
  "sessionId":"当前会话",
  "flowId":"实例ID",
  "handoffPolicy":"auto",
  "runtimeInputs":{
    "workflowInputs":{"topic":[{"kind":"text","value":"用户提供的主题"}]},
    "nodeInputs":{"first":{"payload":[{"kind":"json","value":{"count":2}}]}}
  }
}
```

文件输入为 `{kind:"file",fileRef:{source:"managed",path:"fileUpload 返回的 managedPath"}}`，或 source 为 attachment 的官方 attachmentId/name/bytes 引用。服务端忽略调用方伪造的附件 path/origin，以当前会话 user/message 中被官方附件服务接纳的结构化引用解析路径。路径越界、软链接逃逸、跨会话官方附件、任意宿主绝对路径均不能构成授权。不扫描附件目录；新的 RuntimeInputs 不接收 workspace 任意路径。

运行输入的 fileUpload 增加可选 sessionId，服务端在原有受管目录中分配保留的会话文件名前缀；解析时比对目标会话命名空间及规范化路径，拒绝其他命名空间的受管引用或通过无会话上传伪造该命名空间。旧 File Node 不带 sessionId 的上传仍按原名字工作。用户必须明确提供上传返回的受管引用，不能通过 Prompt 猜路径。上传使用唯一文件名，避免覆盖另一个输入。文件内容留在磁盘，不进入快照或任务块；文本/JSON 总输入限制为 256 KiB，JSON 深度、槽数量及单槽数量有界。

`runtimeInputOptions({sessionId,flowId})` 返回节点输入声明、当前会话可验证附件和最近可恢复输入。新增的 files 选项只包含 attachmentId/name/bytes，不返回宿主 path；客户端按这三个字段提交，服务端重新解析真实路径。

`runInputBind({sessionId,runId,nodeId,expectedRevision,inputs})` 只替换指定 pending 节点的输入槽。绑定与派发互斥，持久化成功后发布新版本；停止/恢复后的旧绑定不得发布。其他 child 在授权期间结算的状态保留。原有运行锁、暂停、恢复、终态收尾机制不变。

## 宿主认证与部署限制

本轮只裁剪新增选项的 files 字段，没有完成所有快照接口的路径隔离：options.checkpoint.runtimeInputs、runStatus/runHistory、绑定返回快照及旧 fileBindings/artifacts 仍可能含规范化宿主路径。runStatus/runHistory 等按请求 sessionId 与记录匹配；这是资源归属检查，不能证明调用者身份。activeRuns 缺省支持全会话列表，符合原工作台全局模式。

核查了已安装 DSH 0.1.6-alpha.2 的公开 dsh-host-webserver WebRoute/实现和 dsh-client-connection HostConnectionHandle：webServer.register 的 handler 仅接收原始 IncomingMessage/ServerResponse，并直接分发命名路由；connection.requestRejection 为官方 /api 通道提供 Host/Origin 和进程 token/browser cookie 认证，没有公开调用者→工作流 sessionId 的归属证明。插件现有 /visual-workflow 前缀直接注册在 webServer，不经过 /api，不能假定自动继承其认证。

fileUpload 的 sessionId 及 runtimeManagedPrefix 哈希只用于命名空间分隔，**不是会话授权**。可达该端点的调用者仍可提交别人的 sessionId 来选择其命名空间；本 PR 没有解决此边界，也不声称多租户会话隔离。合法命名空间上传、跨命名空间引用拒绝、无会话保留前缀防伪及旧模板上传测试都不等同于调用者身份验证。

部署安全前置条件：只向可信操作人员开放整个 /visual-workflow 路由，由现场已有访问控制保护；仅设置 DSH 登录 token 不能据此认定该插件前缀受保护。需要不可信多用户访问时，应先单独完成宿主可信身份/会话归属方案。当前云环境无法验证现场反向代理或网络访问控制，不在 #10 中引入自制登录、Session Manager、全局权限框架，也不扩大文件访问范围。

## 首次交付与预算

`wf_run_node` 在 #8 原有互斥锁内先解析当前节点输入，验证授权及可读性，核对必需输入和已有 execution 约束，生成完整首条用户任务块，然后记账并调用原 NodeAgentRunner。

预检失败返回稳定错误且不创建 child、不增加 callCount/attempts。节点保持 pending，可补齐输入后重试。旧行为中缺 ctx/文件会记一次失败尝试；本补丁按要求改为预算不消耗。真正的启动或执行失败仍按原有逻辑结算。

#8 的执行中 WF_BUSY、NOT_RESUMABLE 只重建一次，以及 runId/attempt/childId/宿主 epoch 代际隔离均保留。自动交接还检查预检期间上游是否重新开始，防止首次任务带入旧尝试数据。

## 自动交接边界

explicit 是缺省模式，保留原有 ctx。auto 只处理唯一、无条件、直接上游 Agent 已合法结算的简单串行依赖，不改变画布连线。显式 ctx 总是优先；明确节点输入整体覆盖自动来源。声明 inputSource="ctx" 的节点在 explicit/auto 下都必须连接原有显式 ctx，即使已有运行输入也不能替代该契约；缺线返回 WF_INPUT_CONTEXT_MISSING 并提示连接 ctx。希望无 ctx 自动交接时，用户应明确选用 inputSource="runtime" 等适合运行输入的契约并启用 auto，运行时不改写节点定义。原有 File Node、runtime/workspace 规则不变。

下游首条任务带入 `upstreamText` 和/或 `upstreamFiles`，附 nodeId、来源 runId、attempt。文本按当前合法结算记录交付，JSON 格式的最终文本仍按文本交付；业务消费者自行解析，不新增结果体系。文件仅使用 execution.outputFiles 声明且经 #8 现有存在性、本次写入签名验证的产物，并核对结算后的签名与 attempt，不能使用前一尝试或事后替换的文件。

多上游、条件依赖、循环、协作组交接不自动选择，返回歧义；改为显式 ctx 或明确绑定。proxy 沿用现有主节点映射。未结算、失败、旧 epoch/退役 child 的输出不可作为成功输入。断点恢复只继承原机制认可的成功记录及来源，不读其他运行历史。

新的 RuntimeInputs 经单角色 wf_run_node 交付。已有整组 Agent Team 与 ctx 路径不变；携带新运行输入/新输入声明的整组启动会明确拒绝并提示逐个启动成员，避免静默丢失输入。此次不扩展团队的数据交接算法。

没有 outputFiles 的节点继续采用原文本结算。正常回合结束表示运行时接受该回合，不证明业务结论正确。只对声明文件的存在性/本次写入作机器核验；无机器证据的业务结论不能被标成“机器验证通过”。

输入绑定不会扩大工具白名单或 sandbox。子代理仍须使用已授权 read/write 等工具；若现场沙箱拒绝访问或 Docker sandbox 不可用，这是现场环境故障，保留真实失败，本 PR 不负责绕过检查。ask_user_question 上传若没有公开结构化授权引用，不支持自动拾取，使用工作台受控上传。

## 验证

新增输入解析/授权、简单交接和工作台 Hook 的针对性测试，并扩展真实 RuntimeExecute + NodeAgentRunner + 持久化集成测试；仅宿主传输服务使用 Fake。覆盖首次 text/json/file、无 File Node、必需输入、附件精确匹配/多候选、路径与软链接、显式优先、唯一上游、文件签名、失败和旧尝试、proxy、绑定互斥/版本冲突/持久化失败/停止/恢复。

全仓库 pnpm check 覆盖新旧 Preset、权限隔离、NOT_RESUMABLE、WF_BUSY、暂停/恢复/停止/收尾、原有协作组/proxy/条件显式模式与文件证据测试。pnpm build 同步 lib、声明与 client.js。实际执行数量与结果记录在 PR 描述中。

真实 Docker/模型 E2E：**NOT RUN**。云环境没有现场 DSH 模型服务；Fake 或官方 Scope smoke 均不能代替现场 E2E。

## 现场 Docker 验收

使用含本补丁 lib 的插件，重启 DSH，确认公开 Preset standard 能解析。DSH 0.1.6-alpha.2 与新版 acquireScope 宿主适配保持兼容。只用现场真实 provider 标识，不假设其为 ollama/openai；内部模型地址和凭据由现有 DSH 配置提供。

在容器内或共享其文件系统的机器执行，环境变量取现场真实值：

```bash
export DSH_BASE_URL='现场 DSH Web 地址'
export DSH_TEST_PROVIDER='现场准确 provider 标识'
export DSH_TEST_MODEL='qwen3:30b-instruct'
# 如果需要已有 Web 认证，指定本地日志路径；脚本只读取登录信息，不打印凭据。
export DSH_WEB_LOG='现场 DSH Web 日志路径'

node scripts/run-sales-live.mjs --text
node scripts/run-sales-live.mjs --json
SALES_CSV='/容器可见/sales_workflow_test.csv' node scripts/run-sales-live.mjs
```

A：三个 Agent 的文本链，无 ctx，无 File Node。首节点接收 hello workflow 并转大写，下游加 NOTE:，最后保留 NOTE: HELLO WORKFLOW。

B：两个 Agent 的 JSON 链，无 CSV/文件节点。首节点接收并输出 `{value:21}`，第二节点消费自动交接文本并输出 `{doubled:42}`，脚本解析最终 JSON 检查结果。

C：原五节点销售链，只有 start → load_data → quality_check → sales_stats → summary_gen → report_gen → end 的 flow。auto、无 File Node、无 ctx，脚本以工作台同一 fileUpload API 明确上传并绑定 CSV。逐节点验证真实 child/路由/有效结算、raw/quality/stats 文件与最终报告；统计应为原始 11、重复 1、缺失 2、有效 9、总额 15900、平均 1766.67、最大 S001/6000、最小 S010/200。

也可以添加 --prepare-only，只创建会话/图，不启动模型。随后激活对应会话根 Agent，在工作台为首节点 source 上传/填写相应输入，选择 auto 后运行；C 必须亲自上传并明确绑定 CSV。空白宿主上需先按现场设置激活根 Agent。--explicit 可回归原销售 File Node+ctx 方案。

现场检查父代理会话：使用 wf_run_node 调度与有效结算推进，不调用原生 send_message 补输入、不改图存临时数据、不替子代理重建输入文件。禁止反复改 Prompt 让验收勉强通过。脚本只验证当前生成的 live-run.json；超时停止它自己创建的测试运行。Fake HTTP 脚本测试仅验证参数与验收断言。

## 修改职责

详细文件清单随 PR 提供，手写 src、测试/脚本/文档、生成 lib 分开统计。

- runtime-inputs.ts：轻量解析、授权、输入类型/必需项校验。
- input-handoff.ts：唯一初始目标和简单直接上游，复用原文件证据。
- runtime-launch.ts：已有入口校验/落盘、查询和 pending 绑定；runtime-execute.ts：预检先于计账、首条任务交付。
- execution-inputs.ts：返回输出基线，少量产物来源信息；snapshot.ts：尝试来源 runId。没有新增状态。
- run-entry.ts/resume.ts/shared：可选请求/快照/输入类型与端点契约。
- agents-host.ts/visual-workflow-host.ts：只暴露现有官方附件结构化事实，无目录扫描。
- runs.ts/routes.ts：薄端点与错误状态映射。
- execution-contract.ts：仅增加 kind/required 输入声明形状，不做 JSON Schema。
- task-blocks.ts/prompts：将合法输入写入原任务块、通用父代理约定。
- 工作台 dialog/hook、运行控制/恢复/Studio、词典和统一样式：用户输入草稿、受控上传、目标与策略、生命周期保护。
- managed-files.ts/templates.ts：现有受管上传的可选会话命名范围，拒绝跨会话运行引用，保留旧文件模板入口。
- run-sales-live.mjs：三类现场验收，保留原显式销售模式和可配置服务/路由。

## 首轮交付记录（基线 1a3054d）

- pnpm check：通过，197 个测试文件、2313 项测试，包含四个 TypeScript Program、构建和 client-smoke。
- pnpm build：单独执行通过，48 个变化的 lib 生成文件同步，其中 JS 22、.d.ts 26（调试 .map 按仓库规则忽略）。
- 新增 58 个测试用例；7 个定向测试文件共 85 项通过（含原有回归）。新增输入解析/交接/输入 Hook 的定向行覆盖率 99.03%、分支 83.89%，不代表全部仓库代码的覆盖率。
- 官方 Scope smoke：0.1.6-alpha.2 的 standingKeyFor 和 0.2.0-rc.2 的 acquireScope 均通过，各 6 次真实 Preset 读取、15 次真实 Scope 工具执行、2 次公开恢复 Hook 和 2 次模型路由更新；模型 E2E 为 NOT RUN。
- Docker A/B/C：NOT RUN。现场模型不可从云环境访问，不将 Fake 结果当现场通过。

手写 src 共 30 个文件（5 个新增、25 个修改）；其余为 11 个测试/fixture 文件、1 个现场脚本、2 个文档。源文件改动以调用既有入口和新增可选字段为主，新增业务模块仅为输入解析、简单交接、共享纯类型、输入 UI/Hook，没有新增 Runtime 子类。

完整手写 src 清单：

- `src/client/components/runtime-inputs-dialog.tsx`
- `src/client/hooks/use-runtime-inputs.ts`
- `src/client/hooks/useRunActions.ts`
- `src/client/hooks/useRunControl.ts`
- `src/client/i18n.ts`
- `src/client/studio/Studio.tsx`
- `src/client/styles/overlays.ts`
- `src/host/agent/agents-host.ts`
- `src/host/api/routes.ts`
- `src/host/api/runs.ts`
- `src/host/api/templates.ts`
- `src/host/graph/execution-contract.ts`
- `src/host/orchestrator/execution-inputs.ts`
- `src/host/orchestrator/input-handoff.ts`
- `src/host/orchestrator/resume.ts`
- `src/host/orchestrator/run-entry.ts`
- `src/host/orchestrator/runtime-base.ts`
- `src/host/orchestrator/runtime-execute.ts`
- `src/host/orchestrator/runtime-inputs.ts`
- `src/host/orchestrator/runtime-launch.ts`
- `src/host/orchestrator/snapshot.ts`
- `src/host/orchestrator/task-blocks.ts`
- `src/host/prompts/node-task.ts`
- `src/host/prompts/orchestration.ts`
- `src/host/shared/graph-model.ts`
- `src/host/shared/protocol.ts`
- `src/host/shared/run-types.ts`
- `src/host/shared/runtime-types.ts`
- `src/host/storage/managed-files.ts`
- `src/host/visual-workflow-host.ts`

测试/fixture 清单：

- `tests/client/hooks/use-runtime-inputs.test.tsx`
- `tests/client/studio/Studio.test.tsx`
- `tests/host/api/runs.test.ts`
- `tests/host/orchestrator/execution-inputs.test.ts`
- `tests/host/orchestrator/fixtures/harness.ts`
- `tests/host/orchestrator/input-handoff.test.ts`
- `tests/host/orchestrator/runtime-inputs.test.ts`
- `tests/host/orchestrator/runtime-launch.test.ts`
- `tests/host/storage/managed-files.test.ts`
- `tests/integration/node-recovery.test.ts`
- `tests/integration/run-sales-live.test.ts`

## 最后一轮兼容修订

插件版本更新为 0.11.0，无新增依赖。package.json 是唯一包版本来源；pnpm-lock.yaml 不含根包版本，cordis.patch.yml/serve.patch.yml 无独立版本字段，构建和打包沿用原脚本。#8 的 0.10.1 tarball 记录保留为历史验收，不作为当前安装版本；本轮包应为 dsh-visual-workflow-0.11.0.tgz。

本轮只修初始目标边界、附件选项投影、旧工作流直接运行/主动配置分流、ctx 诊断，并记录上传认证限制。没有新增源码文件或 Runtime 子类，没有修改 NodeAgentRunner、RuntimeObserve 或原有状态机；默认仍为 explicit，不自动升级旧工作流为 auto。完整本轮逐文件增删与最终测试数量见 PR #10 描述。A/B/C 现场脚本及 #8 恢复说明继续保留，真实 Docker/模型 E2E 为 **NOT RUN**。

本轮最终 `pnpm check` 通过：197 个测试文件、2334 项测试（比基线新增 21 项），含四个 TS Program、构建与 client-smoke。旧/新官方 Scope smoke 分别通过 standingKeyFor/acquireScope；这些检查不涉及真实模型。单独 `pnpm build` 和包版本/生成 lib 核对结果同步记录在 PR #10。

独立 `pnpm build` 通过，13 个本轮生成 lib 文件同步（6 个 JS、7 个声明）。npm pack 生成 dsh-visual-workflow-0.11.0.tgz（17,469,626 字节）；包版本及全部 13 个修改 lib 的内容与工作区逐字节比对通过。
