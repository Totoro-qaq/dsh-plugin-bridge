import { claimSummaryFile } from '../src/summary-file.ts';

const result = claimSummaryFile(process.argv[2]);
if (typeof result === 'string') {
  console.log(result);
} else {
  // hold：拿到认领后直接退出，模拟交接进行到一半时进程崩溃。
  if (process.argv[3] !== 'hold') result.release();
  console.log('claimed');
}
