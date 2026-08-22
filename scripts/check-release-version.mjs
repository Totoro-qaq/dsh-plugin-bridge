import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const tag = process.argv[2] || process.env.GITHUB_REF_NAME;

if (!tag) {
  throw new Error('release tag is required (argument or GITHUB_REF_NAME)');
}

const expected = `v${manifest.version}`;
if (tag !== expected) {
  throw new Error(`release tag ${JSON.stringify(tag)} does not match package version ${JSON.stringify(expected)}`);
}

console.log(`release version ok: ${tag}`);
