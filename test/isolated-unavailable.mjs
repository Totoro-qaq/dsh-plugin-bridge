import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { claimSummaryFile } from '../src/summary-file.ts';

const privateTmp = mkdtempSync(join(tmpdir(), 'dsh-claim-dir-'));
process.env.TMPDIR = privateTmp;
process.env.TMP = privateTmp;
process.env.TEMP = privateTmp;
const claimDir = `dsh-bridge-claims${typeof process.getuid === 'function' ? `-${process.getuid()}` : ''}`;
writeFileSync(join(privateTmp, claimDir), 'not-a-directory');
const file = join(privateTmp, 'summary.md');
writeFileSync(file, 'x');
const result = claimSummaryFile(file);
if (result !== 'unavailable') {
  console.error(String(result));
  process.exit(1);
}
if (readFileSync(file, 'utf8') !== 'x') process.exit(1);
