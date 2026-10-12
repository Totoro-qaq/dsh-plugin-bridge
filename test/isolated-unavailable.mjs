import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { claimSummaryFile } from '../src/summary-file.ts';

const privateTmp = mkdtempSync(join(tmpdir(), 'dsh-claim-dir-'));
process.env.TMPDIR = privateTmp;
process.env.TMP = privateTmp;
process.env.TEMP = privateTmp;
writeFileSync(join(privateTmp, 'dsh-bridge-claims'), 'not-a-directory');
const file = join(privateTmp, 'summary.md');
writeFileSync(file, 'x');
const result = claimSummaryFile(file);
if (result !== 'unavailable') {
  console.error(String(result));
  process.exit(1);
}
if (readFileSync(file, 'utf8') !== 'x') process.exit(1);
