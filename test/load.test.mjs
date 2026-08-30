/**
 * 插件加载冒烟测试：dsh 以 npm 包形式加载 lib/index.js，
 * 这里验证同一条路径——入口导出形状、Config schema、apply() 注册的命令，
 * 以及在真实 cordis Context 里完成加载 / 依赖不满足时正确挂起。
 * 注意：npm test 先跑 build，本文件测的是 lib/ 构建产物（即 dsh 实际加载物）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Context } from '@deepseek-ai/cordis';

import plugin, { name, inject, Config, apply, commandConfigOf } from '../lib/index.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 收集一次 apply() 注册的命令。 */
function register(config = Config({})) {
  const registered = [];
  const ctx = {
    apiProxy: { sessions: {}, workspace: {}, goals: {}, agentPresets: {} },
    commands: { register: (definition) => { registered.push(definition); return () => {}; } },
  };
  apply(ctx, config);
  assert.equal(registered.length, 1);
  return registered[0];
}

test('入口导出形状符合 cordis 插件约定', () => {
  assert.equal(name, 'dsh-plugin-bridge');
  assert.equal(typeof apply, 'function');
  assert.ok(Config, 'Config schema 必须导出（cordis.patch.yml 依赖它校验配置）');
  assert.deepEqual(
    { name: plugin.name, inject: plugin.inject, hasApply: typeof plugin.apply, hasConfig: Boolean(plugin.Config) },
    { name, inject, hasApply: 'function', hasConfig: true },
  );
});

test('inject 只锁定跨版本入口，host adapter 在调用时选择', () => {
  assert.deepEqual([...inject], ['commands']);
});

test('注册的是一个 /bridge 命令，不是技能', () => {
  const command = register();
  assert.equal(command.name, 'bridge');
  assert.ok(command.description.length > 10, 'description 会出现在命令发现 UI 里');
  assert.equal(typeof command.handler, 'function');
  assert.ok(command.input?.hint, '应当给出输入提示');
});

test('包里不再有 skills/：上游没有任何插件用 ctx.skills.register 交付功能', () => {
  assert.ok(!existsSync(join(packageRoot, 'skills')));
});

test('CLI 仍然可用（手动 / 脚本路径），且能直接执行', () => {
  const cli = join(packageRoot, 'lib', 'cli.js');
  assert.ok(existsSync(cli));
  assert.ok(readFileSync(cli, 'utf8').startsWith('#!/usr/bin/env node'), 'CLI 需要 shebang 才能作为 bin 直接执行');
});

test('BridgeHost 作为独立子路径对 adapter 作者可用', async () => {
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.exports['./host'].default, './lib/host.js');
  const host = await import('../lib/host.js');
  assert.equal(typeof host.createBridgeHostFromRpc, 'function');
  assert.equal(typeof host.probeBridgeHost, 'function');
  assert.equal(host.REQUIRED_BRIDGE_CAPABILITIES.length, 13);
});

test('Config：空配置给默认值，且与压缩核心常量一致', async () => {
  const { SOURCE_CHAR_BUDGET, SUMMARY_CHAR_BUDGET } = await import('../lib/compression.js');
  const resolved = Config({});
  assert.equal(resolved.modelTier, 'pro', '默认档位必须是 pro');
  assert.equal(resolved.sourceCharBudget, SOURCE_CHAR_BUDGET);
  assert.equal(resolved.summaryCharBudget, SUMMARY_CHAR_BUDGET);
  assert.equal(resolved.goalRounds, 1, '上游 goal.create 默认 256 轮自主循环，交接只需要一轮');
  assert.equal(resolved.inject, 'both');
  assert.equal(resolved.lang, 'auto');
  assert.ok(resolved.previewTimeoutMs > 0);
});

test('Config：接受合法覆盖，拒绝非法值', () => {
  const custom = Config({ modelTier: 'flash', sourceCharBudget: 10_000, goalRounds: 3 });
  assert.equal(custom.modelTier, 'flash');
  assert.equal(custom.sourceCharBudget, 10_000);
  assert.equal(custom.goalRounds, 3);
  assert.throws(() => Config({ modelTier: 'ultra' }), /modelTier|union/i);
  assert.throws(() => Config({ inject: 'telepathy' }), /inject|union/i);
});

test('配置真的会传到命令层（0.1 里这些键完全没人消费）', () => {
  const resolved = commandConfigOf(Config({ modelTier: 'flash', goalRounds: 7, workerModel: 'x', workerProvider: 'y' }));
  assert.equal(resolved.modelTier, 'flash');
  assert.equal(resolved.goalRounds, 7);
  assert.equal(resolved.workerModel, 'x');
  assert.equal(commandConfigOf().goalRounds, 1, '空配置也要有可用默认值');
});

test('dsh.bundle 激活声明存在且指向真实 patch 文件（dsh plugin add 的激活条件）', async () => {
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const patch = manifest.dsh?.bundle?.patch;
  assert.equal(typeof patch, 'string', 'package.json 必须声明 dsh.bundle.patch，否则 dsh 不会激活本插件');
  assert.ok(existsSync(join(packageRoot, patch)), `${patch} 不存在`);
  assert.ok(manifest.files.includes('cordis.patch.yml'), 'files 必须包含 cordis.patch.yml');
  assert.equal(manifest.bin['dsh-bridge'], 'lib/cli.js');
});

test('同一个包声明官方 WebUI client half，并交付可加载的原生卡片 bundle', async () => {
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.dsh?.client?.platform, 'web');
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-conversation'));
  assert.equal(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'), false,
    'alpha 已删除 client-runtime；WebUI 自己提供 sessions 服务，插件不应锁死旧包名');
  assert.equal(manifest.exports['./client'].default, './lib/client.js');
  assert.deepEqual(manifest.exports['./client-contract'], {
    types: './lib/client-contract.d.ts',
    default: './lib/client-contract.js',
  }, '自研 UI 应能复用无 React 的 Bridge 编辑 contract');

  const client = await readFile(join(packageRoot, 'lib', 'client.js'), 'utf8');
  assert.match(client, /window\.__ModuleLoader__\.load\(\{\s*id:\s*["']dsh-plugin-bridge["']/u);
  assert.match(client, /conversation\.chat\.commandview/u);
  assert.match(client, /MarkdownText/u);
  assert.match(client, /JsonTree/u);
  assert.match(client, /TextHandoffEditor/u, '普通用户应获得分段文本编辑器');
  assert.match(client, /BridgeCardBoundary/u, 'Bridge 卡片异常必须隔离在自身边界内');
  assert.match(client, /opaqueSuffix/u, '文本模式必须只读保留五段之后的附录');
  assert.match(client, /dsh-bridge-panel/u, '长内容必须在 Bridge 卡片内部滚动');
  assert.match(client, /dsh-bridge-markdown-editor/u, 'Markdown 高级编辑入口必须保留');
  assert.match(client, /light-dark\(/u, '官方主题 token 缺席时也必须跟随页面 color-scheme');
  assert.match(client, /["']remote["']\s*,\s*["']remote\.commands["']/u,
    'rc.2 对父 remote face 与 commands capability 分别做注入校验');
  assert.match(client, /commands\.execute\(sessionId,\s*line,\s*\[\]\)/u,
    'rc.2 的 command.execute wire contract 要求显式传空图片数组');
  assert.match(client, /document\.documentElement\.lang/u,
    '执行中应读取官方 WebUI 文档语言，而不是把中英文硬拼在一起');
  assert.doesNotMatch(client, /Preparing editable handoff · 正在生成可编辑交接/u);
  assert.doesNotMatch(client, /^import\s/mu, 'client half 必须是浏览器模块表可加载的自注册 bundle');
});

test('alpha.2 依赖声明不再引用已移除的 client-runtime', async () => {
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const alphaClientPackages = [
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-client-ui-chat',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-primitives',
    '@deepseek-ai/dsh-client-ui-slots',
  ];

  for (const packageName of alphaClientPackages) {
    assert.match(
      manifest.peerDependencies[packageName],
      /\^0\.1\.2-alpha\.1/u,
      `${packageName} 的 peer range 必须覆盖已验证的 0.1.2 alpha 系列`,
    );
    assert.equal(
      manifest.devDependencies[packageName],
      '^0.1.2-alpha.2',
      `${packageName} 的本地构建应锁定当前官方 alpha.2`,
    );
  }
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-client-runtime'], undefined);
  assert.equal(manifest.peerDependenciesMeta['@deepseek-ai/dsh-client-runtime'], undefined);
  assert.equal(manifest.devDependencies['@deepseek-ai/dsh-client-runtime'], undefined);
  assert.deepEqual(
    manifest.peerDependenciesMeta['@deepseek-ai/cordis'],
    { optional: true },
    'Cordis 由 DSH bundle 提供，profile 不应收到缺失 peer 假警告',
  );
  assert.equal(manifest.devDependencies['@deepseek-ai/cordis'], '4.0.2');
  for (const packageName of [
    '@deepseek-ai/dsh-api-session-controller',
    '@deepseek-ai/dsh-client-ui-renderer',
    '@deepseek-ai/dsh-client-ui-session',
  ]) {
    assert.equal(
      manifest.devDependencies[packageName],
      '^0.1.2-alpha.2',
      `${packageName} 必须提供 alpha.2 拆分后的客户端类型契约`,
    );
  }
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-chat'));

  const [clientSource, bundlerConfig] = await Promise.all([
    readFile(join(packageRoot, 'src', 'client.tsx'), 'utf8'),
    readFile(join(packageRoot, 'tsdown.config.ts'), 'utf8'),
  ]);
  assert.doesNotMatch(clientSource, /dsh-client-runtime/u);
  assert.match(clientSource, /SessionId[^\n]+dsh-api-remotes\/client/u);
  assert.match(clientSource, /CommandRowProps[^\n]+dsh-client-ui-chat\/client/u);
  assert.doesNotMatch(bundlerConfig, /dsh-client-runtime/u);
});

test('cordis.patch.yml 的 insert 行指向本包，且配置键与 Config schema 一一对应', async () => {
  const text = await readFile(join(packageRoot, 'cordis.patch.yml'), 'utf8');
  assert.match(text, /^- insert:/m, 'patch 必须含 insert 列表');
  const insertBlock = text.slice(text.indexOf('- insert:'));
  assert.match(insertBlock, /- id: \S+/);
  assert.match(insertBlock, new RegExp(`name: ${name.replaceAll('-', '\\-')}\\b`), 'insert 行的 name 必须是本包名');
  for (const key of Object.keys(Config({}))) {
    assert.ok(insertBlock.includes(`${key}:`), `patch config 缺 ${key}`);
  }
});

test('真实 cordis Context：inject 满足后完成加载并注册命令', async () => {
  const registered = [];
  const ctx = new Context();
  ctx.provide('commands', { register: (definition) => { registered.push(definition); return () => {}; } });
  ctx.provide('apiProxy', { sessions: {}, workspace: {}, goals: {}, agentPresets: {} });
  const fiber = await ctx.plugin(plugin, {});
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, 'bridge');
  // 卸载由 cordis 的 effect 作用域负责（commands.register 返回的就是那个
  // disposer），所以 dsh plugin remove + 重启之后命令不会残留。
  await fiber.dispose();
});

test('真实 cordis Context：没有 apiProxy 时仍注册命令，交给 alpha adapter 在调用时解析', async () => {
  const registered = [];
  const ctx = new Context();
  ctx.provide('commands', { register: (definition) => { registered.push(definition); return () => {}; } });
  const fiber = ctx.plugin(plugin, {});
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(registered.length, 1);
  await fiber.dispose();
});

test('真实 cordis Context：缺 commands 时挂起', async () => {
  const ctx = new Context();
  ctx.provide('apiProxy', { sessions: {}, workspace: {}, goals: {}, agentPresets: {} });
  const fiber = ctx.plugin(plugin, {});
  await new Promise((r) => setTimeout(r, 50));
  await fiber.dispose();
});
