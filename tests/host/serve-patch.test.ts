// tests/host/serve-patch.test.ts
//
// serve 层渲染单测：headless-runner 覆盖行/webserver 行/插件行/字段注入/
// apiKey null/端口注入/绝对 file URL 插件入口。

import { describe, expect, it } from 'vitest'
import {
  renderServePatch,
  SERVICE_PLUGIN_ROW_ID,
  SERVICE_WEBSERVER_ROW_ID,
} from '../../src/host/service/serve-patch.js'

const BASE = {
  serviceId: 'svc-1',
  dataDir: 'C:\\dsh-data\\visual-workflow',
  port: 7860,
  apiKey: null,
  maxConcurrent: 50,
  pluginEntryUrl: 'file:///C:/dsh-data/node_modules/dsh-visual-workflow/lib/service-runner.js',
}

describe('renderServePatch', () => {
  it('覆盖 headless-runner（one-shot 驱动器禁用）', () => {
    const text = renderServePatch(BASE)
    expect(text).toContain('- id: headless-runner')
    expect(text).toContain('  disabled: true')
  })

  it('insert webserver 行（127.0.0.1 + 分配端口）', () => {
    const text = renderServePatch(BASE)
    expect(text).toContain(`- id: ${SERVICE_WEBSERVER_ROW_ID}`)
    expect(text).toContain("name: '@deepseek-ai/dsh-host-webserver'")
    expect(text).toContain("host: '127.0.0.1'")
    expect(text).toContain('port: 7860')
  })

  it('insert 服务插件行（cmdlineArgs 注入 + 全部配置键）', () => {
    const text = renderServePatch(BASE)
    expect(text).toContain(`- id: ${SERVICE_PLUGIN_ROW_ID}`)
    expect(text).toContain('inject: [cmdlineArgs]')
    expect(text).toContain('serviceId: "svc-1"')
    expect(text).toContain('dataDir: "C:\\\\dsh-data\\\\visual-workflow"')
    expect(text).toContain('maxConcurrent: 50')
  })

  it('插件入口使用绝对 file URL（Loader 直接导入，不依赖 profile 安装）', () => {
    const text = renderServePatch(BASE)
    expect(text).toContain('name: "file:///C:/dsh-data/node_modules/dsh-visual-workflow/lib/service-runner.js"')
  })

  it('apiKey 非空时注入密钥；null 时渲染 null', () => {
    const withKey = renderServePatch({ ...BASE, apiKey: 'secret-123' })
    expect(withKey).toContain('apiKey: "secret-123"')
    const noKey = renderServePatch(BASE)
    expect(noKey).toContain('apiKey: null')
  })

  it('端口随分配值注入（webserver 与插件行一致）', () => {
    const text = renderServePatch({ ...BASE, port: 7891 })
    expect(text).toContain('port: 7891')
    expect(text.match(/port: 7891/g)?.length).toBe(2)
  })

  it('serviceId 中特殊字符按 JSON 转义（防 YAML 注入）', () => {
    const text = renderServePatch({ ...BASE, serviceId: 'svc"x' })
    expect(text).toContain('serviceId: "svc\\"x"')
  })
})
