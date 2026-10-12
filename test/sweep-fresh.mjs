import { noteSummaryInUse, sweepAgedSummaryFiles } from '../src/summary-file.ts';

const held = process.argv[2];
if (held) noteSummaryInUse(held);
sweepAgedSummaryFiles();
