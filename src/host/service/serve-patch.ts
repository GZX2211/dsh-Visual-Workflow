// src/host/service/serve-patch.ts
//
// 模式二服务进程的 serve 层渲染：<dataDir>/services/<serviceId>.serve.patch.yml。
//
// 产物形态（组合覆盖语义）：
//   - 覆盖行：headless-runner disabled——headless bundle 的 one-shot 驱动器
//     不参与服务进程（常驻服务由本层接管）；
//   - insert 行：webServer（host/port）+ visual-workflow-service 插件行。
//
// 插件行 name 使用绝对 file URL（service-runner.js 的 import.meta.url）而非包名：
// Loader 对绝对路径 specifier 直接 internal.import，不依赖 headless profile 的
// node_modules 安装过本插件（用户插件只安装在 web/scratch 等 profile）。
//
// 渲染为静态 YAML（JSON 标量是 YAML 子集，直接内嵌），无第三方 yaml 依赖；
// apiKey 为空时渲染 null（服务内不启用鉴权）。

/** 服务进程内挂载的 webServer 行 id。 */
export const SERVICE_WEBSERVER_ROW_ID = 'visual-workflow-webserver'
/** 服务进程入口插件行 id（serve.patch.yml 与插件 Config 校验用）。 */
export const SERVICE_PLUGIN_ROW_ID = 'visual-workflow-service'

export interface ServePatchInput {
  /** 服务稳定标识（已消毒）。 */
  serviceId: string
  /** 数据根目录（服务进程内 FlowStore 落盘位置）。 */
  dataDir: string
  /** 分配的监听端口。 */
  port: number
  /** 鉴权密钥（null 关闭）。 */
  apiKey: string | null
  /** 单服务并发请求上限。 */
  maxConcurrent: number
  /** 服务进程入口插件模块的绝对 file URL（Loader 直接导入）。 */
  pluginEntryUrl: string
}

/**
 * 渲染 serve.patch.yml 文本（纯函数；输出字节稳定）。
 * webserver 固定绑定 127.0.0.1（默认安全姿态；对外暴露属部署决策）。
 */
export function renderServePatch(input: ServePatchInput): string {
  const lines = [
    '# 模式二服务进程 serve 层（由服务管理器渲染；请勿手改）',
    '- id: headless-runner',
    '  disabled: true',
    '- insert:',
    `    - id: ${SERVICE_WEBSERVER_ROW_ID}`,
    "      name: '@deepseek-ai/dsh-host-webserver'",
    '      config:',
    "        host: '127.0.0.1'",
    `        port: ${input.port}`,
    `    - id: ${SERVICE_PLUGIN_ROW_ID}`,
    `      name: ${JSON.stringify(input.pluginEntryUrl)}`,
    '      inject: [cmdlineArgs]',
    '      config:',
    `        serviceId: ${JSON.stringify(input.serviceId)}`,
    `        dataDir: ${JSON.stringify(input.dataDir)}`,
    `        port: ${input.port}`,
    `        apiKey: ${JSON.stringify(input.apiKey)}`,
    `        maxConcurrent: ${input.maxConcurrent}`,
    '',
  ]
  return lines.join('\n')
}
