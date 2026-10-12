import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { claimSummaryFile } from '../src/summary-file.ts';

const privateTmp = mkdtempSync(join(tmpdir(), 'dsh-claim-proc-'));
process.env.TMPDIR = privateTmp;
process.env.TMP = privateTmp;
process.env.TEMP = privateTmp;
const file = join(privateTmp, 'summary.md');
writeFileSync(file, 'shared');
const claim = claimSummaryFile(file);
if (typeof claim === 'string') {
  console.error(claim);
  process.exit(1);
}
const script = fileURLToPath(new URL('./claim-status.mjs', import.meta.url));
const child = spawnSync(process.execPath, ['--experimental-strip-types', script, file], {
  encoding: 'utf8',
  env: { ...process.env, TMPDIR: privateTmp, TMP: privateTmp, TEMP: privateTmp },
});
claim.release();
if (child.status !== 0) {
  console.error(child.stderr);
  process.exit(child.status ?? 1);
}
if (child.stdout.trim() !== 'busy') {
  console.error(child.stdout);
  process.exit(1);
}
