import { claimSummaryFile } from '../src/summary-file.ts';

const result = claimSummaryFile(process.argv[2]);
if (typeof result === 'string') {
  console.log(result);
} else {
  result.release();
  console.log('claimed');
}
