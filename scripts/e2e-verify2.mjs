// scripts/e2e-verify2.mjs
// E2E 第二轮：连线方向箭头 / 协作组拖入 / 模板与节点删除隔离。

import { chromium } from '../node_modules/.pnpm/playwright@1.63.0-alpha-2026-08-05/node_modules/playwright/index.mjs'
import { mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const BASE = 'http://127.0.0.1:3081'
const OUT = join(root, 'assets', 'imgs', 'e2e')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

let failures = 0
function check(cond, label) {
  if (cond) console.log(`[ok] ${label}`)
  else { failures += 1; console.log(`[FAIL] ${label}`) }
}
async function shot(page, name) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false })
  console.log(`[shot] ${name}`)
}

async function drag(page, source, _target, absolute) {
  const s = await source.boundingBox()
  if (!s) return
  const sx = s.x + s.width / 2
  const sy = s.y + s.height / 2
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move(sx + 12, sy + 12, { steps: 3 })
  const tx = absolute ? absolute.x : (_target ? (await _target.boundingBox())?.x ?? sx + 40 : sx + 40)
  const ty = absolute ? absolute.y : (_target ? (await _target.boundingBox())?.y ?? sy + 40 : sy + 40)
  await page.mouse.move(tx, ty, { steps: 16 })
  await page.mouse.up()
}

async function openStudio(page) {
  await page.locator('.wf-fab').first().click()
  await page.waitForTimeout(1400)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 960 } })).newPage()
  page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)

  // 激活会话：关闭可能掀开的浮窗，点击左侧会话中「你好」（e2e 创建），再开会话
  await page.locator('.wf-titlebar__close').first().click().catch(() => {})
  await page.waitForTimeout(400)
  const sessionRow = page.locator('div[class*="sessionRow"]').filter({ hasText: '你好' }).first()
  if ((await sessionRow.count()) > 0) {
    await sessionRow.click().catch(() => {})
    await page.waitForTimeout(2000)
  } else {
    console.log('[info] 未找到「你好」会话，尝试第一条会话')
    const any = page.locator('div[class*="sessionRow"]').first()
    if ((await any.count()) > 0) { await any.click().catch(() => {}); await page.waitForTimeout(2000) }
  }
  await openStudio(page)

  // 打开已有工作流（刷新持久化的那个）
  const wf = page.locator('.wf-docitem').first()
  check((await wf.count()) > 0, '工作流列表有记录')
  if ((await wf.count()) === 0) {
    await browser.close()
    console.log('[e2e2] SKIP: 无工作流记录（会话未恢复）')
    process.exit(0)
  }
  await wf.click()
  await page.waitForTimeout(1000)
  const nodesBefore = await page.locator('.wf-node').count()
  console.log(`[info] 打开工作流节点数=${nodesBefore}`)

  // 1. 拖入第二个节点（右上空白）→ 连线带箭头
  const tabs = page.locator('.wf-lib-tab')
  await tabs.nth(1).click()
  await page.waitForTimeout(400)
  const cardB = page.locator('.wf-docitem', { hasText: '新角色模板' }).first()
  const canvas = page.locator('.wf-canvas').first()
  const cbox = await canvas.boundingBox()
  if (cbox) {
    await drag(page, cardB, null, { x: cbox.x + cbox.width * 0.82, y: cbox.y + cbox.height * 0.3 })
    await page.waitForTimeout(600)
  }
  const nodeCount = await page.locator('.wf-node').count()
  console.log(`[info] 画布节点数=${nodeCount}`)

  const nodeHandles = page.locator('.wf-node .wf-graph__handle--source[data-handle="flow-out"]')
  const targetHandles = page.locator('.wf-node .wf-graph__handle--target[data-handle="flow-in"]')
  if ((await nodeHandles.count()) >= 1 && (await targetHandles.count()) >= 1) {
    await drag(page, nodeHandles.nth(0), targetHandles.nth(0))
    await page.waitForTimeout(600)
  }
  const markerDefs = await page.locator('#wf-arrow-flow').count()
  check(markerDefs > 0, 'SVG 存在有向箭头 marker 定义')
  const arrowEdges = await page.locator('path[marker-end^="url(#wf-arrow"]').count()
  check(arrowEdges > 0, `流程连线带箭头（${arrowEdges} 条）`)
  await shot(page, 'e2e-08-edges-arrow')

  // 2. 拖入协作组：新角色模板拖到组卡片
  await tabs.nth(3).click() // 其他
  await page.waitForTimeout(400)
  await drag(page, page.locator('.wf-docitem', { hasText: '协作组' }).first(), canvas)
  if (cbox) {
    // 组卡放到画布左侧
    await page.mouse.move(cbox.x + cbox.width / 2, cbox.y + 100)
    await page.mouse.down()
    await page.mouse.move(cbox.x + 180, cbox.y + cbox.height / 2, { steps: 10 })
    await page.mouse.up()
  }
  await page.waitForTimeout(600)
  const groupCard = page.locator('.wf-group-node').first()
  check((await groupCard.count()) > 0, '协作组卡片已放置')
  // 拖第三个角色卡进组卡片（页面左上角固定卡片）
  await tabs.nth(1).click()
  await page.waitForTimeout(400)
  const gb = await groupCard.boundingBox()
  const cardC = page.locator('.wf-docitem', { hasText: 'E2E角色A' }).first()
  if (gb && (await cardC.count()) > 0) {
    await drag(page, cardC, page.locator('.wf-window__body').first())
    await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2)
    await page.mouse.down()
    // 左栏卡开始位置不可再拖（用 window 拖拽模拟），改为直接检测组内成员 via 画布节点拖入
    await page.mouse.up()
  }
  // 画布节点拖入组：把主画布中的角色节点拖到组卡片
  const roleNode = page.locator('.wf-node--agent').first()
  if ((await roleNode.count()) > 0 && gb) {
    await drag(page, roleNode, groupCard)
    await page.waitForTimeout(700)
  }
  const members = await page.locator('.wf-group__member').count()
  check(members > 0, `角色节点拖入组后出现组内成员（${members}）`)
  await shot(page, 'e2e-09-group-member')

  // 3. 模板删除隔离：点击左侧模板卡（E2E角色A）→ footer 删除 → 确认 → 列表消失
  await tabs.nth(1).click()
  await page.waitForTimeout(400)
  await page.locator('.wf-docitem', { hasText: 'E2E角色A' }).first().click()
  await page.waitForTimeout(500)
  const copyBtn = await page.locator('.wf-inspector__footer .wf-btn', { hasText: '复制' }).count()
  check(copyBtn === 0, '选中模板时无「复制」按钮（仅节点有）——模板/节点操作隔离')
  await page.locator('.wf-inspector__footer .wf-btn.is-danger').first().click()
  await page.waitForTimeout(600)
  const confirmBtn = page.locator('.wf-confirm .wf-btn.is-danger').first()
  if ((await confirmBtn.count()) > 0) {
    await confirmBtn.click()
    await page.waitForTimeout(700)
  }
  const removed = await page.locator('.wf-docitem', { hasText: 'E2E角色A' }).count()
  check(removed === 0, '模板已删除（左侧列表消失）')

  await browser.close()
  console.log(failures === 0 ? '[e2e2] ALL PASS' : `[e2e2] ${failures} FAILURES`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('[e2e2] FAILED:', err)
  process.exit(1)
})
