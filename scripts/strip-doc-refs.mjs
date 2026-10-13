#!/usr/bin/env node
// scripts/strip-doc-refs.mjs
//
// 注释里的「文档引用」清理器：把代码注释中指向需求/架构/方案/各类 .md 文档的引用片段删除，
// 只保留长期有效的运行事实陈述。
//
// 为什么需要：注释里引用章节号、文档名与文档编号后，文档一旦更新或改名，注释就成了
// 错误信息源；维护成本远高于它带来的可读性。注释只应说明当前代码的运行事实。
//
// 作用范围与边界：
//   - 只改**注释**（行注释 // 与块注释 /* ... */），不改字符串、模板文本与代码；
//   - 只扫源码目录（默认 src、tests、scripts），不碰构建产物目录（lib）与文档目录（docs）；
//   - 逐片段删除引用标记（章节号 / 文档编号 / 文档文件名 / 文档目录路径 / 文档称谓），
//     并清理因此产生的空括号与重复标点；清理后无实质内容的注释行整行删除。
//
// 用法：
//   node scripts/strip-doc-refs.mjs                 # 预览（dry-run，不写盘）
//   node scripts/strip-doc-refs.mjs --verbose       # 预览 + 逐行改动明细
//   node scripts/strip-doc-refs.mjs --write         # 落盘改写
//   node scripts/strip-doc-refs.mjs --check         # CI 用：存在可清理项时以非零码退出
//   node scripts/strip-doc-refs.mjs --paths src     # 指定扫描根（可重复）
//   pnpm docs:strip [--check|--write|--verbose]     # 同一入口的命令别名
//
// 为什么 --check 暂不挂 check/gates：2026-10-14 dry-run 存量 260 个文件、733 处待清理，
// 此时纳入门禁会让每次 check 立刻红灯；先清理存量，再把它挂上门禁。

import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'

const ROOT = resolve(process.cwd())
const DEFAULT_PATHS = ['src', 'tests', 'scripts']
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])

/**
 * 引用识别规则。顺序有依赖：
 *   1. 文档引用措辞（吞掉 见/参见 + ./AGENTS.md 整段）必须最前；
 *   2. 章节号、编号、条目号等原子片段随后；
 *   3. 文件/目录/称谓/章节表名最后收尾。
 */
const RULES = [
  // 1. 文档引用措辞：把 见/参见 + ./ ../ + 目标文件 整个短语一起吞掉
  {
    name: '文档引用措辞',
    re: /(?:参见|详见|见|依据|对齐|同源|取自|引用|参考)\s*(?:同目录|本目录|上级目录|根目录|模块|上文|下文|下方|上方)?\s*(?:的\s*)?(?:\.\/|\.\.\/)?\s*(?:AGENTS\.md|README(?:\.zh)?\.md|README|SKILL(?:\.md)?|架构文档|需求文档|方案文档|设计文档|术语(?:表)?)/gu,
  },

  // 2. 章节号 + 可选「规则 N」后缀：§4.2.5.2 规则 2
  {
    name: '章节号',
    re: /§\s*\d+(?:\s*[.\-]\d+)*(?:\s*[A-Za-z]?\d*)?(?:\s*规则\s*\d+)?/gu,
  },

  // 3. 文档编号：AD-001、PRD-001、TASK-001、SPEC-001
  {
    name: '文档编号',
    re: /\b(?:AD|PRD|TASK|SPEC|DRAFT)[-_]\d{1,4}\b/giu,
  },

  // 4. 条目编号（含连字符范围）：T-022、D-07、W-05、V-01、Q22、P0-1、P0-2、P2-5、R-04、C-01、BUG-1、ISSUE-1、NOTE-1
  {
    name: '条目编号',
    re: /\b(?:T|D|V|W|Q|P|R|C|BUG|BUGS|ISSUE|NOTE)[-_]?\d{1,4}(?:[-_/]\d{1,4})*\b/gu,
  },

  // 5. 中文条目编号：第 4 条、第 5 款、第 6 项、规则 2、编号 3、任务 5、条目 6
  {
    name: '中文条目编号',
    re: /第\s*\d+\s*(?:条|款|项|章|节|步|阶段|轮|层|组|类|种|部分)|(?:需求|架构|方案|评审|验收|迁移|问题|缺陷|规则|任务|条目|条款|编号|清单|决策|检查|审查|修正|实施|治理|交付|测试|调试|扩展|附录|补充)\s*(?:编号|条款)?\s*[A-Za-z]?[-_]?\d{1,3}/gu,
  },

  // 6. 文档文件名（含 ./ ../ 前缀）
  {
    name: '文档文件名',
    re: /(?:\.\.?\/)?[\w\u4e00-\u9fa5][\w\u4e00-\u9fa5./\\-]*\.md/gu,
  },

  // 7. 文档目录路径
  {
    name: '文档目录路径',
    re: /(?:\.\/|\.\.\/)?(?:docs|prompt|\.agents|\.claude|specs?|designs?)\/[\w\u4e00-\u9fa5./\\-]*/gu,
  },

  // 8. 技能文档指代：SKILL §4.6、SKILL 等
  {
    name: '技能文档指代',
    re: /\bSKILL(?:\s*§?\s*\d+(?:\.\d+)*)?/gu,
  },

  // 9. 文档称谓（含 自主编排方案 / 修正方案 / 决策台账 / 任务清单 等）
  {
    name: '文档称谓',
    re: /(?:架构|需求|设计|规范|接口|数据|开发|迁移|评审|验收|自主编排|定时任务|元参数|协作|修正|实施|治理|交付|测试|调试|决策|任务|问题|审查|发布|部署|运维)(?:文档|说明书|白皮书|草案|方案|清单|台账|规则|手册|指南|规范)/gu,
  },

  // 10. 文档章节/表名（不带章节号但指向文档内部结构）
  {
    name: '文档章节引用',
    re: /(?:端点清单|工具(?:可见性)?表|连线类型表|连接点定义表|状态机|数据流|目录规划|验收项|DoD(?: 清单)?|术语表|定义表|映射表|目录清单|Bug 清单|问题清单)/gu,
  },

  // 11. 治理文件指代
  {
    name: '治理文件指代',
    re: /(?:同目录|本目录|上级目录|根目录|模块|项目|仓库)\s*(?:的\s*)?(?:\.\/|\.\.\/)?\s*(?:AGENTS\.md|README\.md|SKILL)/gu,
  },
]

/** 引用删除后的标点与残留清理（顺序执行）。 */
const CLEANUP = [
  // 空括号（含括号内只剩标点）
  [/[（(]\s*[，、；;,:：]?\s*[）)]/gu, ''],
  // 括号内只剩引导词
  [/[（(]\s*(?:见|参见|详见|依据|对齐|同源|取自|参见于|引用|参考)?\s*[）)]/gu, ''],
  // 悬空引导词
  [/(?:\(|（)\s*(?:见|参见|详见|依据|对齐|同源|取自|引用|参考)\s*$/gmu, ''],
  // 左括号后紧跟标点（引用删完后的残留）
  [/[（(]\s*[：:，,；;、]+\s*/gu, '（'],
  // 右括号前紧跟标点
  [/\s*[：:，,；;、]+(\s*[）)])/gu, '$1'],
  // 括号内只剩空白
  [/[（(]\s*[）)]/gu, ''],
  // 左括号后多余空白
  [/[（(]\s+(?=[^\s）)])/gu, '（'],
  // 右括号前多余空白
  [/([^\s（(])\s+[）)]/gu, '$1）'],
  // 冒号/逗号/分号紧邻括号或行尾
  [/[：:]\s*(?=[）)]|$)/gmu, ''],
  [/[，,；;]\s*(?=[）)]|$)/gmu, ''],
  // 不同标点相邻：，；→ ；  ；，→ ，
  [/[，,]\s*(?=[；;])/gu, ''],
  [/[；;]\s*(?=[，,])/gu, ''],
  // 重复标点
  [/[：:]\s*[：:]/gu, '：'],
  [/[，,]\s*[，,]/gu, '，'],
  [/[；;]\s*[；;]/gu, '；'],
  [/[。.]\s*[。.]/gu, '。'],
  [/[（(]\s*[（(]/gu, '（'],
  [/[）)]\s*[）)]/gu, '）'],
  // 孤立斜杠：连续斜杠、斜杠后跟空白/标点/行尾
  [/\/\s*\/+/gu, ''],
  [/\/\s*(?=$|[\s，,；;：:。!！?？）)])/gmu, ''],
  // 行首标点
  [/^[\s，,、；;：:。]+/u, ''],
  // 行尾空白
  [/[ \t]+$/gmu, ''],
  // 多空白压缩
  [/[ \t]{2,}/gu, ' '],
]

/** 注释行清理后是否已无实质内容（去掉注释符与标点后为空）。 */
function isMeaninglessCommentText(text) {
  return text.replace(/[\s，、。；;：:,.()（）[\]{}<>《》"'"'`~!！?？\-—+*/\\|]/gu, '').length === 0
}

/** 删除一段注释文本里的文档引用，并清理残留标点。 */
export function stripDocRefsFromText(text) {
  let out = String(text ?? '')
  let removed = 0
  for (const rule of RULES) {
    out = out.replace(rule.re, () => {
      removed += 1
      return ''
    })
  }
  if (removed === 0) return { text: out, removed: 0 }
  for (const [re, replacement] of CLEANUP) out = out.replace(re, replacement)
  out = out.replace(/^[\s，,、；;：:]+/u, '')
  return { text: out, removed }
}

/**
 * 逐行扫描源码，识别注释区间，并对注释文本应用给定改写函数。
 *
 * 状态机同时跟踪：块注释、字符串/模板字面量。字符串与模板内的内容一律不改。
 * 跨行模板字面量与跨行块注释都由状态延续处理。
 *
 * @param source - 源码文本。
 * @param rewriteComment - 注释文本改写函数（改写模式）；dropComments 为 true 时不调用。
 * @param options.dropComments - true = 丢弃全部注释（用于「代码区」校验）。
 * @param options.trackChanges - 是否记录改动行明细。
 * @returns 改写后的文本与改动行明细。
 */
export function transformSource(source, rewriteComment, options = {}) {
  const { dropComments = false, trackChanges = true } = options
  const lines = String(source ?? '').split(/\r?\n/)
  const changedLines = []
  const output = []

  let inBlockComment = false
  let quote = null // "'" | '"' | '`'
  let templateDepth = 0 // 模板字面量内的 ${ } 嵌套深度

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const original = line
    let result = ''
    let cursor = 0

    while (cursor < line.length) {
      const rest = line.slice(cursor)

      if (inBlockComment) {
        const end = rest.indexOf('*/')
        const segment = end === -1 ? rest : rest.slice(0, end)
        if (!dropComments) {
          const rewritten = rewriteComment(segment)
          result += rewritten === segment ? segment : rewritten
        }
        if (end === -1) {
          cursor = line.length
        } else {
          // 丢弃模式连注释定界符一并去掉（结果只含代码区）
          if (!dropComments) result += '*/'
          cursor += end + 2
          inBlockComment = false
        }
        continue
      }

      if (quote !== null) {
        const char = line[cursor]
        result += char
        if (char === '\\') {
          if (cursor + 1 < line.length) result += line[cursor + 1]
          cursor += 2
          continue
        }
        if (quote === '`' && char === '$' && line[cursor + 1] === '{') {
          result += '{'
          cursor += 2
          templateDepth += 1
          quote = null
          continue
        }
        if (char === quote && templateDepth === 0) quote = null
        cursor += 1
        continue
      }

      // 非注释非字符串区：识别注释起始与字符串起始
      if (rest.startsWith('//')) {
        if (dropComments) {
          result = result.replace(/[ \t]+$/u, '')
          cursor = line.length
          continue
        }
        const body = rest.slice(2)
        const rewritten = rewriteComment(body)
        if (rewritten === body) {
          result += rest // 无引用：原样保留（含空注释 `//`）
        } else if (isMeaninglessCommentText(rewritten)) {
          // 整行注释只剩引用 → 丢弃该注释（连同其前的对齐空白）
          result = result.replace(/[ \t]+$/u, '')
        } else {
          result += `//${rewritten}`
        }
        cursor = line.length
        continue
      }
      if (rest.startsWith('/*')) {
        inBlockComment = true
        if (!dropComments) result += '/*'
        cursor += 2
        continue
      }
      const char = line[cursor]
      if (char === "'" || char === '"' || char === '`') {
        quote = char
        templateDepth = 0
        result += char
        cursor += 1
        continue
      }
      if (char === '}' && templateDepth > 0) {
        // 模板插值结束，回到模板字符串
        templateDepth -= 1
        quote = '`'
        result += char
        cursor += 1
        continue
      }
      result += char
      cursor += 1
    }

    // 行尾未闭合的块注释保持状态；字符串状态按语言语义延续到下一行（模板/多行字符串）
    if (trackChanges && result !== original) {
      changedLines.push({ line: index + 1, before: original, after: result })
    }
    output.push(result)
  }

  return { text: output.join('\n'), changedLines }
}

/**
 * 逐行扫描源码，识别注释区间并在其文本上执行引用清理。
 */
export function stripDocRefsFromSource(source) {
  return transformSource(source, (text) => stripDocRefsFromText(text).text)
}

/**
 * 去掉全部注释后的「代码区」（用于改写完整性校验）。
 *
 * 为什么需要：本脚本会批量改写全仓库文件，必须证明改动只发生在注释里。
 * 对原文与改写结果分别去注释后逐行比较（忽略行尾空白），一致才算安全。
 */
export function codeOnly(source) {
  return transformSource(source, () => '', { dropComments: true, trackChanges: false }).text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .join('\n')
}


/** 递归收集待扫源码文件。 */
async function collectFiles(targets) {
  const files = []
  async function walk(path) {
    let info
    try {
      info = await stat(path)
    } catch {
      return
    }
    if (info.isDirectory()) {
      const entries = await readdir(path, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === '.git') continue
        await walk(join(path, entry.name))
      }
      return
    }
    const dot = path.lastIndexOf('.')
    if (dot >= 0 && SOURCE_EXTENSIONS.has(path.slice(dot))) files.push(path)
  }
  for (const target of targets) await walk(resolve(ROOT, target))
  return files.sort()
}

function parseArgs(argv) {
  const options = { write: false, check: false, verbose: false, paths: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--write') options.write = true
    else if (arg === '--check') options.check = true
    else if (arg === '--verbose') options.verbose = true
    else if (arg === '--paths') {
      index += 1
      options.paths.push(argv[index])
    } else if (arg.startsWith('--')) {
      throw new Error(`未知参数：${arg}`)
    } else {
      options.paths.push(arg)
    }
  }
  return options
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const targets = options.paths.length > 0 ? options.paths : DEFAULT_PATHS
  return collectFiles(targets).then(async (files) => {
    let changedFiles = 0
    let changedLines = 0

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      const { text, changedLines: lines } = stripDocRefsFromSource(source)
      if (lines.length === 0) continue
      changedFiles += 1
      changedLines += lines.length
      const label = relative(ROOT, file).replace(/\\/g, '/')
      console.log(`${options.write ? '改写' : '待清理'} ${label}（${lines.length} 处）`)
      if (options.verbose) {
        for (const item of lines) {
          console.log(`  L${item.line}`)
          console.log(`    - ${item.before.trim()}`)
          console.log(`    + ${item.after.trim()}`)
        }
      }
      if (options.write) await writeFile(file, text, 'utf8')
    }

    if (changedFiles === 0) {
      console.log('未发现需要清理的文档引用注释。')
      return 0
    }
    console.log(`\n合计：${changedFiles} 个文件、${changedLines} 处${options.write ? '（已落盘）' : '（预览，未落盘；加 --write 落盘）'}`)
    return options.check ? 1 : 0
  })
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(2)
})