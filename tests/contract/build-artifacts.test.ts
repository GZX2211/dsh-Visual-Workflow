// tests/contract/build-artifacts.test.ts
//
// T-003 构建产物测试：**只读**校验已构建产物（本门禁不执行构建，D11C-02）。
//
// 为什么不在测试进程内构建：lib/ 受版本控制，而 scripts/build.mjs 第零步会整体
// rmSync(lib/types) 并回收 lib/ 幽灵条目。测试内真实构建会带来四类后果：
//   ① 与同一 pool 内动态 import lib/index.js 的 cordis-patch.test.ts 争用同一目录树，
//      并行 import 可能读到瞬时缺失的模块（全量并行时该用例超时的真因）；
//   ② 与并发 `pnpm build` 互删互写（两边都先清空 lib/types）；
//   ③ 改写工作区 lib/** 的内容与 mtime，覆盖他人未提交的产物改动；
//   ④ 每次 `pnpm test` 多付一次 tsc×3 + tsdown 的 CPU 成本（并行饥饿的放大器）。
//
// 「源码改了但 lib/ 未重建」的漂移不能靠测试内构建来兜——那种构建会让断言恒绿、
// 把漂移掩盖成本次运行内的假一致。故漂移分两层兜：
//   - CI（逐字节，唯一能发现「原地改内容未重建」的机械门禁）：`pnpm check` 的 build
//     步骤之后执行 `git diff --exit-code --stat -- lib`（见 .github/workflows/check.yml）；
//   - 本地（文件级）：本文件「产物与源码模块图一一对应」两条断言，暴露新增/改名/删除
//     模块却未重建的漂移，并给出可操作的失败信息。
// 产物缺失时失败信息显式提示先执行 `pnpm build`（lib/ 已入库，全新检出即带产物）。
//
// 层级归属：断言对象是构建链路对发布包的产出（跨 host/client 两半与构建脚本），
// 不对应任何 src 模块，故属 tests/contract（包与构建契约门禁）。
// 运行环境：node（host 测试默认）。构建产物断言与 P01 的 package-contract.test.ts 互补：
// 前者校验 package.json 静态契约，本测试校验 P01/P02 构建链路产出的真实文件。
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 项目根目录（package.json 所在目录）。
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** 读取产物文件内容（附加「文件缺失」上下文与修复指引）。 */
function readArtifact(rel: string): string {
  const p = resolve(root, rel)
  expect(existsSync(p), `产物缺失：${rel}（本门禁只读校验，不执行构建；请先运行 pnpm build）`).toBe(true)
  return readFileSync(p, 'utf8')
}

/** host 源码目录与产物目录（模块图映射的两端）。 */
const hostSrcDir = resolve(root, 'src/host')
const libDir = resolve(root, 'lib')

/** client bundle 由 tsdown 从 src/client/entry.ts 产出，不属 host 模块图。 */
const clientBundleEntry = 'client.js'

/** 递归列出目录下的文件（返回相对该目录的正斜杠路径）。 */
function listFiles(dir: string, base = ''): string[] {
  const found: string[] = []
  for (const entry of readdirSync(join(dir, base), { withFileTypes: true })) {
    const rel = base === '' ? entry.name : `${base}/${entry.name}`
    if (entry.isDirectory()) found.push(...listFiles(dir, rel))
    else if (entry.isFile()) found.push(rel)
  }
  return found
}

/** 读取 package.json 的包名：加载器按包名对账 bundle，注册 id 与样式归属都必须等于它。 */
function packageName(): string {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { name: string }
  return pkg.name
}

/** 从产物解析样式注入器的去重键与标签归属（注入器片段由构建链路生成，断言对象是产物本身）。 */
function cssInjections(code: string): Array<{ tagId: string; pluginId: string }> {
  const found: Array<{ tagId: string; pluginId: string }> = []
  const selector = /style\[data-plugin-css=" \+ JSON\.stringify\((\w+)\) \+ "\]/g
  for (const match of code.matchAll(selector)) {
    const index = match.index ?? 0
    // 去重键定义在查询之前、标签归属在查询之后；窗口只取本注入器片段，
    // 避免误取源码自身创建样式标签时的 dataset.plugin 赋值。
    const before = code.slice(Math.max(0, index - 500), index)
    const appendAt = code.indexOf('document.head.appendChild(tag)', index)
    const after = code.slice(index, appendAt < 0 ? index + 500 : appendAt)
    const declared = new RegExp('const ' + match[1] + ' = ("(?:[^"\\\\]|\\\\.)*")').exec(before)
    const owner = /dataset\.plugin = ("(?:[^"\\]|\\.)*")/.exec(after)
    expect(declared, `产物缺少样式去重键 ${match[1]} 的字面量定义`).not.toBeNull()
    expect(owner, '产物缺少 style 标签的 data-plugin 归属赋值').not.toBeNull()
    found.push({ tagId: JSON.parse(declared![1]) as string, pluginId: JSON.parse(owner![1]) as string })
  }
  return found
}

describe('T-003 构建链路（client bundle + host/client 并存）', () => {
  it('lib/client.js 注册 id 等于 package.json 包名（加载器对账契约）', () => {
    const code = readArtifact('lib/client.js')
    // 只保留「banner 形态存在」的最小断言，注册 id 则与 package.json 跨来源对账；
    // 不断言构建脚本里同源的字面量（那只会自证一致）。
    const banner = /^window\.__ModuleLoader__\.load\(\{\s*id:\s*("(?:[^"\\]|\\.)*")\s*,\s*factory:\s*\(require\)\s*=>\s*\{/.exec(code)
    expect(banner, 'lib/client.js 缺少 __ModuleLoader__.load({ id, factory }) banner 形态').not.toBeNull()
    expect(JSON.parse(banner![1])).toBe(packageName())
  })

  it('lib/client.js 的样式注入以包名命名空间（CSS 注入机制）', () => {
    const code = readArtifact('lib/client.js')
    const name = packageName()
    // 形态最小断言：注入器仍以 data-plugin-css 去重查询
    expect(code).toContain('style[data-plugin-css=')
    const injections = cssInjections(code)
    expect(injections.length, '未解析到任何样式注入器（用例会真空通过）').toBeGreaterThan(0)
    for (const { tagId, pluginId } of injections) {
      expect(tagId.startsWith(`${name}/`), `样式去重键未以包名开头：${tagId}`).toBe(true)
      expect(pluginId, `样式标签归属不等于包名：${pluginId}`).toBe(name)
    }
  })

  it('lib/index.js（host 产物）仍存在（client build 未清空 host 输出）', () => {
    const message = 'host 产物缺失：lib/index.js（请先运行 pnpm build）'
    expect(existsSync(resolve(root, 'lib/index.js')), message).toBe(true)
  })

  it('lib/client.js.map（sourcemap）存在', () => {
    const message = 'sourcemap 缺失：lib/client.js.map（请先运行 pnpm build）'
    expect(existsSync(resolve(root, 'lib/client.js.map')), message).toBe(true)
  })

  it('lib/types/client/index.d.ts 存在（exports["./client"].types 契约真实可命中）', () => {
    const dts = readArtifact('lib/types/client/index.d.ts')
    // 转发文件应把公开 API 从 entry 重新导出（P11 起 rootDir=src，入口在 client/ 子目录），
    // 保证 ./client 的类型入口非空壳。
    expect(dts).toContain("export * from './client/entry'")
  })

  it('lib/client.js 含官方插槽注册面（标签页 / 入口 / 全屏缩回；0.1.5-rc.1 迁移引入、0.1.7-rc.1 契约未变）', () => {
    const code = readArtifact('lib/client.js')
    // 两阶段注册：类型注册表 + keyed 插槽 body + 官方侧边栏底部动作插槽
    expect(code).toContain('sidebarRightTabs')
    expect(code).toContain('sidebar.right.pane.tab')
    expect(code).toContain('sidebar.footer.action')
    // 标签页挂载点与官方全屏缩回助手（自动化属性选择器）
    expect(code).toContain('wf-tab-mount')
    expect(code).toContain('data-sidebar-right-mode')
  })

  it('lib/client.js 不再含浮窗/分栏视图模式与 conversation.view 注册（迁移回归）', () => {
    const code = readArtifact('lib/client.js')
    // 浮窗/分栏外壳与视图模式切换按钮已随迁移整体删除
    expect(code).not.toContain('wf-window')
    expect(code).not.toContain('wf-split-pane')
    expect(code).not.toContain('wf-frame-content')
    // 用户验收批注：不得在 conversation.view 注册插件入口
    expect(code).not.toContain('conversation.view')
  })
})

// 漂移门禁（本地可读的那一层）：产物必须与源码模块图一一对应。
// 映射规则即 build.mjs 的发射契约——src/host/**/*.ts 逐个发射 lib/<rel>.js 与
// lib/types/<rel>.d.ts；lib/ 下凡无 src/host 对应物的 JS 即幽灵产物（源码改名/删除后
// 的残留）。.d.ts 源码是手写声明、不参与发射。
describe('T-003 产物与源码模块图同步（lib/ 必须随源码一起提交）', () => {
  it('每个 src/host 模块都有对应 lib/*.js 与 lib/types/*.d.ts 产物', () => {
    const sourceFiles = listFiles(hostSrcDir).filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
    // 防真空通过：目录遍历口径变化（glob/相对路径）时本用例必须失败而不是「零模块全绿」。
    expect(sourceFiles).toContain('index.ts')
    const modules = sourceFiles.map((file) => file.slice(0, -'.ts'.length))

    const missingJs = modules.filter((module) => !existsSync(join(libDir, `${module}.js`)))
    const missingDts = modules.filter((module) => !existsSync(join(libDir, 'types', `${module}.d.ts`)))
    expect(missingJs, '有源码模块但缺 JS 产物（lib/ 未随源码重建）').toEqual([])
    expect(missingDts, '有源码模块但缺声明产物（lib/types 未随源码重建）').toEqual([])
  })

  it('lib/ 下没有无源码对应的幽灵 JS 产物', () => {
    const ghosts = listFiles(libDir)
      .filter((file) => file.endsWith('.js') && file !== clientBundleEntry)
      .filter((file) => !existsSync(join(hostSrcDir, `${file.slice(0, -'.js'.length)}.ts`)))
    // 子目录内的残留不受 build.mjs 第零步回收（它只按 lib/ 顶层条目清理），故修复动作是
    // 删除该文件本身，而非重跑构建。
    expect(ghosts, 'lib/ 存在无源码对应的残留产物（源码已改名/删除，需删除该文件）').toEqual([])
  })
})
