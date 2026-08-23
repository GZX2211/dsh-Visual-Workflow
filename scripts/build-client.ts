// Visual Workflow —— client bundle 构建配置（T-003）。
//
// 复用官方 packages/client/tsdown.client.ts 的 clientBundle 关键契约（见取证结论）：
//   1. 产物形态：window.__ModuleLoader__.load({ id, factory }) 闭包工厂，externals 经
//      注入的 require（loader 模块表）解析，无全局、无 import map —— banner/footer/intro
//      逐字对齐官方（@repo packages/client/tsdown.client.ts L562-564）。
//   2. CSS 由 lightningcss 在 bundle 内编译：`*.module.css` 产出 hashed class map 并
//      注入带 style[data-plugin] 的标签；`*.css?inline` 导出编译文本；全局 `*.css`
//      注入样式标签 —— 三个虚拟 loader 与官方 L499-554 同构（自包含，去除 workspace 依赖）。
//   3. `clean: false` —— 不清空 lib/（host 产物并存）；entryFileNames 锁定 lib/client.js。
//   4. sourcemap: true —— 插件代码在 Vite module graph 之外被拉取，其 bundle 必须自带
//      TS/TSX 映射。
//   5. purity gate —— 除平台模块表基线（react/react-dom/cordis/ui-slots/ui-primitives、
//      @deepseek-ai/dsh-client-runtime/client）外的任何 @deepseek-ai/* 值 import 都是构建错误，
//      跨插件协作必须走 cordis service（type-only import 会被擦除，不触达此门）。
//
// 运行方式：由 scripts/build.mjs 以 `node node_modules/tsdown/dist/run.mjs --config ...`
// 以 stdio 'inherit' 直接执行（规避 Windows 沙箱 pipe EPERM）。配置以 node 原生 TS
// （--config-loader native）进程内加载，不得使用 tsx/unrun 等会 spawn 子进程的 loader。
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

// 注册到 __ModuleLoader__.load 的 id 必须等于 package.json 的包名（加载器按包名对账 bundle）。
const BUNDLE_ID = 'dsh-visual-workflow'

/**
 * 平台模块表基线（显式固化，避免 workspace 依赖 @repo packages/client/web/src/platform.ts）：
 * shell 共享给冻结模块表的 specifier，以及 shell 启动前 parser 预取的动态行。
 * 与官方 PLATFORM_MODULES / PRELOADED_CLIENT_EXTERNALS 逐字一致。
 */
const PLATFORM_MODULES: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

const PRELOADED_CLIENT_EXTERNALS: readonly string[] = [
  '@deepseek-ai/dsh-client-runtime/client',
]

// 项目根目录（package.json 所在目录）。
const ROOT = fileURLToPath(new URL('..', import.meta.url))

// 虚拟 id 包装：把 CSS 模块隔离在 tsdown 自身的 css pipeline（需 @tsdown/css）之外。
// 后缀必须不以 .css 结尾（tsdown 的 guard 只匹配 `.css` 结尾的 id）。
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const GLOBAL_CSS_VIRTUAL_PREFIX = '\0dsh-global-css:'
const INLINE_CSS_VIRTUAL_PREFIX = '\0dsh-inline-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'
const INLINE_CSS_QUERY = '?inline'

/**
 * 生成一个插件自持的样式注入器模块（可选附 CSS Modules 导出 class map）。
 * 与官方 tsdown.client.ts styleInjectionModule（L34-53）同构：注入的样式标签带
 * `data-plugin`（= BUNDLE_ID）与 `data-plugin-css`（= tagId），并在 factory 执行时
 * 幂等注入（已存在则不重复）。
 */
function styleInjectionModule(
  id: string,
  fileId: string,
  css: string,
  classMap?: Readonly<Record<string, string>>,
): string {
  const source = [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(`${id}/${basename(fileId)}`)};`,
    'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
  ]
  source.push(classMap === undefined ? 'export {};' : `export default ${JSON.stringify(classMap)};`)
  return source.join('\n')
}

/** 判定一个 import specifier 是否属于某条 `^name(/|$)` 模式。 */
function matchesPattern(patterns: readonly RegExp[], specifier: string): boolean {
  return patterns.some((pattern) => pattern.test(specifier))
}

/**
 * 构建 client bundle 的 tsdown 配置（自包含的官方 clientConfig 等价实现）。
 * entry：src/client/entry.ts（tsdown 自行编译 TS）；outDir：lib（与 host 产物并存）。
 */
function clientConfig(): UserConfig {
  const externals = new Set([...PLATFORM_MODULES, ...PRELOADED_CLIENT_EXTERNALS])
  const isRequested = (specifier: string): boolean => externals.has(specifier)

  return {
    name: `${BUNDLE_ID}/client`,
    entry: { client: resolvePath(ROOT, 'src/client/entry.ts') },
    // Browser bundle 落在 host node half 旁边（单一 lib/ 产物目录；entryFileNames 锁定
    // lib/client.js）。clean 必须关闭——默认 clean 会抹掉上面 host tsc 发射的产物。
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    // 类型由 host tsc（build.mjs 内 `--emitDeclarationOnly --outDir lib/types`）产出；
    // 此处 dts 关闭，避免把 banner/footer 包进 .d.cts 导致解析失败（官方 L448 同因）。
    dts: false,
    sourcemap: true,
    clean: false,
    cwd: ROOT,
    tsconfig: false,
    deps: {
      neverBundle: isRequested,
      // 未被请求进 loader 模块表的依赖必须内联（wire 层、纯库等）。一个模块表无法
      // 应答的 require() 是必然的运行时抛错，故规则 = 插件自身的请求清单：请求到的
      // specifier 保持 import，其余全部打进 bundle。
      alwaysBundle: (specifier: string) => !isRequested(specifier),
    },
    // 浏览器 bundle 内联 node-idiom 依赖可能读取 process.env.NODE_ENV 或
    // import.meta.env.MODE；CJS 产物无法承载 import.meta，需在此替换（官方 L473-478）。
    define: {
      'process.env': '{}',
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [
      {
        // 纯度门（官方 L479-497 同构）：基线 + 请求过的 specifier 保持 external，
        // inline-safe 的 wire 层内联，其余 @deepseek-ai/* 值 import 一律构建错误。
        name: 'dsh-client-bundle-purity',
        resolveId(source: string) {
          if (!source.startsWith('@deepseek-ai/')) return null
          if (isRequested(source)) return null
          throw new Error(
            `client bundle purity: "${source}" is not in the default client externals or ${BUNDLE_ID}'s dsh.client.external, an inline-safe wire layer, or a generated /remote contribution — cross-plugin value imports are forbidden; declare a non-default module request or collaborate through cordis services (type-only imports are erased and never reach this gate)`,
          )
        },
      },
      {
        // CSS Modules 虚拟 loader（官方 L499-522 同构但自包含）：`*.module.css` 经
        // lightningcss 编译出 hashed class map，并在 factory 执行时注入样式标签。
        name: 'dsh-css-modules-inline',
        resolveId(source: string, importer: string | undefined) {
          if (!source.endsWith('.module.css')) return null
          const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
          return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
        },
        async load(virtualId: string) {
          if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
          const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
          this.addWatchFile(fileId)
          const source = await readFile(fileId)
          const { code, exports: cssExports } = transform({
            filename: fileId,
            code: source,
            cssModules: { pattern: '[hash]_[local]' },
            minify: true,
          })
          const classMap: Record<string, string> = {}
          const exportEntries = Object.entries(cssExports ?? {})
            .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          for (const [local, exp] of exportEntries) classMap[local] = exp.name
          return styleInjectionModule(BUNDLE_ID, fileId, code.toString(), classMap)
        },
      },
      {
        // 内联 CSS 文本 loader（官方 L524-538）：`*.css?inline` 导出编译后的 CSS 文本，
        // 供插件自持的生命周期 effect 使用。
        name: 'dsh-css-text-inline',
        resolveId(source: string, importer: string | undefined) {
          if (!source.endsWith(`.css${INLINE_CSS_QUERY}`)) return null
          const stylesheet = source.slice(0, -INLINE_CSS_QUERY.length)
          const abs = importer !== undefined ? sourceAssetPath(stylesheet, importer) : stylesheet
          return INLINE_CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
        },
        async load(virtualId: string) {
          if (!virtualId.startsWith(INLINE_CSS_VIRTUAL_PREFIX)) return null
          const fileId = virtualId.slice(INLINE_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
          this.addWatchFile(fileId)
          const source = await readFile(fileId)
          const { code } = transform({ filename: fileId, code: source, minify: true })
          return `export default ${JSON.stringify(code.toString())};`
        },
      },
      {
        // 全局 CSS loader（官方 L540-553）：普通 `*.css`（非 module）注入样式标签。
        name: 'dsh-css-global-inline',
        resolveId(source: string, importer: string | undefined) {
          if (!source.endsWith('.css') || source.endsWith('.module.css')) return null
          const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
          return GLOBAL_CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
        },
        async load(virtualId: string) {
          if (!virtualId.startsWith(GLOBAL_CSS_VIRTUAL_PREFIX)) return null
          const fileId = virtualId.slice(GLOBAL_CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
          this.addWatchFile(fileId)
          const source = await readFile(fileId)
          const { code } = transform({ filename: fileId, code: source, minify: true })
          return styleInjectionModule(BUNDLE_ID, fileId, code.toString())
        },
      },
    ],
    outputOptions: {
      entryFileNames: 'client.js',
      // map 由 /plugins/<package>/client.js.map 提供；浏览器溯源路径镜像仓库目录结构。
      sourcemapPathTransform(source: string, sourcemapPath: string) {
        if (!source.startsWith('.')) return source
        const physical = resolvePath(dirname(sourcemapPath), source)
        const rel = physical.startsWith(ROOT) ? physical.slice(ROOT.length) : physical
        return rel.split(sep).join('/')
      },
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(BUNDLE_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

/** 路径段分隔 src 源与 lib/types 的产物（用于把 emitted 资源换回 src 源旁）。 */
const TYPES_MARKER = `${sep}lib${sep}types${sep}`

/**
 * 把 emitted JS 资产 import 回源到它的 src 树对应物（官方 sourceAssetPath L582-588 同构）。
 * 本项目 client bundle 直接以 src/client/entry.ts 为入口，CSS 即已在 src 树下，
 * 故此函数主要用于健壮性回退。
 */
function sourceAssetPath(source: string, importer: string): string {
  const emitted = resolvePath(dirname(importer), source)
  if (existsSync(emitted)) return emitted
  const boundary = emitted.indexOf(TYPES_MARKER)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + TYPES_MARKER.length))
}

// 默认导出配置对象（tsdown CLI 直接读取 default）。
export default clientConfig()
