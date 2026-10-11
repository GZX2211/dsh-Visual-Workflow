// tests/contract/fixtures/client-scan.ts
//
// 客户端静态门禁的共享扫描工具：只读源码「文本」与「独立语法树」，供 tests/contract 下的
// 门禁用同一口径判定，避免各门禁各写一套提取逻辑而互相漂移。
//
// 为什么用独立 SourceFile 而不是 import 客户端模块：
//   1. tests/contract 属 host 侧 program（tsconfig.test.json 显式 exclude src/client），
//      import 客户端实现会把 client 拉进 host program，破坏两个 program 的隔离契约；
//   2. 门禁验证的是「源码文本形态」（内联文案、类名使用、跨层 import），不需要运行时行为。
// 注释天然不参与判定：AST 里注释属 trivia，不会被遍历。
//
// 覆盖面（调用方据此判断边界，勿按函数名推断）：
//   - listSourceFiles 默认只收 .ts/.tsx；样式（.css）与文档（.md）需**显式**传扩展名才会入集，
//     它们不是模块，只经 readText 参与文本判定（CSS 声明级判定见 client-style.test.ts）。
//   - importsOf 收顶层 import、`export … from` re-export、内联类型引用 `import('x')` 与动态
//     `import('x')`；仅 `require(...)` 不在静态语法树判定范围内（仓库为 ESM，无真实用例）。

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/** 仓库根目录（tests/contract/fixtures → 上三级）。 */
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

/** 绝对路径 → 仓库相对 POSIX 路径（门禁输出与基线统一用这一种写法）。 */
export function toRepoPath(abs: string): string {
  return abs.slice(root.length + 1).split('\\').join('/')
}

/** 递归列出目录下指定扩展名的文件，返回仓库相对 POSIX 路径（按名称排序，保证判定确定）。 */
export function listSourceFiles(relDir: string, extensions: readonly string[] = ['.ts', '.tsx']): string[] {
  const out: string[] = []
  const walk = (abs: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(abs, entry.name)
      if (entry.isDirectory()) {
        walk(child)
        continue
      }
      if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(toRepoPath(child))
    }
  }
  walk(resolve(root, relDir))
  return out
}

/** 该路径是否为可做 TS 语法扫描的模块（样式与文档不是模块，只经 readText 参与文本判定）。 */
export function isModuleFile(rel: string): boolean {
  return rel.endsWith('.ts') || rel.endsWith('.tsx')
}

/** 读取源文件原文。 */
export function readText(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

/** 解析为独立 SourceFile（不加入任何 tsconfig program）。 */
export function parseSource(rel: string): ts.SourceFile {
  return parseSourceText(
    rel,
    readText(rel),
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}

/** 按给定文本解析 SourceFile（供门禁自检：用受控源码片段验证提取口径本身）。 */
export function parseSourceText(rel: string, text: string, kind: ts.ScriptKind): ts.SourceFile {
  return ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind)
}

/** 模块引用形态。 */
export type ModuleRefKind = 'import' | 'exportFrom' | 'inlineType' | 'dynamic'

/** 模块引用（静态 import / re-export / 内联类型引用 / 动态 import()）。 */
export interface ImportRef {
  readonly specifier: string
  readonly typeOnly: boolean
  readonly line: number
  /** 是否来自内联类型引用 `import('x')`（ImportTypeNode）而非顶层 import 声明。 */
  readonly inlineType: boolean
  readonly kind: ModuleRefKind
}

/**
 * 收集文件的模块引用。四种形态都会在运行时或类型层真实指向目标模块，必须同口径收集：
 *   - 顶层 `import` 声明与 `export … from` re-export（后者会经 barrel 再次暴露依赖）；
 *   - 内联类型引用 `import('x')`（`as import('../../host/orchestrator/index.js').X` 是合法 TS，
 *     不会被 tsconfig 挡住，也不指向 host/shared）；
 *   - 动态 `import('x')` 表达式。
 * 只有 `require(...)` 不在静态语法树判定范围内（仓库为 ESM，无真实用例），由文本门禁覆盖。
 */
export function importsOf(rel: string): ImportRef[] {
  return moduleRefsOf(parseSource(rel))
}

/** 从已解析的 SourceFile 收集模块引用（供门禁自检用受控片段直接验证提取口径）。 */
export function moduleRefsOf(sf: ts.SourceFile): ImportRef[] {
  const out: ImportRef[] = []
  const lineOf = (node: ts.Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
  const specifierOf = (node: ts.Node | undefined): ts.StringLiteral | undefined => {
    return node !== undefined && ts.isStringLiteral(node) ? node : undefined
  }
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement)) {
      const specifier = specifierOf(statement.moduleSpecifier)
      if (specifier) {
        out.push({ specifier: specifier.text, typeOnly: statement.importClause?.isTypeOnly === true, line: lineOf(statement), inlineType: false, kind: 'import' })
      }
      continue
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined) {
      const specifier = specifierOf(statement.moduleSpecifier)
      if (specifier) {
        out.push({ specifier: specifier.text, typeOnly: statement.isTypeOnly, line: lineOf(statement), inlineType: false, kind: 'exportFrom' })
      }
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      out.push({ specifier: node.argument.literal.text, typeOnly: true, line: lineOf(node), inlineType: true, kind: 'inlineType' })
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = specifierOf(node.arguments[0])
      if (specifier) {
        out.push({ specifier: specifier.text, typeOnly: false, line: lineOf(node), inlineType: false, kind: 'dynamic' })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** 相对说明符 → 目标仓库相对路径（保留 .js 等扩展名，调用方按目录前缀判定）。 */
export function resolveSpecifier(fromRel: string, specifier: string): string {
  return toRepoPath(resolve(dirname(resolve(root, fromRel)), specifier))
}

/** 一条已提取的模块引用（门禁自检用受控数据验证判定本身，不依赖磁盘）。 */
export interface SourcedModuleRef {
  readonly file: string
  readonly line: number
  readonly specifier: string
  readonly kind: ModuleRefKind
}

/** 把「文件 → 引用」判定为跨层违规清单（判定只看解析后的仓库相对路径）。 */
export function crossLayerViolationsOf(
  refs: readonly SourcedModuleRef[],
  isViolation: (from: string, resolved: string) => boolean,
): string[] {
  const offenders: string[] = []
  for (const ref of refs) {
    if (!ref.specifier.startsWith('.')) continue
    const resolved = resolveSpecifier(ref.file, ref.specifier)
    if (isViolation(ref.file, resolved)) offenders.push(`${ref.file}:${ref.line} → ${ref.specifier}`)
  }
  return offenders
}

/** 读取仓库内给定文件的模块引用，并做同一套跨层违规判定。 */
export function crossLayerViolations(
  files: readonly string[],
  isViolation: (from: string, resolved: string) => boolean,
): string[] {
  const sourced = files.flatMap((file) =>
    importsOf(file).map((ref) => ({ file, line: ref.line, specifier: ref.specifier, kind: ref.kind })),
  )
  return crossLayerViolationsOf(sourced, isViolation)
}

const CJK = /[\u4e00-\u9fff]/

/**
 * 文件内面向用户的内联文案（只取「静态文案本体」）：
 *   - 字符串字面量 / 无插值模板 → 字面量值；
 *   - 模板表达式 → 静态片段拼 `${}` 占位（变量改名不影响文案本体，基线因此稳定）；
 *   - JSX 文本 → 折叠空白后的文本。
 * 命中条件为含中日韩统一表意文字。
 */
export function inlineCopyOf(rel: string): string[] {
  const sf = parseSource(rel)
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    let value: string | undefined
    if (ts.isJsxText(node)) value = node.getText(sf).replace(/\s+/g, ' ').trim()
    else if (ts.isTemplateExpression(node)) {
      value = node.head.text + node.templateSpans.map((span) => `\${}${span.literal.text}`).join('')
    } else if (ts.isStringLiteralLike(node)) value = node.text
    if (value !== undefined && value.length > 0 && CJK.test(value)) out.push(value)
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/**
 * 文件内的全部属性访问名（`x.key` 的 `key`）。
 * 供「词典键是否有消费点」类门禁按语法判定，避免把跨文件的同名子串误当消费点。
 */
export function propertyNamesOf(rel: string): string[] {
  const sf = parseSource(rel)
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) out.push(node.name.text)
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}

/** 去掉 CSS 块注释（门禁判定只看生效声明；注释里的类名/颜色不算定义）。 */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * 文件内的全部字符串字面量文本（含模板的静态片段），不含注释。
 * 用于「契约字面量不得硬编码」类门禁：注释里提到端点名是叙述，不是硬编码。
 */
export function stringLiteralsOf(rel: string): string[] {
  const sf = parseSource(rel)
  const out: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isTemplateExpression(node)) {
      out.push(node.head.text, ...node.templateSpans.map((span) => span.literal.text))
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      out.push(node.text)
    } else if (ts.isStringLiteralLike(node)) {
      out.push(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return out
}
