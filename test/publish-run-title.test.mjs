import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const normalizeLineEndings = source => source.replace(/\r\n/gu, '\n');
const workflow = normalizeLineEndings(readFileSync(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8'));

test('publish contract treats LF and CRLF checkouts identically', () => {
  assert.equal(normalizeLineEndings(workflow), workflow);
  assert.equal(normalizeLineEndings(workflow.replace(/\n/gu, '\r\n')), workflow);
});

test('publish run title identifies the exact release tag', () => {
  assert.deepEqual(workflow.match(/^run-name: .+$/gmu), [
    'run-name: Publish dsh-plugin-bridge ${{ github.event.release.tag_name }}',
  ]);
});

test('run metadata preserves stable release triggers and exact source checkout', () => {
  assert.match(workflow, /^on:\n  release:\n    types: \[published\]$/mu);
  assert.ok(workflow.includes('if: ${{ !github.event.release.prerelease }}'));
  assert.ok(workflow.includes('ref: ${{ github.event.release.tag_name }}'));
  assert.ok(workflow.includes('run: npm run release:check -- "${{ github.event.release.tag_name }}"'));
});

test('run metadata leaves trusted npm publishing and read-only content access intact', () => {
  assert.match(workflow, /^permissions:\n  contents: read\n  id-token: write$/mu);
  assert.ok(workflow.includes('if npm view "$package_spec" version >/dev/null 2>&1; then'));
  assert.ok(workflow.includes('npm publish --access public --provenance'));
});
