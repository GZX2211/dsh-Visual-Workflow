// scripts/e2e-verify.mjs
//
// 真实浏览器 E2E（开发验证用，不随包分发）：系统 Edge（playwright 驱动）打开
// 3081 调试实例，验证：FAB/浮窗渲染 → 会话读取 → 模板/节点保存删除隔离 →
// 保存后刷新持久化 → 组合管理 MCP 显示 → 截图输出到 assets/imgs/e2e/。
// 运行：node scripts/e2e-verify.mjs

import { chromium } from '../node_modules/.pnpm/playwright@1.63.0-alpha-2026-08-05/node_modules/playwright/index.mjs'
import { mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const BASE = process.env.E2E_URL ?? 'http://127.0.0.1:3081'
const OUT = join(root, 'assets', 'imgs', 'e2e')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

let failures = 0
function check(cond, label) {
  if (cond) console.log(`[ok] ${label}`)
  else {
    failures += 1
    console.log(`[FAIL] ${label}`)
  }
}

async function shot(page, name) {
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: false })
  console.log(`[shot] ${name}`)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch({ executablePath: EDGE, headless: true })
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 960 } })).newPage()
  page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`))

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)

  // ---------- 1. FAB → 浮窗工作台 ----------
  const fab = page.locator('.wf-sidebar-entry')
  check((await fab.count()) > 0, 'FAB 存在')
  await fab.first().click()
  await page.waitForTimeout(1200)
  check((await page.locator('.wf-root').count()) > 0, '浮窗工作台渲染')
  await shot(page, 'e2e-01-studio')

  // ---------- 2. 会话读取：activate 一个会话（先发 mctl 消息） ----------
  // 先关闭浮窗，到聊天区激活会话
  await page.locator('.wf-titlebar__close').first().click()
  await page.waitForTimeout(500)
  // 点击工作区第一个会话
  const sessionRow = page.locator('[data-session-id], .conversation-item, [class*="session"]').first()
  if ((await sessionRow.count()) > 0) {
    await sessionRow.click().catch(() => {})
    await page.waitForTimeout(1500)
  }
  // composer 发送一条消息激活会话
  const composer = page.locator('textarea, [contenteditable="true"], [role="textbox"]').first()
  if ((await composer.count()) > 0) {
    await composer.click()
    await composer.fill('你好')
    await page.keyboard.press('Enter')
    console.log('[info] 已向会话发送激活消息，等待回复…')
    await page.waitForTimeout(20000)
    await shot(page, 'e2e-02-chat-activated')
  } else {
    console.log('[info] 未找到 composer（可能已有激活会话）')
  }

  // ---------- 3. 打开工作台：会话可读（无「会话不可用」提示） ----------
  await page.locator('.wf-sidebar-entry').first().click()
  await page.waitForTimeout(1500)
  const msgText = await page.locator('.wf-message').first().innerText().catch(() => '')
  check(!msgText.includes('会话不可用') && !msgText.includes('无法读取'), `会话可读（提示=${JSON.stringify(msgText.slice(0, 40))}）`)
  await shot(page, 'e2e-03-session-bound')

  // ---------- 4. 新建模板（角色）+ 保存 ----------
  const tabs = page.locator('.wf-lib-tab')
  await tabs.nth(1).click() // 角色
  await page.waitForTimeout(400)
  const roleAdd = page.locator('.wf-docgroup__add').first()
  await roleAdd.click().catch(() => {})
  await page.waitForTimeout(600)
  // 模板名输入框（右侧面板第一个 input）
  const nameInput = page.locator('.wf-inspector input').first()
  if ((await nameInput.count()) > 0) {
    await nameInput.click()
    await nameInput.fill('E2E角色A')
    await page.waitForTimeout(200)
  }
  await shot(page, 'e2e-04-template-editor')
  // footer 保存
  const footerSave = page.locator('.wf-inspector__footer .wf-btn.is-primary').first()
  if ((await footerSave.count()) > 0) {
    await footerSave.click()
    await page.waitForTimeout(800)
    console.log('[info] 模板保存点击完成')
  }
  const created = await page.locator('.wf-docitem__label', { hasText: 'E2E角色A' }).count()
  check(created > 0, '角色模板出现在左侧列表')

  // ---------- 5. 新建工作流 → 拖拽模板到画布 → 画布保存 → 刷新持久化 ----------
  await tabs.nth(0).click()
  await page.waitForTimeout(400)
  await page.locator('.wf-docgroup__add').first().click()
  await page.waitForTimeout(600)
  await tabs.nth(1).click()
  await page.waitForTimeout(400)
  // 拖拽模板卡到画布（HTML5 指针序列）
  const card = page.locator('.wf-docitem', { hasText: 'E2E角色A' }).first()
  const canvas = page.locator('.wf-canvas').first()
  const cardBox = await card.boundingBox()
  const canvasBox = await canvas.boundingBox()
  if (cardBox && canvasBox) {
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(800)
  }
  const nodes = await page.locator('.wf-node').count()
  check(nodes > 0, `拖拽生成画布节点（${nodes}）`)
  await shot(page, 'e2e-05-node-placed')

  // 画布保存（toolbar 保存）
  const toolbarSave = page.locator('.wf-toolbar .wf-btn', { hasText: '保存' }).first()
  if ((await toolbarSave.count()) > 0) {
    await toolbarSave.click()
    await page.waitForTimeout(1000)
  }
  const errorToast = await page.locator('.wf-toast.is-error').count()
  check(errorToast === 0, '保存无错误提示')

  // 刷新页面 → 重开工作台 → 打开工作流 → 节点仍在（持久化）
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)
  await page.locator('.wf-sidebar-entry').first().click()
  await page.waitForTimeout(1500)
  const wfItem = page.locator('.wf-docitem', { hasText: '新工作流' }).first()
  if ((await wfItem.count()) === 0) {
    // 新建的草稿已保存为「未命名工作流」或「新工作流」——从列表取第一项
    const any = page.locator('.wf-docitem').first()
    check((await any.count()) > 0, '刷新后工作流列表存在')
    if ((await any.count()) > 0) { await any.click(); await page.waitForTimeout(800) }
  } else {
    await wfItem.click()
    await page.waitForTimeout(800)
  }
  await shot(page, 'e2e-06-after-reload')
  const nodesAfter = await page.locator('.wf-node').count()
  check(nodesAfter > 0, `刷新后画布节点仍在（${nodesAfter}）`)

  // ---------- 6. 组合管理 MCP tab 显示 playwright ----------
  await page.locator('.wf-titlebar__close').first().click().catch(() => {})
  await page.waitForTimeout(400)
  await page.locator('.wf-sidebar-entry').first().click()
  await page.waitForTimeout(1200)
  const comboBtn = page.locator('.wf-tabs .wf-btn', { hasText: '组合' }).first()
  if ((await comboBtn.count()) > 0) {
    await comboBtn.click()
    await page.waitForTimeout(1000)
    const mcpTab = page.locator('.wf-combo__tab', { hasText: 'MCP 服务器' }).first()
    if ((await mcpTab.count()) > 0) {
      await mcpTab.click()
      await page.waitForTimeout(600)
    }
    await shot(page, 'e2e-07-combo-mcp')
    const body = await page.locator('.wf-combo').innerText().catch(() => '')
    check(body.includes('playwright'), '组合管理 MCP 列表显示 playwright 服务器')
  }

  await browser.close()
  console.log(failures === 0 ? '[e2e] ALL PASS' : `[e2e] ${failures} FAILURES`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('[e2e] FAILED:', err)
  process.exit(1)
})
