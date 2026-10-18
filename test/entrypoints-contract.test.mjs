import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

for (const name of ['shortcuts', 'ui-layout', 'ui-tool', 'ui-commands', 'ui-workspace']) {
  const packageName = `@deepseek-ai/dsh-client-${name}`;
  test(`entrypoint SDK ${packageName} is pinned for development and optional at runtime`, async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(manifest.devDependencies[packageName], '0.2.1-alpha.4');
    assert.equal(manifest.peerDependencies[packageName], '*');
    assert.deepEqual(manifest.peerDependenciesMeta[packageName], { optional: true });
    assert.equal(manifest.dependencies[packageName], undefined);
    assert.equal(manifest.dsh.client.inject.includes(packageName), false,
      'optional entrypoints must not make the entire client depend on new services');
    const installed = JSON.parse(await readFile(new URL(`../node_modules/${packageName}/package.json`, import.meta.url), 'utf8'));
    assert.equal(installed.version, manifest.devDependencies[packageName]);
  });
}

for (const file of ['README.md', 'README.zh.md']) {
  test(`${file} documents all three entrypoints without promising zero NL overhead`, async () => {
    const text = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(text.includes('bridge_prepare'), 'name the native model tool');
    assert.ok(text.includes('dsh-plugin-bridge.open'), 'name the host-configurable shortcut command');
    assert.ok(text.includes('naturalLanguage'), 'document the opt-out for model tool registration');
    assert.match(text, /unbound|未绑定/u);
    assert.match(text, /tool-description|工具描述/u);
    assert.match(text, /human confirmation|人工确认/u);
    assert.doesNotMatch(text, /Installing Bridge adds \*\*zero prompt tokens\*\*|它是 host slash command，不是模型工具或 skill/u,
      'the new default must not inherit the former command-only token promise');
    assert.ok(text.includes('docs/entrypoints.md'));
  });
}
