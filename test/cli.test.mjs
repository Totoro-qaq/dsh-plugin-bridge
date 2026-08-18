/**
 * CLI 的端到端测试：把假 host 挂成真的 HTTP 网关，spawn 真的 CLI 进程。
 *
 * 这条路径就是官方 WebUI 用户实际走的那条——agent 在自己的 bash 里跑本 CLI，
 * 会话身份来自 DSH_SESSION_ID、网关来自 DSH_WEB_URL。这里连线协议信封、
 * 环境变量、退出码、错误文案一起验，跑完不烧一个 token。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createFakeHost } from './fake-host.mjs';

const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

/** 把假 host 挂成一个真的 dsh 网关（信封与上游 fetch handler 一致）。 */
async function serveFakeHost(options) {
  const host = createFakeHost(options);
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url.startsWith('/api/')) {
      res.writeHead(404).end('not found');
      return;
    }
    if ((req.headers['content-type'] ?? '').split(';')[0].trim() !== 'application/json') {
      res.writeHead(415).end('content type must be application/json');
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      const envelope = JSON.parse(body);
      const method = req.url.slice('/api/'.length);
      const reply = (result) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'server-response', rpcId: envelope.rpcId, result }));
      };
      try {
        reply({ ok: true, value: await host.handle(method, envelope.payload) });
      } catch (error) {
        reply({ ok: false, error: { code: error.code ?? 'internal', message: error.message, details: {} } });
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const api = `http://127.0.0.1:${server.address().port}/api`;
  return { host, api, close: () => new Promise((resolve) => server.close(resolve)) };
}

function runCli(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', CLI, ...args], {
      env: { ...process.env, DSH_WEB_URL: '', DSH_API: '', DSH_SESSION_ID: '', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('preview → migrate 的完整链路（CLI 进程 + HTTP 网关）', async (t) => {
  const { host, api, close } = await serveFakeHost();
  t.after(close);
  const env = { DSH_API: api, DSH_SESSION_ID: host.sourceSessionId };

  const preview = await runCli(['preview', '--to', 'code', '--json', '--poll-ms', '5'], env);
  assert.equal(preview.code, 0, preview.stderr);
  const previewed = JSON.parse(preview.stdout);
  assert.match(previewed.summary, /## 目标/);
  assert.equal(previewed.source.userMessagesTotal, 2);
  assert.equal(previewed.source.truncated, false);
  assert.ok(previewed.estimatedTokens.output > 0);
  assert.equal(readFileSync(previewed.summaryFile, 'utf8'), previewed.summary, '摘要必须落盘，供人工编辑后再迁移');
  assert.match(previewed.nextCommand, /migrate --to code/);
  assert.equal(host.state.archived.length, 1, 'preview 结束时工人已归档');

  const migrate = await runCli(['migrate', '--to', 'code', '--summary-file', previewed.summaryFile, '--json'], env);
  assert.equal(migrate.code, 0, migrate.stderr);
  const migrated = JSON.parse(migrate.stdout);
  assert.equal(migrated.agentPreset, 'code');
  assert.equal(host.state.goals.at(-1).maxGoalRounds, 1);
  const kickoff = host.state.calls.find(
    (c) => c.method === 'session.prompt' && c.payload.sessionId === migrated.sessionId,
  );
  assert.ok(kickoff.payload.content[0].text.includes('7101'));
});

test('人工编辑过的摘要会被原样采用', async (t) => {
  const { host, api, close } = await serveFakeHost();
  t.after(close);
  const env = { DSH_API: api, DSH_SESSION_ID: host.sourceSessionId };
  const preview = await runCli(['preview', '--to', 'code', '--json', '--poll-ms', '5'], env);
  const { summaryFile } = JSON.parse(preview.stdout);
  const { writeFileSync } = await import('node:fs');
  writeFileSync(summaryFile, '## 目标\n人工改过的摘要：端口其实是 7999', 'utf8');

  const migrate = await runCli(['migrate', '--to', 'code', '--summary-file', summaryFile, '--json'], env);
  assert.equal(migrate.code, 0, migrate.stderr);
  const migrated = JSON.parse(migrate.stdout);
  assert.equal(host.state.goals.at(-1).objective.includes('7999'), true, '摘要文件是唯一事实源');
  const kickoff = host.state.calls.find(
    (c) => c.method === 'session.prompt' && c.payload.sessionId === migrated.sessionId,
  );
  assert.ok(kickoff.payload.content[0].text.includes('7999'));
});

test('presets 列出可迁入模式并标出当前模式', async (t) => {
  const { host, api, close } = await serveFakeHost();
  t.after(close);
  const res = await runCli(['presets', '--json'], { DSH_API: api, DSH_SESSION_ID: host.sourceSessionId });
  assert.equal(res.code, 0, res.stderr);
  const listed = JSON.parse(res.stdout);
  assert.equal(listed.current, 'minimal');
  assert.ok(listed.presets.some((p) => p.id === 'code'));
  assert.ok(!listed.presets.some((p) => p.id === 'broken-one'), 'broken 的 preset 不该被推荐');
});

test('doctor 自检通过', async (t) => {
  const { host, api, close } = await serveFakeHost();
  t.after(close);
  const res = await runCli(['doctor', '--json'], { DSH_API: api, DSH_SESSION_ID: host.sourceSessionId });
  assert.equal(res.code, 0, res.stderr);
  const report = JSON.parse(res.stdout);
  assert.equal(report.gateway, 'ok');
  assert.equal(report.session.agentPreset, 'minimal');
});

test('run：预览 + 迁移一步到位', async (t) => {
  const { host, api, close } = await serveFakeHost();
  t.after(close);
  const res = await runCli(['run', '--to', 'standard', '--json', '--poll-ms', '5'],
    { DSH_API: api, DSH_SESSION_ID: host.sourceSessionId });
  assert.equal(res.code, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).agentPreset, 'standard');
});

test('拿不到会话 id 时给出可执行的提示，退出码 2', async (t) => {
  const { api, close } = await serveFakeHost();
  t.after(close);
  const res = await runCli(['preview', '--to', 'code'], { DSH_API: api });
  assert.equal(res.code, 2);
  assert.match(res.stderr, /DSH_SESSION_ID/);
  assert.match(res.stderr, /--session/);
});

test('缺 --to 时提示先看 presets', async (t) => {
  const { host, api, close } = await serveFakeHost();
  t.after(close);
  const res = await runCli(['migrate'], { DSH_API: api, DSH_SESSION_ID: host.sourceSessionId });
  assert.equal(res.code, 2);
  assert.match(res.stderr, /presets/);
});

test('网关连不上时说人话，退出码 1', async () => {
  const res = await runCli(['presets'], { DSH_API: 'http://127.0.0.1:1/api', DSH_SESSION_ID: 's-1' });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /dsh web/);
});

test('DSH_WEB_URL 会被用来推导网关地址', async (t) => {
  const { host, api, close } = await serveFakeHost();
  t.after(close);
  const res = await runCli(['presets', '--json'], {
    DSH_WEB_URL: api.replace(/\/api$/, ''),
    DSH_SESSION_ID: host.sourceSessionId,
  });
  assert.equal(res.code, 0, res.stderr);
  assert.ok(JSON.parse(res.stdout).presets.length > 0);
});

test('未知模式给出网关的原始理由', async (t) => {
  const { host, api, close } = await serveFakeHost();
  t.after(close);
  const preview = await runCli(['preview', '--to', 'code', '--json', '--poll-ms', '5'],
    { DSH_API: api, DSH_SESSION_ID: host.sourceSessionId });
  const { summaryFile } = JSON.parse(preview.stdout);
  const res = await runCli(['migrate', '--to', 'nope', '--summary-file', summaryFile],
    { DSH_API: api, DSH_SESSION_ID: host.sourceSessionId });
  assert.equal(res.code, 1);
  assert.match(res.stderr, /agent-preset-not-found|未知 preset/);
});

test('--help 有输出且退出码 0', async () => {
  const res = await runCli(['--help']);
  assert.equal(res.code, 0);
  assert.match(res.stdout, /dsh-bridge preview --to/);
});
