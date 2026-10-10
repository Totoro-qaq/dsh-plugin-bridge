import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../', import.meta.url)
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))

test('Workshop declaration describes the existing profile bundle, not a new runtime', () => {
  const m = pkg.dshWorkshop
  assert.ok(m, 'package.json#dshWorkshop is required for the proposed intake')
  assert.equal(m.schema, 'omdsh-workshop-package/v1')
  assert.equal(m.type, 'plugin')
  assert.equal(m.integration.protocol, 'harness-profile')
  assert.equal(m.integration.artifact, pkg.dsh.bundle.patch.replace(/^\.\//, ''))
  assert.ok(existsSync(new URL(m.integration.artifact, root)))
  assert.equal(m.install.adapter, 'profile-bundle')
  assert.equal(m.install.mode, 'transactional')
  assert.equal(m.install.failurePolicy, 'generation-rollback')
  assert.equal(m.install.touchesCurrentBeforeActivation, false)
})

test('Workshop claims remain bounded to named hosts and do not claim untested hot reload', () => {
  const m = pkg.dshWorkshop
  assert.ok(m)
  assert.deepEqual(m.compatibility.dshVersions, ['0.2.0-rc.2', '0.2.1-alpha.1', '0.2.1-alpha.2'])
  assert.equal(m.lifecycle.activation, 'restart-host')
  assert.equal(m.evidence.failureIsolation, null)
  assert.equal(m.evidence.hotReload, null)
  assert.ok(m.capability.id)
  assert.ok(m.capability.invocation)
  assert.ok(m.capability.expected)
  assert.equal(m.capability.kind, 'command')
})

test('Workshop evidence paths are public repository files, never personal paths', () => {
  const m = pkg.dshWorkshop
  assert.ok(m)
  assert.equal(new Set(m.permissions).size, m.permissions.length)
  for (const permission of m.permissions) assert.match(permission, /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/)
  for (const path of Object.values(m.evidence)) {
    if (path === null) continue
    assert.match(path, /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/)
    assert.ok(existsSync(new URL(path, root)), `missing public evidence: ${path}`)
  }
  assert.doesNotMatch(JSON.stringify(m), /github_pat_|\/Users\/|Bearer |sk-[A-Za-z0-9]{12}/)
})
