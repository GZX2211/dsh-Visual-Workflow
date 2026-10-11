// src/host/api/runtime.ts
//
// GUI API 运行期配置下发端点组（RuntimeEndpoints）：把 host 插件配置里影响
// 前端节奏的取值经网络边界下发（前端不得自读 host 的 config 对象）。
// 只做透传——配置值到前端语义的映射与缺省回退归消费方，边界不决定降级语义。

import { httpError } from './http.js'
import { presentationOf, VisualWorkflowApiBase } from './boundary.js'

export class RuntimeEndpoints extends VisualWorkflowApiBase {
  /** 运行期配置下发：{ runPollMs }；能力缝缺失时明确 501（不伪造取值）。 */
  async runtimeConfig(): Promise<unknown> {
    const downlink = this.host.runtimeConfig
    if (!downlink) {
      throw httpError(
        501,
        presentationOf(this.host, '运行期配置尚未装配（runtime config unavailable）', 'Runtime config is unavailable'),
      )
    }
    return downlink()
  }
}
