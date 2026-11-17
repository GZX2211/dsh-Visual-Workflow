# Dify 工作流导入

1.3.0 支持从工作台顶部「导入」按钮选择 Dify 导出的 `.yml` / `.yaml` 文件。导入先创建全局工作流模板；用户从模板创建实例、核对模型并填写运行输入后，可以直接运行兼容子集。格式识别同时使用文件扩展名和解析后的 `workflow.graph`，不依赖 YAML 的具体排版。

## 页面迁移 Dify 工具包

安装 `dsh-dify-migrator` 0.3.0 并确保 `dsh-dify-migrator` 位于 Host 的 `PATH` 后，点击工作台顶部“迁移 Dify 工具”：

- 可一次多选多个 `.difypkg`；
- 可上传一个包含多个 `.difypkg` 的 `.zip`；
- Host 在后台以固定参数完成扫描、转换和安装，不执行用户提供的命令；
- 完成后自动刷新统一 DSH 工具目录，无需逐节点重新绑定；
- 非 Tool 能力、重复包和失败包保留在迁移汇总中，不会伪装成安装成功。

默认命令可通过 Host 配置 `difyMigratorCommand` 改为迁移器的绝对路径。单个页面上传文件限制为 40MB；需要迁移更大的可信包时，仍可使用迁移器 CLI 直接安装到同一 `dataDir`。

## 使用步骤

1. 批量导出需要的 Dify Tool `.difypkg`，在工作台点击“迁移 Dify 工具”，多选包或上传批量 ZIP；也可以使用 `dsh-dify-migrator convert ... --install <DSH-data-dir>` 从命令行安装。
2. 导入 Dify YAML，打开新生成的工作流模板并查看兼容状态。Tool 节点会按 `author/plugin/tool` 自动绑定到迁移后的 DSH 工具，不需要逐节点选择。
3. 对 `review-required` 模板核对或重新选择每个 LLM/Agent 的 provider 与 model。
4. 从模板创建工作流实例；导入来源和兼容报告会随实例保留。
5. 点击“配置并运行”，填写由 Dify Start 变量转换出的工作流输入；同一个变量只需填写一次，会自动分发给所有引用节点和工具参数。
6. Runtime 以确定性 DAG 顺序执行节点；运行完成后，历史摘要按导入的 Answer/End 输出绑定返回结果。

`blocked` 模板可以查看和编辑，但运行前会由 Host 护栏拒绝，不会把占位 Agent 当作已适配能力执行。

## 转换边界

- `start`、`answer/end` 转换为原生启动和结束节点。
- `llm`、`agent` 转换为 Harness Agent 节点，保留模型身份、Prompt 和职责信息；Start 引用转换为运行输入，上游 Agent 引用转换为显式上下文依赖。
- 单一引用 `answer` 与由命名 `node.port` 选择器组成的 `end` 会保存为原生受控输出绑定；不执行任意表达式。
- `tool` 转换为原生 DSH `ToolNode`。工具参数中的 `{{#node.port#}}` 由 Runtime 受控解析，实际执行走统一 DSH 工具注册表；Dify worker 只存在于迁移包内部，不建立第二套用户可见插件目录。
- 知识检索、HTTP、代码、模板转换、条件、循环、迭代和未知节点仍会保留为可见占位，兼容状态为 `blocked`，不能直接运行。
- Dify Flow 连线转换为原生 Flow 连线；固定图使用 `executionMode: dag`，不再由父模型临场猜测执行顺序。

转换器不会声称两种平台的节点具有天然等价语义。v1.3 的可运行范围为 Start、LLM/Agent、已安装的 Dify Tool 迁移包，以及受控 Answer/End 输出绑定；其余能力等待后续适配器实现。

## 安全规则

- API Key、Authorization、Cookie、密码、Token 和 Dify credential 引用在解析阶段移除。
- 兼容报告只保存依赖身份，不保存密钥。
- 外部模型、知识库和 HTTP 目标不会自动启用。工具凭据不会从 Dify 复制，按迁移包 id 写入 Host 私有的 `<dataDir>/migrated-tool-credentials.json` 后重载；该文件不得提交到仓库。

## 工具身份与安装目录

- Dify 包 `author/plugin` 转换为 DSH 包 `dsh_dify__author__plugin`。
- Dify 工具 `tool` 转换为 DSH 工具 `dsh_migrated__author__plugin__tool`。
- 安装目录为 `<dataDir>/migrated-tools/<package-id>@<version>`。
- DSL 导入与包转换使用同一规范化算法，因此安装包存在时自动绑定；不存在时运行前返回 `WF_TOOL_NOT_INSTALLED`，不会悄悄改用占位实现。

## 兼容状态

| 状态 | 含义 | 后续动作 |
|---|---|---|
| `ready` | 未发现结构或适配问题 | 打开模板复核后创建实例 |
| `review-required` | 存在非阻断兼容问题 | 核对/重绑模型并核对节点 Prompt、输入 |
| `blocked` | 存在不支持节点或图错误 | 完成适配或修改拓扑后再运行 |

模板的 `sourceImport` 字段保存来源版本、问题清单和依赖清单，后续可用于旧工作流优化与差异评估。
