#!/usr/bin/env node
/**
 * 录制 Bridge 迁移实录 GIF 素材（TotoroPilot Web 版 + 真实 host）。
 *
 * 用法（在 dsh-gui 目录下跑，借它的 playwright）：
 *   node scripts/record-demo.mjs seed          # 一次性：建隔离工作区 + 播种演示会话
 *   node scripts/record-demo.mjs record zh     # 录中文版
 *   node scripts/record-demo.mjs record en     # 录英文版
 *
 * 前置：dsh host 在 3080；vite dev server 在 1429（npm run dev -- --port 1429 --strictPort）。
 * 脱敏设计：演示会话在 /tmp/bridge-demo-ws 隔离工作区；录制时 DOM 级模糊其他工作区。
 * 输出：/tmp/bridge-rec/<lang>.webm + beats-<lang>.json（拍点，供 ffmpeg 剪辑）。
 */
import { mkdir, writeFile, readdir, rename } from 'node:fs/promises';
import { webkit } from 'playwright';

const API = (process.env.DSH_API ?? 'http://127.0.0.1:3080/api').replace(/\/$/, '');
const APP = process.env.TP_ORIGIN ?? 'http://localhost:1429/';
const OUT = '/tmp/bridge-rec';
const DEMO_WS_PATH = '/tmp/bridge-demo-ws';
const TZ = 'Asia/Shanghai';

const PLANT =
  '我们在做「电商后端」项目。硬约定：1) 本地端口固定 7101；2) 数据库用 PostgreSQL，明确禁止引入 MongoDB；' +
  '3) 核心逻辑写在 src/shop/orders.ts；4) 提交信息必须用中文写。请逐条确认，并各补一句简短理由。' +
  '（本轮只做文字确认，不要创建、修改或读取任何文件）';

const PLANT_EN =
  'We are building an "order backend" project. Hard conventions: 1) local port is fixed at 7101; ' +
  '2) database is PostgreSQL, and introducing MongoDB is explicitly forbidden; 3) core logic lives in ' +
  'src/shop/orders.ts; 4) commit messages must be written in English. Please confirm each point and add ' +
  'one short reason per point. (This turn is text-only: do not create, modify, or read any files.)';

const beats = [];
const t0 = Date.now();
function beat(name) {
  beats.push({ name, t: (Date.now() - t0) / 1000 });
  console.log(`[beat] ${name} @ ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

let rpcSeq = 0;
async function rpc(method, payload = {}, timeoutMs = 30_000) {
  const rpcId = `rec-${++rpcSeq}`;
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const env = await res.json();
  if (!env.result?.ok) throw new Error(`${method} ${env.result?.error?.code}: ${env.result?.error?.message}`);
  return env.result.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitIdle(sessionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  await sleep(2000);
  while (Date.now() < deadline) {
    const page = await rpc('session.list', {}).catch(() => null);
    const row = page?.items?.find((i) => i.sessionId === sessionId);
    if (row && !row.running) return true;
    await sleep(2500);
  }
  await rpc('session.cancel', { sessionId }).catch(() => undefined);
  return false;
}

async function demoWorkspace() {
  const ws = await rpc('workspace.list', {});
  const found = (ws?.items ?? []).find((w) => w.path?.endsWith('bridge-demo-ws'));
  if (found) return found.workspaceId;
  const created = await rpc('workspace.create', { path: DEMO_WS_PATH });
  return created.workspace.workspaceId;
}

async function seed(lang = 'zh') {
  await mkdir(DEMO_WS_PATH, { recursive: true });
  const workspaceId = await demoWorkspace();
  const src = await rpc('session.create', { workspaceId, agentPreset: 'cordis' });
  console.log('seed session:', src.sessionId, 'workspace:', workspaceId, 'lang:', lang);
  await rpc('session.prompt', {
    sessionId: src.sessionId, mode: 'queue',
    content: [{ type: 'text', text: lang === 'en' ? PLANT_EN : PLANT }],
    clientTimeZone: TZ,
  });
  await waitIdle(src.sessionId, 150_000);
  console.log('seed done');
}

async function record(lang) {
  const workspaceId = await demoWorkspace();
  const before = new Set(
    ((await rpc('session.list', {}))?.items ?? []).map((i) => i.sessionId),
  );
  await mkdir(OUT, { recursive: true });
  const browser = await webkit.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(process.env.FRAMES === '1' ? {} : { recordVideo: { dir: `${OUT}/raw-${lang}`, size: { width: 1280, height: 800 } } }),
  });
  const page = await context.newPage();
  // FRAMES=1：每 280ms 截一帧（供无 ffmpeg 环境用 Pillow 合成 GIF）
  const framesDir = `${OUT}/frames-${lang}`;
  const grabFrames = process.env.FRAMES === '1';
  let grabbing = grabFrames;
  if (grabFrames) {
    await mkdir(framesDir, { recursive: true });
    let n = 0;
    (async () => {
      while (grabbing) {
        n += 1;
        try {
          await page.screenshot({ path: `${framesDir}/${String(n).padStart(4, '0')}.png` });
          await page.waitForTimeout(350);
        } catch {
          break; // 页面关闭即停，别让循环的拒绝掩盖主流程的真实错误
        }
      }
    })();
  }
  let newSessionId = null;
  try {
    beat('open');
    await page.goto(APP, { waitUntil: 'load' });
    await page.waitForTimeout(2500);
    if (lang === 'en') {
      await page.locator('.lang-btn').click();
      await page.waitForTimeout(600);
    }
    // 脱敏：模糊除演示工作区外的所有分组（DOM 级，不上屏任何真实会话标题）
    await page.evaluate(() => {
      for (const g of document.querySelectorAll('.ws-group')) {
        const name = g.querySelector('.ws-name')?.textContent ?? '';
        if (name !== 'bridge-demo-ws') g.style.filter = 'blur(5px) saturate(.5)';
      }
    });
    // 展开演示工作区并进入播种会话
    const group = page.locator('.ws-group', { has: page.locator('.ws-name', { hasText: 'bridge-demo-ws' }) });
    const sessions = group.locator('.ws-sessions');
    if ((await sessions.count()) === 0 || !(await sessions.first().isVisible().catch(() => false))) {
      await group.locator('.ws-header').click();
      await page.waitForTimeout(500);
    }
    await group.locator('.session-item').first().click();
    await page.waitForTimeout(2000);
    beat('session');

    // 打开迁移弹窗
    await page.locator('.preset-bridge-btn').click();
    await page.locator('.bridge-modal').waitFor({ state: 'visible' });
    await page.waitForTimeout(1200);
    beat('modal');

    // 目标模式（分段按钮组，新版无下拉）+ pro 档位 + 生成摘要
    await page.locator('.bridge-modal div[role="group"]').first().locator('button', { hasText: 'PTC' }).click();
    await page.locator('.bridge-modal .seg button', { hasText: lang === 'zh' ? 'Pro' : 'Pro' }).click();
    await page.waitForTimeout(600);
    await page.locator('.bridge-modal .primary-btn').click();
    beat('summarize-start');

    // 等摘要生成完（主按钮变为「确认迁移」）
    const confirmText = lang === 'zh' ? '确认迁移' : 'Confirm bridge';
    await page.locator(`.bridge-modal .primary-btn:has-text("${confirmText}")`).waitFor({ timeout: 240_000 });
    await page.waitForTimeout(3500); // 给观众读摘要的时间
    beat('summary-ready');

    await page.locator('.bridge-modal .primary-btn').click();
    beat('execute');
    await page.waitForTimeout(3000);
    // 找到新会话并让它先跑着（复述段是文字，安全窗口）
    const after = ((await rpc('session.list', {}))?.items ?? []).map((i) => i.sessionId);
    newSessionId = after.find((id) => !before.has(id)) ?? null;
    await page.waitForTimeout(11_000);
    beat('kickoff-shown');
    grabbing = false;
  } finally {
    // 收尾：停掉新会话轮次；归档演示工作区全部会话（工人已被 app 归档）
    if (newSessionId) await rpc('session.cancel', { sessionId: newSessionId }).catch(() => undefined);
    const items = ((await rpc('session.list', {}))?.items ?? []).filter((i) => !i.archived);
    for (const i of items) {
      if (i.workspaceId === workspaceId) await rpc('workspace.archiveSession', { sessionId: i.sessionId }).catch(() => undefined);
    }
    await context.close(); // 视频在此落盘
    await browser.close();
  }
  const rawDir = `${OUT}/raw-${lang}`;
  try {
    const files = await readdir(rawDir);
    const webm = files.find((f) => f.endsWith('.webm'));
    if (webm) await rename(`${rawDir}/${webm}`, `${OUT}/${lang}.webm`);
  } catch { /* FRAMES 模式无视频 */ }
  await writeFile(`${OUT}/beats-${lang}.json`, JSON.stringify(beats, null, 2));
  console.log(`video: ${OUT}/${lang}.webm`);
  console.log(`beats: ${OUT}/beats-${lang}.json`);
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'seed') await seed(arg ?? 'zh');
else if (cmd === 'record') await record(arg ?? 'zh');
else throw new Error('usage: record-demo.mjs seed | record <zh|en>');
