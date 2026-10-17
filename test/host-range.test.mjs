import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import semver from 'semver';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const previousRange = '>=0.1.0-rc.7 <0.2.0-0 || 0.2.0-rc.2 || 0.2.1-alpha.1 || 0.2.1-alpha.2 || 0.2.1-alpha.3 || 0.2.1-alpha.4';

test('host-range checks use the same semver major and exact version as DSH alpha.5', () => {
  assert.equal(pkg.devDependencies.semver, '7.8.5');
  assert.equal(lock.packages['node_modules/semver'].version, '7.8.5');
  assert.equal(JSON.parse(readFileSync(new URL('../node_modules/semver/package.json', import.meta.url), 'utf8')).version, '7.8.5');
});

test('the host admission range preserves all previously supported release boundaries', () => {
  assert.equal(semver.subset(previousRange, pkg.engines.dsh, { includePrerelease: true }), true,
    'the complete previous Host range must remain a subset, not only sampled versions');
  const versions = new Set([
    '0.1.0-rc.6', '0.1.0-rc.7', '0.1.0-rc.8', '0.1.0',
    '0.2.0-alpha.1', '0.2.0-rc.1', '0.2.0-rc.2', '0.2.0-rc.3', '0.2.0',
    '0.2.1-alpha.1', '0.2.1-alpha.2', '0.2.1-alpha.3', '0.2.1-alpha.4',
  ]);
  for (const minor of [1]) {
    for (const patch of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 99]) {
      for (const suffix of ['', '-alpha.1', '-alpha.5', '-beta.1', '-rc.1', '-rc.7']) {
        versions.add(`0.${minor}.${patch}${suffix}`);
      }
    }
  }
  for (const includePrerelease of [true, false]) {
    for (const version of versions) {
      if (!semver.satisfies(version, previousRange, { includePrerelease })) continue;
      assert.equal(semver.satisfies(version, pkg.engines.dsh, { includePrerelease }), true,
        `${version} must retain support with includePrerelease=${includePrerelease}`);
    }
  }
});

test('0.2.1 prereleases and stable releases no longer require per-alpha admission updates', () => {
  for (const includePrerelease of [true, false]) {
    for (const version of [
      '0.2.1-alpha.1', '0.2.1-alpha.4', '0.2.1-alpha.5', '0.2.1-alpha.6',
      '0.2.1-alpha.999', '0.2.1-beta.1', '0.2.1-rc.1', '0.2.1', '0.2.1+build.1',
    ]) {
      assert.equal(semver.satisfies(version, pkg.engines.dsh, { includePrerelease }), true,
        `${version} should be admitted with includePrerelease=${includePrerelease}`);
    }
  }
});

test('admission stays bounded below the next patch prerelease and retains unsupported gaps', () => {
  for (const includePrerelease of [true, false]) {
    for (const version of [
      '0.0.99', '0.1.0-alpha.1', '0.1.0-rc.6',
      '0.2.0-alpha.1', '0.2.0-rc.1', '0.2.0-rc.3', '0.2.0',
      '0.2.2-0', '0.2.2-alpha.1', '0.2.2-rc.1', '0.2.2',
      '0.2.3-alpha.1', '0.3.0-alpha.1', '1.0.0',
    ]) {
      assert.equal(semver.satisfies(version, pkg.engines.dsh, { includePrerelease }), false,
        `${version} must remain outside admission with includePrerelease=${includePrerelease}`);
    }
  }
});

test('the install range and named acceptance evidence remain separate', () => {
  assert.equal(lock.packages[''].engines.dsh, pkg.engines.dsh);
  const verifiedVersions = pkg.dshWorkshop.compatibility.dshVersions;
  assert.ok(verifiedVersions.includes('0.2.1-alpha.5'), 'alpha.5 needs its own acceptance evidence');
  assert.equal(verifiedVersions.includes('0.2.1-alpha.6'), false, 'admission does not claim future acceptance');
  for (const version of verifiedVersions) {
    assert.equal(semver.satisfies(version, pkg.engines.dsh, { includePrerelease: true }), true,
      `named accepted host ${version} must be installable`);
  }
});
