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

/** 递归列出目录下的 .ts/.tsx，返回仓库相对 POSIX 路径（按名称排序，保证判定确定）。 */
export function listSourceFiles(relDir: string): string[] {
  const out: string[] = []
  const walk = (abs: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(abs, entry.name)
      if (entry.isDirectory()) {
        walk(child)
        continue
      }
      if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(toRepoPath(child))
    }
  }
  walk(resolve(root, relDir))
  return out
}

/** 读取源文件原文。 */
export function readText(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

/** 解析为独立 SourceFile（不加入任何 tsconfig program）。 */
export function parseSource(rel: string): ts.SourceFile {
  return ts.createSourceFile(
    rel,
    readText(rel),
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}

/** 静态 import 引用。 */
export interface ImportRef {
  readonly specifier: string
  readonly typeOnly: boolean
  readonly line: number
}

/** 收集文件的静态 import 声明（动态 import 与 require 不在此列，由文本门禁覆盖）。 */
export function importsOf(rel: string): ImportRef[] {
  const sf = parseSource(rel)
  const out: ImportRef[] = []
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
    out.push({
      specifier: statement.moduleSpecifier.text,
      typeOnly: statement.importClause?.isTypeOnly === true,
      line: sf.getLineAndCharacterOfPosition(statement.getStart(sf)).line + 1,
    })
  }
  return out
}

/** 相对说明符 → 目标仓库路径（保留 .js 等扩展名，调用方按目录前缀判定）。 */
export function resolveSpecifier(fromRel: string, specifier: string): string {
  return toRepoPath(resolve(dirname(resolve(root, fromRel)), specifier))
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
