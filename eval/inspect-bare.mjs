#!/usr/bin/env node
/**
 * 一次性诊断（2026-08-17 A/B 对照后续）：裸重开对照臂迁入 code preset 时探针 9/10，
 * 远高于 minimal 目标的 2/10。怀疑 code preset 的 agent 用工具从工作区/host 会话
 * 日志里翻出了事实。本脚本手动复现一条 bare→code run 并打印完整工具痕迹。
 *
 * 用法：node eval/inspect-bare.mjs   （前置同 run.mjs：host 在线 + 模型凭据）
 */
import { foldSessionEvents } from './fold.ts';

const API = (process.env.DSH_API ?? 'http://127.0.0.1:3080/api').replace(/\/$/, '');
const TZ = process.env.TZ_NAME ?? 'Asia/Shanghai';

let rpcSeq = 0;
async function rpc(method, payload = {}, timeoutMs = 30_000) {
  const rpcId = `inspect-${++rpcSeq}`;
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const env = await res.json();
  if (!env.result.ok) throw new Error(`${method} ${env.result.error?.code}: ${env.result.error?.message}`);
  return env.result.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitIdle(sessionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  await sleep(2000);
  while (Date.now() < deadline) {
    const page = await rpc('session.list', {}).catch(() => null);
    const row = page?.items?.find((i) => i.sessionId === sessionId);
    if (row && !row.running) return;
    await sleep(2500);
  }
  await rpc('session.cancel', { sessionId }).catch(() => undefined);
  await sleep(2500);
}

const ws = await rpc('workspace.list', {});
const workspaceId = (ws?.items ?? [])[0]?.workspaceId;

// 1) 源会话埋点（与评测相同）
const src = await rpc('session.create', { workspaceId, agentPreset: 'minimal' });
await rpc('session.prompt', {
  sessionId: src.sessionId, mode: 'queue',
  content: [{ type: 'text', text: '我们在做「电商后端」项目。硬约定：1) 本地端口固定 7101；2) 数据库用 PostgreSQL，明确禁止引入 MongoDB；3) 核心逻辑写在 src/shop/orders.ts；4) 提交信息必须用中文写。请逐条确认，并各补一句简短理由。（本轮只做文字确认，不要创建、修改或读取任何文件）' }],
  clientTimeZone: TZ,
});
await waitIdle(src.sessionId, 150_000);

// 2) 裸重开进 code preset：goal 只带标题
const dst = await rpc('session.create', { workspaceId, agentPreset: 'code' });
await rpc('goal.create', { sessionId: dst.sessionId, objective: '我们在做「电商后端」项目。这是上个会话未完成的任务，请继续推进。' });
await rpc('session.prompt', { sessionId: dst.sessionId, mode: 'queue', content: [{ type: 'text', text: '请继续。' }], clientTimeZone: TZ });
await waitIdle(dst.sessionId, 240_000);
await rpc('session.prompt', {
  sessionId: dst.sessionId, mode: 'queue',
  content: [{ type: 'text', text: '请回答关于这个项目的以下问题（每问一句话，直接给答案，不要读任何文件）：1) 本地端口是多少？2) 数据库选型是什么、禁止引入什么？3) 核心逻辑文件路径？4) 提交信息用什么语言？' }],
  clientTimeZone: TZ,
});
await waitIdle(dst.sessionId, 240_000);

// 3) 打印目标会话完整折叠历史（含工具痕迹）
const page = await rpc('session.history', { sessionId: dst.sessionId, maxMessages: 60 });
for (const m of foldSessionEvents(page.events.map((e) => e.event))) {
  console.log(`\n=== ${m.role}${m.kind ? ` (${m.kind})` : ''} ===`);
  console.log(m.content.slice(0, 800));
  for (const t of m.toolNodes ?? []) console.log(`  [tool] ${t.title} :: ${(t.detail ?? '').split('\n')[0]}`);
}

for (const sid of [src.sessionId, dst.sessionId]) await rpc('workspace.archiveSession', { sessionId: sid }).catch(() => undefined);
