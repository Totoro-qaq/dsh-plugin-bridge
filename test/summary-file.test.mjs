import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { removeOwnedSummaryFile, writeSummaryFile } from '../src/summary-file.ts';

test('摘要文件写在临时目录，迁移后只删除自己创建的那一份', () => {
  const file = writeSummaryFile('../../s-42', '## 目标\n保留');
  assert.match(file, /\/dsh-bridge-[^/]+\/summary-s-42\.md$/u);
  assert.equal(file.includes('..'), false);
  assert.equal(existsSync(file), true);
  const dir = file.slice(0, file.lastIndexOf('/'));

  removeOwnedSummaryFile(file);
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(dir), false);
  removeOwnedSummaryFile(file);
});

test('清理不会跟着符号链接或临时目录以外的路径走', () => {
  const outside = join(tmpdir(), `dsh-bridge-not-a-dir-${Date.now()}.md`);
  writeFileSync(outside, 'keep');
  removeOwnedSummaryFile(outside);
  assert.equal(existsSync(outside), true);

  const owned = writeSummaryFile('session', 'owned');
  const link = `${owned}.link`;
  symlinkSync(owned, link);
  removeOwnedSummaryFile(link);
  assert.equal(existsSync(owned), true);
  assert.equal(lstatSync(link).isSymbolicLink(), true);

  removeOwnedSummaryFile(owned);
  assert.equal(existsSync(owned), false);
});

test('用户另存的普通文件即使放在临时目录里也不会被删', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bridge-user-'));
  const file = join(dir, 'notes.md');
  writeFileSync(file, 'keep');
  removeOwnedSummaryFile(file);
  assert.equal(existsSync(file), true);
  removeOwnedSummaryFile('/etc/hosts');
  assert.equal(existsSync('/etc/hosts'), true);
});
