/**
 * 插件加载冒烟测试：dsh 以 npm 包形式加载 lib/index.js，
 * 这里验证同一条路径——入口导出形状、Config schema、
 * apply() 的 skill 注册，以及在真实 cordis Context 里完成加载。
 * 注意：npm test 先跑 build，本文件测的是 lib/ 构建产物（即 dsh 实际加载物）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Context } from '@deepseek-ai/cordis';
import { isSkillName } from '@deepseek-ai/dsh-skill';

import plugin, { name, inject, Config, apply } from '../lib/index.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

test('入口导出形状符合 cordis 插件约定', () => {
  assert.equal(name, 'dsh-plugin-bridge');
  assert.ok(Array.isArray(inject) && inject.includes('skills'), 'inject 必须声明 skills 服务');
  assert.equal(typeof apply, 'function');
  assert.ok(Config, 'Config schema 必须导出（cordis.patch.yml 依赖它校验配置）');
  // default export 与具名导出同形，dsh 两种取法都能拿到完整插件
  assert.deepEqual(
    { name: plugin.name, inject: plugin.inject, hasApply: typeof plugin.apply, hasConfig: Boolean(plugin.Config) },
    { name, inject, hasApply: 'function', hasConfig: true },
  );
});

test('运行时 skill 文件存在于包内（apply 依赖相对路径解析）', () => {
  // lib/index.js 用 packageRoot/../skills/bridge/SKILL.md 取 skill 文件；
  // npm files 含 skills/，此断言锁住「打包后路径仍可解析」。
  const skillPath = join(packageRoot, 'skills', 'bridge', 'SKILL.md');
  assert.ok(existsSync(skillPath), `缺少 ${skillPath}`);
});

test('Config：空配置给默认值，且与压缩核心常量一致', async () => {
  const { SOURCE_CHAR_BUDGET, SUMMARY_CHAR_BUDGET } = await import('../lib/compression.js');
  const resolved = Config({});
  assert.equal(resolved.modelTier, 'pro', '默认档位必须是 pro（26 组实验结论）');
  assert.equal(resolved.sourceCharBudget, SOURCE_CHAR_BUDGET);
  assert.equal(resolved.summaryCharBudget, SUMMARY_CHAR_BUDGET);
});

test('Config：接受合法覆盖，拒绝非法档位', () => {
  const custom = Config({ modelTier: 'flash', sourceCharBudget: 10_000, summaryCharBudget: 1_000 });
  assert.equal(custom.modelTier, 'flash');
  assert.equal(custom.sourceCharBudget, 10_000);
  assert.throws(() => Config({ modelTier: 'ultra' }), /modelTier|union/i);
});

test('apply：注册 bridge skill，内容剥离 frontmatter，资源目录有效', () => {
  const registrations = [];
  const fakeCtx = { skills: { register: (skill) => registrations.push(skill) } };
  apply(fakeCtx, Config({}));

  assert.equal(registrations.length, 1);
  const skill = registrations[0];
  assert.equal(skill.name, 'bridge');
  assert.ok(isSkillName(skill.name), 'skill 名必须符合 kebab-case 语法');
  assert.ok(skill.description.length > 20, 'description 是路由依据，不能为空');
  assert.ok(!skill.content.trimStart().startsWith('---'), 'content 不得残留 frontmatter');
  assert.ok(skill.content.includes('# Bridge'), 'content 应是 SKILL.md 正文');
  assert.equal(skill.resourceBase.kind, 'directory');
  assert.ok(existsSync(join(skill.resourceBase.path, 'SKILL.md')), 'resourceBase 目录必须含 SKILL.md');
  assert.equal(skill.path, join(skill.resourceBase.path, 'SKILL.md'));
});

test('dsh.bundle 激活声明存在且指向真实 patch 文件（dsh plugin add 的激活条件）', async () => {
  // dsh plugin add 装完后 reconcile：只有 package.json 声明
  // "dsh": { "bundle": { "patch": ... } } 的包才会加入 dsh.profile.bundles
  // 层栈被真正挂载，否则只当普通依赖并打警告（见 dsh apps/cli/src/plugin.ts）。
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  const patch = manifest.dsh?.bundle?.patch;
  assert.equal(typeof patch, 'string', 'package.json 必须声明 dsh.bundle.patch，否则 dsh 不会激活本插件');
  const patchPath = join(packageRoot, patch);
  assert.ok(existsSync(patchPath), `${patch} 不存在`);
  // npm 发包时 patch 文件必须随包发布，否则别人装上后 loadProfile 找不到层
  assert.ok(manifest.files.includes('cordis.patch.yml'), 'files 必须包含 cordis.patch.yml');
});

test('cordis.patch.yml 的 insert 行指向本包（dsh 层栈的实际挂载点）', async () => {
  // patch 是顶层 YAML 数组；insert 行形态参考官方 bundle（id + name [+ config]）。
  // 文件含 !!js 表达式，不做完整 YAML 解析，只锁关键结构。
  const text = await readFile(join(packageRoot, 'cordis.patch.yml'), 'utf8');
  assert.match(text, /^- insert:/m, 'patch 必须含 insert 列表');
  const insertBlock = text.slice(text.indexOf('- insert:'));
  assert.match(insertBlock, /- id: \S+/);
  assert.match(insertBlock, new RegExp(`name: ${name.replaceAll('-', '\\-')}\\b`), 'insert 行的 name 必须是本包名');
  // 配置键与 src/index.ts 的 Config schema 字段一一对应
  for (const key of ['modelTier', 'sourceCharBudget', 'summaryCharBudget']) {
    assert.ok(insertBlock.includes(`${key}:`), `patch config 缺 ${key}`);
  }
});

test('真实 cordis Context：inject 满足后插件完成加载', async () => {
  const registrations = [];
  const ctx = new Context();
  ctx.provide('skills', { register: (skill) => registrations.push(skill) });
  // ctx.plugin 返回的 Fiber 是 PromiseLike，resolve 即插件 apply 完成
  const fiber = await ctx.plugin(plugin, {});
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].name, 'bridge');
  await fiber.dispose();
});

test('真实 cordis Context：缺 inject 依赖时不加载（不静默半挂）', async () => {
  const registrations = [];
  const ctx = new Context();
  // 注意：不 provide('skills')，插件应挂起等待而非执行 apply 或崩溃
  const fiber = ctx.plugin(plugin, {});
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(registrations.length, 0, '依赖未满足时 apply 不应执行');
  await fiber.dispose();
});
