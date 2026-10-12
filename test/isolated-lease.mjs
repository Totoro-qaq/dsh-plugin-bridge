import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { noteSummaryIdle, noteSummaryInUse, writeSummaryFile } from '../src/summary-file.ts';

const privateTmp = mkdtempSync(join(tmpdir(), 'dsh-lease-'));
process.env.TMPDIR = privateTmp;
process.env.TMP = privateTmp;
process.env.TEMP = privateTmp;

const owned = writeSummaryFile('owned', 'owned');
const idle = writeSummaryFile('idle', 'idle');
const past = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
utimesSync(owned, past, past);
utimesSync(idle, past, past);
noteSummaryInUse(owned);
const script = fileURLToPath(new URL('./sweep-fresh.mjs', import.meta.url));
const run = () => spawnSync(process.execPath, ['--experimental-strip-types', script], {
  encoding: 'utf8',
  env: { ...process.env, TMPDIR: privateTmp, TMP: privateTmp, TEMP: privateTmp },
});
const once = run();
if (once.status !== 0) {
  console.error(once.stderr);
  process.exit(once.status ?? 1);
}
if (readFileSync(owned, 'utf8') !== 'owned' || existsSync(idle)) {
  console.error('in-use summary was not protected');
  process.exit(1);
}
noteSummaryIdle(owned);
const twice = run();
if (twice.status !== 0) {
  console.error(twice.stderr);
  process.exit(twice.status ?? 1);
}
if (existsSync(owned)) {
  console.error('idle summary was kept');
  process.exit(1);
}
