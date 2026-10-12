import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, lutimesSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, rmdirSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import { claimSummaryFile, markSummaryDelivered, noteSummaryIdle, noteSummaryInUse, removeOwnedSummaryFile, sameSummaryPath, SUMMARY_CLAIM_STALE_MS, SUMMARY_FILE_MAX_AGE_MS, summaryAlreadyDelivered, sweepAgedSummaryFiles, writeSummaryFile } from '../src/summary-file.ts';

const skipWithoutSymlink = process.platform === 'win32';

test('摘要文件写在临时目录，迁移后只删除自己创建的那一份', () => {
  const file = writeSummaryFile('../../s-42', '## 目标\n保留');
  assert.equal(basename(file), 'summary-s-42.md');
  assert.match(basename(dirname(file)), /^dsh-bridge-/u);
  assert.equal(file.includes('..'), false);
  assert.equal(existsSync(file), true);
  const st = lstatSync(file);
  assert.equal(readFileSync(`${file}.dsh-owned`, 'utf8').trim(), `${st.dev}:${st.ino}`);
  const dir = dirname(file);

  removeOwnedSummaryFile(file);
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(dir), false);
  removeOwnedSummaryFile(file);
});

test('清理不会跟着符号链接或临时目录以外的路径走', { skip: skipWithoutSymlink }, () => {
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

test('本进程创建的摘要可以用另一条真实路径删掉', { skip: skipWithoutSymlink }, () => {
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
  const userSummary = join(oldDir, 'summary-user.md');
  writeFileSync(userSummary, 'user');
  const linkFile = join(oldDir, 'summary-alias.md');
  if (!skipWithoutSymlink) symlinkSync(fresh, linkFile);
  mkdirSync(join(oldDir, 'nested'));
  const nested = join(oldDir, 'nested', 'summary-nested.md');
  writeFileSync(nested, 'nested');
  const past = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  utimesSync(old, past, past);
  utimesSync(userSummary, past, past);
  utimesSync(nested, past, past);
  if (!skipWithoutSymlink) lutimesSync(linkFile, past, past);
  const secretDir = mkdtempSync(join(tmpdir(), 'not-bridge-'));
  const secret = join(secretDir, 'summary-secret.md');
  writeFileSync(secret, 'secret');
  utimesSync(secret, past, past);
  const linkDir = join(tmpdir(), `dsh-bridge-symlink-${Date.now()}`);
  if (!skipWithoutSymlink) symlinkSync(secretDir, linkDir);
  const recent = writeSummaryFile('recent', 'recent');
  const sixDays = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
  utimesSync(recent, sixDays, sixDays);
  try {
    sweepAgedSummaryFiles();
    assert.equal(existsSync(old), false);
    assert.equal(existsSync(`${old}.dsh-owned`), false);
    assert.equal(readFileSync(userSummary, 'utf8'), 'user');
    assert.equal(existsSync(notes), true);
    assert.equal(existsSync(fresh), true);
    if (!skipWithoutSymlink) assert.equal(lstatSync(linkFile).isSymbolicLink(), true);
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
    if (!skipWithoutSymlink) {
      try { unlinkSync(linkFile); } catch { /* 已经不在 */ }
      try { unlinkSync(linkDir); } catch { /* 已经不在 */ }
    }
    rmSync(secretDir, { recursive: true, force: true });
    rmSync(oldDir, { recursive: true, force: true });
    if (existsSync(fresh)) removeOwnedSummaryFile(fresh);
    if (existsSync(recent)) removeOwnedSummaryFile(recent);
  }
});

test('父目录被换成符号链接后，不会删到对面的同名文件', { skip: skipWithoutSymlink }, () => {
  const file = writeSummaryFile('session', 'owned');
  const dir = dirname(file);
  const name = basename(file);
  const other = mkdtempSync(join(tmpdir(), 'dsh-bridge-'));
  const precious = join(other, name);
  writeFileSync(precious, 'keep');
  const moved = `${dir}-real`;
  renameSync(dir, moved);
  const alias = dir;
  symlinkSync(other, alias);
  try {
    removeOwnedSummaryFile(join(alias, name));
    assert.equal(readFileSync(precious, 'utf8'), 'keep');
    assert.equal(readFileSync(join(moved, name), 'utf8'), 'owned');
  } finally {
    try { unlinkSync(alias); } catch { /* 链接已不在 */ }
    rmSync(moved, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test('暂时没有权限时不会忘掉登记，权限恢复后仍能删掉自己的摘要', { skip: process.platform === 'win32' }, () => {
  const file = writeSummaryFile('session', 'secret');
  const dir = dirname(file);
  chmodSync(dir, 0);
  try {
    removeOwnedSummaryFile(file);
    sweepAgedSummaryFiles(0);
  } finally {
    chmodSync(dir, 0o700);
  }
  assert.equal(readFileSync(file, 'utf8'), 'secret');
  removeOwnedSummaryFile(file);
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(dir), false);
});

test('7 天清扫会跳过这次调用明确保留的摘要', () => {
  const used = writeSummaryFile('used', 'used');
  const other = writeSummaryFile('other', 'other');
  const past = new Date(Date.now() - 5_000);
  utimesSync(used, past, past);
  utimesSync(other, past, past);
  try {
    sweepAgedSummaryFiles(1_000, Date.now(), used);
    assert.equal(readFileSync(used, 'utf8'), 'used');
    assert.equal(existsSync(other), false);
  } finally {
    if (existsSync(used)) removeOwnedSummaryFile(used);
    rmSync(dirname(other), { recursive: true, force: true });
  }
});

test('正在读取的超龄摘要不会被清扫删掉', () => {
  const held = writeSummaryFile('held', 'held');
  const idle = writeSummaryFile('idle', 'idle');
  const past = new Date(Date.now() - 10_000);
  utimesSync(held, past, past);
  utimesSync(idle, past, past);
  noteSummaryInUse(held);
  try {
    sweepAgedSummaryFiles(1_000);
    assert.equal(readFileSync(held, 'utf8'), 'held');
    assert.equal(existsSync(idle), false);
  } finally {
    noteSummaryIdle(held);
    if (existsSync(held)) removeOwnedSummaryFile(held);
    rmSync(dirname(idle), { recursive: true, force: true });
  }
});

test('新进程只清掉带所有权标记、且没人占用的超龄摘要', () => {
  const privateTmp = mkdtempSync(join(tmpdir(), 'dsh-sweep-fresh-'));
  const ownedDir = mkdtempSync(join(privateTmp, 'dsh-bridge-'));
  const heldDir = mkdtempSync(join(privateTmp, 'dsh-bridge-'));
  const userDir = mkdtempSync(join(privateTmp, 'dsh-bridge-'));
  const owned = join(ownedDir, 'summary-owned.md');
  const held = join(heldDir, 'summary-held.md');
  const user = join(userDir, 'summary-user.md');
  writeFileSync(owned, 'owned');
  writeFileSync(held, 'held');
  writeFileSync(user, 'user');
  for (const file of [owned, held]) {
    const st = lstatSync(file);
    writeFileSync(`${file}.dsh-owned`, `${st.dev}:${st.ino}`);
  }
  const past = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  utimesSync(owned, past, past);
  utimesSync(held, past, past);
  utimesSync(user, past, past);
  const script = fileURLToPath(new URL('./sweep-fresh.mjs', import.meta.url));
  try {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', script, held], {
      encoding: 'utf8',
      env: { ...process.env, TMPDIR: privateTmp, TMP: privateTmp, TEMP: privateTmp },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(owned), false);
    assert.equal(readFileSync(held, 'utf8'), 'held');
    assert.equal(readFileSync(user, 'utf8'), 'user');
  } finally {
    rmSync(privateTmp, { recursive: true, force: true });
  }
});

test('Windows 上不同分隔符指向同一份摘要', { skip: process.platform !== 'win32' }, () => {
  const file = writeSummaryFile('session', 'owned');
  try {
    assert.equal(sameSummaryPath(file, file.replaceAll('\\', '/')), true);
  } finally {
    removeOwnedSummaryFile(file);
  }
});

function runIsolated(name, args = []) {
  const script = fileURLToPath(new URL(`./${name}`, import.meta.url));
  return spawnSync(process.execPath, ['--experimental-strip-types', ...args, script], { encoding: 'utf8' });
}

test('登记时 lstat 失败，已经写好的摘要仍然算保存成功', () => {
  const result = runIsolated('remember-lstat.mjs', ['--experimental-test-module-mocks']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('同一份摘要的磁盘认领是独占的，放开之后才能再领', () => {
  const file = writeSummaryFile('claim', 'claim');
  const first = claimSummaryFile(file);
  try {
    assert.equal(typeof first, 'object');
    assert.equal(claimSummaryFile(file), 'busy');
    first.release();
    const second = claimSummaryFile(file);
    assert.equal(typeof second, 'object');
    second.release();
    assert.equal(summaryAlreadyDelivered(file), false);
  } finally {
    if (typeof first !== 'string') first.release();
    removeOwnedSummaryFile(file);
  }
});

test('送达把占位改成已交付标记，保留标记会挡住别的进程但不是已交付', () => {
  const delivered = writeSummaryFile('done', 'done');
  const held = writeSummaryFile('held', 'held');
  try {
    const done = claimSummaryFile(delivered);
    assert.equal(typeof done, 'object');
    done.complete();
    assert.equal(summaryAlreadyDelivered(delivered), true);
    assert.equal(claimSummaryFile(delivered), 'delivered');
    const seal = claimSummaryFile(held);
    assert.equal(typeof seal, 'object');
    seal.seal();
    assert.equal(summaryAlreadyDelivered(held), false);
    assert.equal(claimSummaryFile(held), 'delivered');
  } finally {
    removeOwnedSummaryFile(delivered);
    removeOwnedSummaryFile(held);
  }
});

test('过期的占位可以被另一个认领接手', () => {
  const file = writeSummaryFile('stale', 'stale');
  const stale = claimSummaryFile(file, Date.now() - SUMMARY_CLAIM_STALE_MS - 1_000);
  try {
    assert.equal(typeof stale, 'object');
    const next = claimSummaryFile(file);
    assert.equal(typeof next, 'object');
    stale.release();
    next.release();
    const again = claimSummaryFile(file);
    assert.equal(typeof again, 'object');
    again.release();
  } finally {
    if (typeof stale !== 'string') stale.release();
    removeOwnedSummaryFile(file);
  }
});

test('符号链接占位不会被当成可接手的锁', { skip: skipWithoutSymlink }, () => {
  const file = writeSummaryFile('link', 'link');
  const marker = join(realpathSync(tmpdir()), 'dsh-bridge-delivered', createHash('sha256').update(resolve(file)).digest('hex'));
  const target = writeSummaryFile('link-target', 'keep');
  try {
    mkdirSync(dirname(marker), { recursive: true });
    if (existsSync(marker)) unlinkSync(marker);
    symlinkSync(target, marker);
    assert.equal(claimSummaryFile(file), 'busy');
    assert.equal(readFileSync(target, 'utf8'), 'keep');
  } finally {
    if (existsSync(marker)) unlinkSync(marker);
    removeOwnedSummaryFile(file);
    removeOwnedSummaryFile(target);
  }
});

test('锁目录不是真实目录时，认领失败关闭', () => {
  const result = runIsolated('isolated-unavailable.mjs');
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('未过期的交接占位和已保留标记不会被 7 天清扫删掉，已送达的超龄文件仍会删', () => {
  const claimed = writeSummaryFile('claimed', 'claimed');
  const sealed = writeSummaryFile('sealed', 'sealed');
  const done = writeSummaryFile('delivered', 'delivered');
  const past = new Date(Date.now() - 10_000);
  utimesSync(claimed, past, past);
  utimesSync(sealed, past, past);
  utimesSync(done, past, past);
  const claim = claimSummaryFile(claimed);
  const seal = claimSummaryFile(sealed);
  const finished = claimSummaryFile(done);
  try {
    assert.equal(typeof claim, 'object');
    assert.equal(typeof seal, 'object');
    assert.equal(typeof finished, 'object');
    seal.seal();
    finished.complete();
    sweepAgedSummaryFiles(1_000);
    assert.equal(readFileSync(claimed, 'utf8'), 'claimed');
    assert.equal(readFileSync(sealed, 'utf8'), 'sealed');
    assert.equal(existsSync(done), false);
    claim.release();
    sweepAgedSummaryFiles(1_000);
    assert.equal(existsSync(claimed), false);
  } finally {
    if (typeof claim === 'object') claim.release();
    if (existsSync(sealed)) removeOwnedSummaryFile(sealed);
    rmSync(dirname(claimed), { recursive: true, force: true });
    rmSync(dirname(done), { recursive: true, force: true });
  }
});

test('清扫别的文件时不会删掉还新鲜的交接占位', () => {
  const file = writeSummaryFile('prune', 'prune');
  const other = join(dirname(file), 'summary-other.md');
  writeFileSync(other, 'other');
  const claim = claimSummaryFile(file);
  try {
    assert.equal(typeof claim, 'object');
    markSummaryDelivered(other);
    assert.equal(claimSummaryFile(file), 'busy');
  } finally {
    if (typeof claim === 'object') claim.release();
    removeOwnedSummaryFile(file);
    rmSync(dirname(file), { recursive: true, force: true });
  }
});

test('别的进程的清扫不会删掉这份进程正在读的摘要', () => {
  const result = runIsolated('isolated-lease.mjs');
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('另一个进程领不到已经被占住的摘要', () => {
  const result = runIsolated('isolated-claim.mjs');
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('用户另存的普通文件即使放在临时目录里也不会被删', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bridge-user-'));
  const file = join(dir, 'notes.md');
  writeFileSync(file, 'keep');
  removeOwnedSummaryFile(file);
  assert.equal(existsSync(file), true);
  removeOwnedSummaryFile(process.execPath);
  assert.equal(existsSync(process.execPath), true);
});
