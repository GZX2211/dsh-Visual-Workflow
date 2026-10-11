# 轻量运行输入与串行数据交接

本补丁从包含 PR #6、#7、#8 的 main（e9436f8）独立实现。PR #9（57ebfdd）仅作为参考，保持未合并。

运行输入保存在 RunSnapshot，不写入 WorkflowDocument，不新增画布节点。Runtime 继承链仍为 `RuntimeBase → RuntimeLaunch → RuntimeExecute → RuntimeComm → RuntimeObserve → RuntimeLifecycle → OrchestratorRuntime`；NodeAgentRunner 的创建、复用、NOT_RESUMABLE 安全重建、权限与生命周期实现保持原样。

## 使用方式

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
