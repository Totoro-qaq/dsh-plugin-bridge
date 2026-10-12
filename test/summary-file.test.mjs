import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, lutimesSync, mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { removeOwnedSummaryFile, sameSummaryPath, SUMMARY_FILE_MAX_AGE_MS, sweepAgedSummaryFiles, writeSummaryFile } from '../src/summary-file.ts';

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
  try {
    removeOwnedSummaryFile(link);
    assert.equal(existsSync(owned), true);
    assert.equal(lstatSync(link).isSymbolicLink(), true);

    removeOwnedSummaryFile(owned);
    assert.equal(existsSync(owned), false);
  } finally {
    try { unlinkSync(link); } catch { /* 链接已随目标消失时忽略 */ }
  }
});

test('名字和位置都像临时摘要，但不是本进程写的，不会被删', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bridge-'));
  const file = join(dir, 'summary-user.md');
  writeFileSync(file, 'keep');
  removeOwnedSummaryFile(file);
  assert.equal(existsSync(file), true);
  assert.equal(sameSummaryPath(file, join(dir, '..', basename(dir), 'summary-user.md')), true);
});

test('本进程创建的摘要可以用另一条真实路径删掉', () => {
  const file = writeSummaryFile('session', 'owned');
  const dir = dirname(file);
  const alias = join(tmpdir(), `dsh-bridge-alias-${Date.now()}`);
  symlinkSync(dir, alias);
  try {
    removeOwnedSummaryFile(join(alias, basename(file)));
    assert.equal(existsSync(file), false);
    assert.equal(existsSync(dir), false);
  } finally {
    try { unlinkSync(alias); } catch { /* 目录删掉后链接仍要清掉 */ }
  }
});

test('外部删掉后又在同路径重建的文件不再算本进程的摘要', () => {
  const file = writeSummaryFile('session', 'owned');
  const dir = dirname(file);
  unlinkSync(file);
  removeOwnedSummaryFile(file);
  writeFileSync(file, 'recreated by user');
  removeOwnedSummaryFile(file);
  assert.equal(readFileSync(file, 'utf8'), 'recreated by user');
  unlinkSync(file);
  rmdirSync(dir);
});

test('超过 7 天的临时摘要会被清掉，新文件、其他名字和符号链接不动', () => {
  assert.equal(SUMMARY_FILE_MAX_AGE_MS, 7 * 24 * 60 * 60 * 1000);
  const old = writeSummaryFile('aged', 'old');
  const oldDir = dirname(old);
  const notes = join(oldDir, 'notes.md');
  writeFileSync(notes, 'keep');
  const fresh = writeSummaryFile('fresh', 'fresh');
  const linkFile = join(oldDir, 'summary-alias.md');
  symlinkSync(fresh, linkFile);
  mkdirSync(join(oldDir, 'nested'));
  const nested = join(oldDir, 'nested', 'summary-nested.md');
  writeFileSync(nested, 'nested');
  const past = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  utimesSync(old, past, past);
  utimesSync(nested, past, past);
  lutimesSync(linkFile, past, past);
  const secretDir = mkdtempSync(join(tmpdir(), 'not-bridge-'));
  const secret = join(secretDir, 'summary-secret.md');
  writeFileSync(secret, 'secret');
  utimesSync(secret, past, past);
  const linkDir = join(tmpdir(), `dsh-bridge-symlink-${Date.now()}`);
  symlinkSync(secretDir, linkDir);
  const recent = writeSummaryFile('recent', 'recent');
  const sixDays = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
  utimesSync(recent, sixDays, sixDays);
  try {
    sweepAgedSummaryFiles();
    assert.equal(existsSync(old), false);
    assert.equal(existsSync(notes), true);
    assert.equal(existsSync(fresh), true);
    assert.equal(lstatSync(linkFile).isSymbolicLink(), true);
    assert.equal(existsSync(nested), true);
    assert.equal(readFileSync(secret, 'utf8'), 'secret');
    assert.equal(existsSync(recent), true, '不到 7 天的摘要要留下');
    const empty = mkdtempSync(join(tmpdir(), 'dsh-bridge-'));
    const onlyOld = writeSummaryFile('only-old', 'only');
    utimesSync(onlyOld, past, past);
    try {
      sweepAgedSummaryFiles();
      assert.equal(existsSync(empty), true, '还没写入的空目录不能被清扫删掉');
      assert.equal(existsSync(onlyOld), false);
      assert.equal(existsSync(dirname(onlyOld)), false, '这次清掉唯一摘要后，空目录一并收掉');
    } finally {
      rmSync(empty, { recursive: true, force: true });
      rmSync(dirname(onlyOld), { recursive: true, force: true });
    }
  } finally {
    try { unlinkSync(linkFile); } catch { /* 已经不在 */ }
    try { unlinkSync(linkDir); } catch { /* 已经不在 */ }
    rmSync(secretDir, { recursive: true, force: true });
    rmSync(oldDir, { recursive: true, force: true });
    if (existsSync(fresh)) removeOwnedSummaryFile(fresh);
    if (existsSync(recent)) removeOwnedSummaryFile(recent);
  }
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
