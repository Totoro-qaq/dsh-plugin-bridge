#!/usr/bin/env node
/**
 * Record the native Bridge card inside the official DSH WebUI.
 *
 * Discover -> rehearse -> record:
 *   DSH_API=http://127.0.0.1:3181/api node scripts/record-demo.mjs seed zh
 *   BRIDGE_DEMO_SOURCE='发布重复验收R2概述' node scripts/record-demo.mjs discover zh
 *   BRIDGE_DEMO_SOURCE='发布重复验收R2概述' node scripts/record-demo.mjs rehearse zh
 *   BRIDGE_DEMO_SOURCE='发布重复验收R2概述' node scripts/record-demo.mjs record zh
 *
 * The script uses an isolated DSH profile supplied by the caller. It never reads
 * credentials, other browser storage, or the user's normal session database.
 */
import { mkdir, readdir, rename, writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'

const API = (process.env.DSH_API ?? 'http://127.0.0.1:3181/api').replace(/\/$/u, '')
const APP = process.env.DSH_WEB_URL ?? API.replace(/\/api$/u, '/')
const OUT = process.env.BRIDGE_DEMO_OUT ?? '/tmp/bridge-rec'
const WORKSPACE_PATH = process.env.BRIDGE_DEMO_WORKSPACE ?? '/tmp/bridge-demo-ws'
const SOURCE_TITLE = process.env.BRIDGE_DEMO_SOURCE ?? 'Bridge native demo'
const TIER = process.env.BRIDGE_DEMO_TIER ?? 'pro'
const TZ = 'Asia/Shanghai'

const FIXTURE = {
  zh: '原生卡片演示。请只用一段话复述并停止，不使用工具。事实：端口 8118；数据库 PostgreSQL；禁止 MongoDB；核心文件 src/orders/router.ts；下一步只补幂等键测试。',
  en: 'Native-card demo. Restate this once and stop; use no tools. Facts: port 8118; database PostgreSQL; MongoDB is forbidden; core file src/orders/router.ts; next step is idempotency-key tests only.',
}

const COPY = {
  zh: { settings: '设置', language: '中文', close: '关闭', edit: '编辑', preview: '预览', confirm: '确认迁移', paused: /已暂停的目标/u, marker: '（用户校对）' },
  en: { settings: 'Settings', language: 'English', close: 'Close', edit: 'Edit', preview: 'Preview', confirm: 'Confirm migration', paused: /Paused goal/u, marker: ' (reviewed)' },
}

let rpcSeq = 0
async function rpc(method, payload = {}, timeoutMs = 30_000) {
  const rpcId = `bridge-demo-${++rpcSeq}`
  const response = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const envelope = await response.json()
  if (!envelope.result?.ok) {
    throw new Error(`${method}: ${envelope.result?.error?.code}: ${envelope.result?.error?.message}`)
  }
  return envelope.result.value
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitIdle(sessionId, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(1_500)
    const row = (await rpc('session.list', {})).items.find((item) => item.sessionId === sessionId)
    if (row && !row.running) return row
  }
  await rpc('session.cancel', { sessionId }).catch(() => undefined)
  throw new Error(`source session ${sessionId} timed out`)
}

async function demoWorkspace() {
  await mkdir(WORKSPACE_PATH, { recursive: true })
  const listed = await rpc('workspace.list', {})
  const found = listed.items.find((workspace) => workspace.path === WORKSPACE_PATH)
  if (found) return found.workspaceId
  return (await rpc('workspace.create', { path: WORKSPACE_PATH })).workspace.workspaceId
}

async function seed(lang) {
  const workspaceId = await demoWorkspace()
  const created = await rpc('session.create', { workspaceId, agentPreset: 'minimal' })
  await rpc('session.prompt', {
    sessionId: created.sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: FIXTURE[lang] }],
    clientTimeZone: TZ,
  })
  const row = await waitIdle(created.sessionId)
  console.log(JSON.stringify({ sessionId: created.sessionId, title: row.title, workspaceId }))
}

async function injectCursor(page) {
  await page.evaluate(() => {
    if (document.getElementById('demo-cursor')) return
    const cursor = document.createElement('div')
    cursor.id = 'demo-cursor'
    cursor.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M5 3L19 12L12 13L9 20L5 3Z" fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/></svg>'
    cursor.style.cssText = 'position:fixed;z-index:999999;pointer-events:none;width:24px;height:24px;left:0;top:0;transition:left .1s,top .1s;filter:drop-shadow(1px 1px 2px rgba(0,0,0,.3))'
    document.body.append(cursor)
    document.addEventListener('mousemove', (event) => {
      cursor.style.left = `${event.clientX}px`
      cursor.style.top = `${event.clientY}px`
    })
  })
}

async function injectSubtitle(page) {
  await page.evaluate(() => {
    if (document.getElementById('demo-subtitle')) return
    const bar = document.createElement('div')
    bar.id = 'demo-subtitle'
    bar.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:999998;max-width:720px;padding:9px 16px;border-radius:999px;background:rgba(18,19,22,.86);color:white;font:600 14px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;opacity:0;transition:opacity .2s;pointer-events:none'
    document.body.append(bar)
  })
}

async function subtitle(page, text) {
  await page.evaluate((value) => {
    const bar = document.getElementById('demo-subtitle')
    if (!bar) return
    bar.textContent = value
    bar.style.opacity = value ? '1' : '0'
  }, text)
  if (text) await page.waitForTimeout(650)
}

async function ensureVisible(locator, label) {
  if (await locator.isVisible().catch(() => false)) {
    console.log(`REHEARSAL OK: ${label}`)
    return
  }
  throw new Error(`REHEARSAL FAIL: ${label}`)
}

async function moveAndClick(page, locator, label, delay = 700) {
  await ensureVisible(locator, label)
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 })
  await page.waitForTimeout(250)
  await locator.click()
  await page.waitForTimeout(delay)
}

async function typeSlowly(page, locator, text, label) {
  await moveAndClick(page, locator, label, 150)
  await locator.fill('')
  await locator.pressSequentially(text, { delay: 32 })
  await page.waitForTimeout(350)
}

function sourceItem(page) {
  return page.locator('[role="treeitem"]', { hasText: SOURCE_TITLE }).filter({ hasNotText: '→ code' }).first()
}

function composer(page) {
  return page.locator('textarea').last()
}

function previewCard(page, lang) {
  return page.locator('.dsh-bridge-card').filter({
    has: page.getByRole('button', { name: COPY[lang].confirm }),
  }).last()
}

async function switchLanguage(page, lang) {
  const desired = COPY[lang].language
  const visibleDesired = page.getByRole('button', { name: desired, exact: true })
  if (await visibleDesired.isVisible().catch(() => false)) return
  const settings = page.getByRole('button', { name: /^(设置|Settings)$/u })
  await moveAndClick(page, settings, 'settings', 250)
  const current = page.getByRole('dialog').getByRole('button', { name: /^(中文|English)$/u })
  await moveAndClick(page, current, 'language menu', 150)
  await moveAndClick(page, page.getByRole('menuitem', { name: desired, exact: true }), `language ${desired}`, 300)
  await moveAndClick(page, page.getByRole('button', { name: /^(关闭|Close)$/u }), 'close settings', 300)
}

async function openSource(page, lang) {
  await page.goto(APP, { waitUntil: 'networkidle' })
  await injectCursor(page)
  await injectSubtitle(page)
  await switchLanguage(page, lang)
  const item = sourceItem(page)
  if (!(await item.isVisible().catch(() => false))) {
    for (const group of await page.locator('[role="treeitem"][aria-expanded="false"]').all()) {
      await group.click().catch(() => undefined)
    }
    const more = page.getByRole('button', { name: /(?:展开其余|Show .*more session)/iu })
    if (await more.isVisible().catch(() => false)) await moveAndClick(page, more, 'expand remaining sessions', 250)
  }
  await moveAndClick(page, item, 'source session', 900)
  await ensureVisible(composer(page), 'composer')
}

async function discover(lang) {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  try {
    await openSource(page, lang)
    const fields = await page.evaluate(() => Array.from(document.querySelectorAll('input,select,textarea,button,[contenteditable]'))
      .filter((element) => element.offsetParent !== null)
      .map((element) => ({
        tag: element.tagName,
        type: element.getAttribute('type') ?? '',
        placeholder: element.getAttribute('placeholder') ?? '',
        text: (element.textContent ?? '').trim().slice(0, 80),
        aria: element.getAttribute('aria-label') ?? '',
        role: element.getAttribute('role') ?? '',
      })))
    console.log(JSON.stringify(fields, null, 2))
  } finally {
    await browser.close()
  }
}

async function rehearse(lang) {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  try {
    await openSource(page, lang)
    await ensureVisible(sourceItem(page), 'source session')
    await ensureVisible(composer(page), 'composer')
    const card = previewCard(page, lang)
    await ensureVisible(card, 'existing native bridge card')
    await ensureVisible(card.getByRole('tab', { name: COPY[lang].edit }), 'edit tab')
    await ensureVisible(card.getByRole('tab', { name: COPY[lang].preview }), 'preview tab')
    await ensureVisible(card.getByRole('button', { name: COPY[lang].confirm }), 'confirm button')
    console.log('REHEARSAL PASSED')
  } finally {
    await browser.close()
  }
}

async function record(lang) {
  await mkdir(OUT, { recursive: true })
  const rawDir = `${OUT}/raw-${lang}`
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: rawDir, size: { width: 1280, height: 800 } },
  })
  const page = await context.newPage()
  const video = page.video()
  const beats = []
  const started = Date.now()
  const beat = (name) => {
    beats.push({ name, t: (Date.now() - started) / 1000 })
    console.log(`[beat] ${name} @ ${beats.at(-1).t.toFixed(1)}s`)
  }

  try {
    await openSource(page, lang)
    beat('source-open')
    const existingCards = await page.locator('.dsh-bridge-card').count()
    const sessionsBefore = new Set((await rpc('session.list', {})).items.map((item) => item.sessionId))
    await subtitle(page, lang === 'zh' ? '生成交接预览，原会话保持不动' : 'Generate a handoff preview; keep the source untouched')
    await typeSlowly(page, composer(page), `/bridge code --tier ${TIER} --lang ${lang}`, 'bridge command')
    await composer(page).press('Enter')
    const card = page.locator('.dsh-bridge-card').nth(existingCards)
    await card.locator('.dsh-bridge-progress').waitFor({ state: 'visible', timeout: 5_000 })
    beat('preview-running')
    await subtitle(page, '')

    const confirm = card.getByRole('button', { name: COPY[lang].confirm })
    await confirm.waitFor({ state: 'visible', timeout: 180_000 })
    beat('preview-ready')
    await page.waitForTimeout(2_000)

    await moveAndClick(page, card.getByRole('tab', { name: COPY[lang].edit }), 'edit tab', 500)
    const editor = card.getByRole('textbox', { name: /Markdown/u })
    await ensureVisible(editor, 'summary editor')
    await editor.evaluate((element) => {
      const index = element.value.indexOf('8118')
      if (index < 0) throw new Error('fixture port not found in summary')
      element.focus()
      element.setSelectionRange(index + 4, index + 4)
    })
    await editor.pressSequentially(COPY[lang].marker, { delay: 42 })
    beat('summary-edited')
    await page.waitForTimeout(650)
    await moveAndClick(page, card.getByRole('tab', { name: COPY[lang].preview }), 'preview tab', 800)
    await subtitle(page, lang === 'zh' ? '校对后再确认：迁移的是这份文本' : 'Review first: this exact text will migrate')
    await page.waitForTimeout(1_400)
    await subtitle(page, '')

    await moveAndClick(page, confirm, 'confirm migration', 500)
    beat('confirmed')
    const selected = page.locator('[role="treeitem"][aria-selected="true"]')
    await selected.filter({ hasText: '→ code' }).waitFor({ state: 'visible', timeout: 15_000 })
    beat('target-opened')
    await subtitle(page, lang === 'zh' ? '目标会话已自动打开，并在复述后暂停' : 'Target opened automatically and pauses after restating')
    let targetSessionId
    const targetDeadline = Date.now() + 15_000
    while (!targetSessionId && Date.now() < targetDeadline) {
      const rows = (await rpc('session.list', {})).items
      targetSessionId = rows.find((item) => !sessionsBefore.has(item.sessionId) && item.agentPreset === 'code')?.sessionId
      if (!targetSessionId) await page.waitForTimeout(300)
    }
    if (!targetSessionId) throw new Error('created target session was not found')
    await waitIdle(targetSessionId, 120_000)
    beat('target-paused')
    await page.waitForTimeout(2_400)
    await subtitle(page, '')
  } finally {
    await context.close()
    await browser.close()
  }

  if (video) {
    const source = await video.path()
    await rename(source, `${OUT}/${lang}.webm`)
  }
  await writeFile(`${OUT}/beats-${lang}.json`, JSON.stringify(beats, null, 2))
  console.log(`video: ${OUT}/${lang}.webm`)
}

const [command, rawLang = 'zh'] = process.argv.slice(2)
const lang = rawLang === 'en' ? 'en' : 'zh'
if (command === 'seed') await seed(lang)
else if (command === 'discover') await discover(lang)
else if (command === 'rehearse') await rehearse(lang)
else if (command === 'record') await record(lang)
else throw new Error('usage: record-demo.mjs seed|discover|rehearse|record <zh|en>')
