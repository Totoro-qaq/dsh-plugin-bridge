import { readFile } from 'node:fs/promises';

for (const name of ['test', 'validation']) {
  const file = new URL(`../datasets/${name}.json`, import.meta.url);
  const data = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(data.themes) || data.themes.length === 0 || !data.templates?.plant) {
    throw new Error(`${name} dataset is incomplete`);
  }
}

console.log('datasets ok');
