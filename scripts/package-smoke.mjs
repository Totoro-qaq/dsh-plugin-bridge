import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const scratch = await mkdtemp(join(tmpdir(), 'dsh-bridge-package-'));

function run(args, cwd = root) {
  const result = spawnSync(npm, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${npm} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

try {
  run(['run', 'build']);
  // An outer `npm publish --dry-run` exports npm_config_dry_run to child npm
  // processes. Override it here: this smoke must create and install a real
  // temporary tarball even while the outer publication remains a dry run.
  const raw = run(['pack', '--ignore-scripts', '--json', '--dry-run=false', '--pack-destination', scratch]);
  const start = raw.indexOf('[');
  if (start < 0) throw new Error(`npm pack did not return JSON:\n${raw}`);
  const [packed] = JSON.parse(raw.slice(start));
  if (!packed?.filename) throw new Error('npm pack returned no filename');

  const tarball = join(scratch, packed.filename);
  const installRoot = join(scratch, 'install');
  await mkdir(installRoot);
  // DSH supplies Cordis at runtime. Install that declared peer explicitly so
  // npm 10/Node 22 does not spend an unbounded amount of time resolving the
  // peer graph after this package already exists on the public registry.
  run([
    'install',
    '--ignore-scripts',
    '--legacy-peer-deps',
    '--no-audit',
    '--no-fund',
    '--dry-run=false',
    '--prefix',
    installRoot,
    tarball,
    '@deepseek-ai/cordis@4.0.1',
  ], scratch);

  const packageRoot = join(installRoot, 'node_modules', 'dsh-plugin-bridge');
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  for (const relative of [
    'lib/index.js',
    'lib/index.d.ts',
    'cordis.patch.yml',
    'docs/design.md',
    'reports/v0.2.3-e2e-report.md',
  ]) {
    if (!existsSync(join(packageRoot, relative))) throw new Error(`packed artifact is missing ${relative}`);
  }

  const plugin = await import(pathToFileURL(join(packageRoot, 'lib/index.js')).href);
  if (plugin.name !== 'dsh-plugin-bridge' || typeof plugin.apply !== 'function') {
    throw new Error('installed artifact does not expose the Bridge plugin entrypoint');
  }

  console.log(`package smoke ok: ${manifest.name}@${manifest.version} (${packed.entryCount} files)`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
