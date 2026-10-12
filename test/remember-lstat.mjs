import { mock } from 'node:test';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const real = fs.lstatSync;
let armed = true;
mock.module('node:fs', {
  namedExports: {
    ...fs,
    lstatSync: (...args) => {
      const path = String(args[0]);
      if (armed && path.endsWith('.md')) {
        armed = false;
        const error = new Error('EACCES');
        error.code = 'EACCES';
        throw error;
      }
      return real(...args);
    },
  },
});

const { writeSummaryFile } = await import('../src/summary-file.ts');
const file = writeSummaryFile('lstat', '## 目标\n还在');
if (armed) {
  console.error('lstat of the summary was not intercepted');
  process.exit(1);
}
const body = fs.readFileSync(file, 'utf8');
if (body !== '## 目标\n还在') {
  console.error(body);
  process.exit(1);
}
fs.unlinkSync(file);
fs.rmSync(dirname(file), { recursive: true, force: true });
