import { mock } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync, unlinkSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const real = fs.lstatSync;
let armed = true;
mock.module('node:fs', {
  namedExports: new Proxy(fs, {
    get(target, prop, receiver) {
      if (prop === 'lstatSync') {
        return (...args) => {
          const path = String(args[0]);
          if (armed && path.endsWith('.md')) {
            armed = false;
            const error = new Error('EACCES');
            error.code = 'EACCES';
            throw error;
          }
          return real.apply(target, args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }),
});

const { writeSummaryFile } = await import('../src/summary-file.ts');
const file = writeSummaryFile('lstat', '## 目标\n还在');
if (armed) {
  console.error('lstat of the summary was not intercepted');
  process.exit(1);
}
const body = readFileSync(file, 'utf8');
if (body !== '## 目标\n还在') {
  console.error(body);
  process.exit(1);
}
unlinkSync(file);
rmSync(dirname(file), { recursive: true, force: true });
