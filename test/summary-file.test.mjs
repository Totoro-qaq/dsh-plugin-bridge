import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

import { claimSummaryFile, removeOwnedSummaryFile, sameSummaryPath, SUMMARY_CLAIM_STALE_MS, summaryPathKey, writeSummaryFile } from '../src/summary-file.ts';

const skipWithoutSymlink = process.platform === 'win32';
const HOST_ID = createHash('sha256').update(hostname()).digest('hex').slice(0, 12);
const CLAIM_DIR = `dsh-bridge-claims${typeof process.getuid === 'function' ? `-${process.getuid()}` : ''}`;

function recordPath(file) {
  const dir = join(realpathSync(tmpdir()), CLAIM_DIR);
  mkdirSync(dir, { recursive: true });
  return join(dir, createHash('sha256').update(summaryPathKey(file)).digest('hex'));
}

function uniqueFile(label) {
  return join(tmpdir(), `dsh-claim-${label}-${randomBytes(6).toString('hex')}.md`);
}

function runScript(name, args = [], nodeArgs = []) {
  const script = fileURLToPath(new URL(`./${name}`, import.meta.url));
  return spawnSync(process.execPath, ['--experimental-strip-types', ...nodeArgs, script, ...args], { encoding: 'utf8' });
}

test('摘要文件写在临时目录，迁移后只删除自己创建的那一份', () => {
  const file = writeSummaryFile('../../s-42', '## 目标\n保留');
  assert.equal(basename(file), 'summary-s-42.md');
  assert.match(basename(dirname(file)), /^dsh-bridge-/u);
  assert.equal(file.includes('..'), false);
  assert.equal(existsSync(file), true);
  const dir = dirname(file);

  removeOwnedSummaryFile(file);
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(dir), false);
  removeOwnedSummaryFile(file);
});

test('经符号链接清理时删的是登记过的真实文件，链接本身留下', { skip: skipWithoutSymlink }, () => {
  const owned = writeSummaryFile('session', 'owned');
  const link = `${owned}.link`;
  symlinkSync(owned, link);
  try {
    removeOwnedSummaryFile(link);
    assert.equal(existsSync(owned), false, '链接解析到登记过的真实文件，删的是那一份');
    assert.equal(lstatSync(link).isSymbolicLink(), true, '链接本身留下');
  } finally {
    try { unlinkSync(link); } catch { /* 已经不在 */ }
    rmSync(dirname(owned), { recursive: true, force: true });
  }
});

test('名字和位置都像临时摘要，但不是本进程写的，不会被删', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-bridge-'));
  const file = join(dir, 'summary-user.md');
  writeFileSync(file, 'keep');
  removeOwnedSummaryFile(file);
  assert.equal(existsSync(file), true);
  assert.equal(sameSummaryPath(file, join(dir, '..', basename(dir), 'summary-user.md')), true);
  rmSync(dir, { recursive: true, force: true });
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

test('用户改过内容的摘要归用户所有，不会被删', () => {
  const file = writeSummaryFile('edited', '## 目标\n原稿');
  writeFileSync(file, '## 目标\n用户改了半小时的稿子');
  removeOwnedSummaryFile(file);
  assert.equal(readFileSync(file, 'utf8'), '## 目标\n用户改了半小时的稿子');
  removeOwnedSummaryFile(file);
  assert.equal(existsSync(file), true, '改过一次之后不再登记，之后也不会删');
  rmSync(dirname(file), { recursive: true, force: true });
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

test('父目录被换成符号链接后，不会删到对面的同名文件', { skip: skipWithoutSymlink }, () => {
  const file = writeSummaryFile('session', 'owned');
  const dir = dirname(file);
  const name = basename(file);
  const other = mkdtempSync(join(tmpdir(), 'dsh-bridge-'));
  const precious = join(other, name);
  writeFileSync(precious, 'keep');
  const moved = `${dir}-real`;
  renameSync(dir, moved);
  symlinkSync(other, dir);
  try {
    removeOwnedSummaryFile(join(dir, name));
    assert.equal(readFileSync(precious, 'utf8'), 'keep');
    assert.equal(readFileSync(join(moved, name), 'utf8'), 'owned');
  } finally {
    try { unlinkSync(dir); } catch { /* 链接已不在 */ }
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
  } finally {
    chmodSync(dir, 0o700);
  }
  assert.equal(readFileSync(file, 'utf8'), 'secret');
  removeOwnedSummaryFile(file);
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(dir), false);
});

test('Windows 上不同分隔符指向同一份摘要', { skip: process.platform !== 'win32' }, () => {
  const file = writeSummaryFile('session', 'owned');
  try {
    assert.equal(sameSummaryPath(file, file.replaceAll('\\', '/')), true);
  } finally {
    removeOwnedSummaryFile(file);
  }
});

test('登记时 lstat 失败，已经写好的摘要仍然算保存成功', () => {
  const result = runScript('remember-lstat.mjs', [], ['--experimental-test-module-mocks']);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('同一份摘要的认领是独占的，放开之后才能再领', () => {
  const file = uniqueFile('exclusive');
  const first = claimSummaryFile(file);
  assert.equal(typeof first, 'object');
  assert.equal(first.interrupted, false);
  assert.equal(claimSummaryFile(file), 'busy');
  first.release();
  assert.equal(existsSync(recordPath(file)), false);
  const second = claimSummaryFile(file);
  assert.equal(typeof second, 'object');
  second.release();
});

test('送达后挡住再迁；建好会话但没送达的记录给出另一个原因', () => {
  const delivered = uniqueFile('delivered');
  const held = uniqueFile('held');
  const done = claimSummaryFile(delivered);
  assert.equal(done.complete(), true);
  assert.equal(claimSummaryFile(delivered), 'delivered');
  const sealed = claimSummaryFile(held);
  assert.equal(sealed.seal(), true);
  assert.equal(claimSummaryFile(held), 'held');
  sealed.release();
  assert.equal(claimSummaryFile(held), 'held', '已经定下的结果不能再被放开');
});

test('刚建好、还没写进内容的记录算正在交接，放久了才可以接手', () => {
  const file = uniqueFile('empty');
  const path = recordPath(file);
  writeFileSync(path, '');
  assert.equal(claimSummaryFile(file), 'busy');
  assert.equal(readFileSync(path, 'utf8'), '', '正在写入的记录不能被删掉或改写');
  const old = new Date(Date.now() - SUMMARY_CLAIM_STALE_MS - 1_000);
  utimesSync(path, old, old);
  const taken = claimSummaryFile(file);
  assert.equal(typeof taken, 'object');
  taken.release();
});

test('另一个进程的认领挡住这里；那个进程退出后可以马上接手', () => {
  const file = uniqueFile('process');
  const mine = claimSummaryFile(file);
  assert.equal(runScript('claim-status.mjs', [file]).stdout.trim(), 'busy');
  mine.release();

  const crashed = runScript('claim-status.mjs', [file, 'hold']);
  assert.equal(crashed.stdout.trim(), 'claimed', crashed.stderr);
  assert.match(readFileSync(recordPath(file), 'utf8'), /^claim /u, '子进程退出时没有放开记录');
  const after = claimSummaryFile(file);
  assert.equal(typeof after, 'object', '同一台机器上持有进程已经退出，不必等 10 分钟');
  assert.equal(after.interrupted, true, '那次交接没有正常结束，要提醒检查是否已经建过目标');
  after.release();
  const retry = claimSummaryFile(file);
  assert.equal(retry.interrupted, true, '接手后在建目标前失败，下一次重试仍要提醒');
  retry.complete();
  assert.equal(claimSummaryFile(file), 'delivered');
});

test('送达记录过了保留期可以再迁，这不算中断', () => {
  const file = uniqueFile('expired');
  writeFileSync(recordPath(file), `delivered ${Date.now() - 31 * 60 * 1000} ${'a'.repeat(16)} 1 ${HOST_ID}\n`);
  const again = claimSummaryFile(file);
  assert.equal(typeof again, 'object');
  assert.equal(again.interrupted, false);
  again.release();
});

test('别的机器留下的认领按时间判断', () => {
  const file = uniqueFile('remote');
  const path = recordPath(file);
  writeFileSync(path, `claim ${Date.now()} ${'a'.repeat(16)} 1 ${'f'.repeat(12)}\n`);
  assert.equal(claimSummaryFile(file), 'busy');
  writeFileSync(path, `claim ${Date.now() - SUMMARY_CLAIM_STALE_MS - 1_000} ${'a'.repeat(16)} 1 ${'f'.repeat(12)}\n`);
  const taken = claimSummaryFile(file);
  assert.equal(typeof taken, 'object');
  assert.doesNotMatch(readFileSync(path, 'utf8'), /a{16}/u, '过期记录被整份换成新的认领');
  taken.release();
});

test('交接期间记录被别的进程换掉，结束时会发现，也不会改写或删掉对方的记录', () => {
  for (const finish of ['complete', 'seal', 'release']) {
    const file = uniqueFile(`lost-${finish}`);
    const path = recordPath(file);
    const mine = claimSummaryFile(file);
    assert.equal(typeof mine, 'object');
    const theirs = `claim ${Date.now()} ${'b'.repeat(16)} ${process.pid} ${HOST_ID}\n`;
    const temp = `${path}.${'c'.repeat(16)}.tmp`;
    writeFileSync(temp, theirs);
    renameSync(temp, path);
    const kept = mine[finish]();
    if (finish !== 'release') assert.equal(kept, false);
    assert.equal(readFileSync(path, 'utf8'), theirs, `${finish} 不能动别人的记录`);
    unlinkSync(path);
  }
});

test('符号链接记录不会被当成可接手的认领', { skip: skipWithoutSymlink }, () => {
  const file = uniqueFile('link');
  const path = recordPath(file);
  const target = writeSummaryFile('link-target', 'keep');
  symlinkSync(target, path);
  try {
    assert.equal(claimSummaryFile(file), 'busy');
    assert.equal(readFileSync(target, 'utf8'), 'keep');
    assert.equal(lstatSync(path).isSymbolicLink(), true);
  } finally {
    unlinkSync(path);
    removeOwnedSummaryFile(target);
  }
});

test('认领时只清掉一天以前的旧记录和临时文件，新记录不动', () => {
  const fresh = uniqueFile('prune-fresh');
  const freshClaim = claimSummaryFile(fresh);
  const oldPath = recordPath(uniqueFile('prune-old'));
  const oldTemp = `${oldPath}.${'d'.repeat(16)}.tmp`;
  writeFileSync(oldPath, `delivered 1 ${'e'.repeat(16)} 1 ${HOST_ID}\n`);
  writeFileSync(oldTemp, 'partial');
  const dayAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
  utimesSync(oldPath, dayAgo, dayAgo);
  utimesSync(oldTemp, dayAgo, dayAgo);
  const other = claimSummaryFile(uniqueFile('prune-trigger'));
  try {
    assert.equal(existsSync(oldPath), false);
    assert.equal(existsSync(oldTemp), false);
    assert.equal(claimSummaryFile(fresh), 'busy');
  } finally {
    freshClaim.release();
    other.release();
  }
});

test('记录目录不是真实目录时，认领失败关闭', () => {
  const result = runScript('isolated-unavailable.mjs');
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});