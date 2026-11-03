import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyRuntimeClosure } from './verify-runtime-closure.ts'

const roots: string[] = []
const manifestPath = 'packages/ssh/ssh-helper-runtime/package.json'

function fixture(runtime: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), 'liwa-runtime-closure-'))
  roots.push(root)
  mkdirSync(dirname(join(root, manifestPath)), { recursive: true })
  writeFileSync(join(root, manifestPath), `${JSON.stringify(runtime, null, 2)}\n`)
  return root
}

function workspace(root: string, name: string, manifest: Record<string, unknown>): void {
  const packageName = name.replace('@scope/', '')
  const path = join(root, 'packages/core', packageName, 'package.json')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ name, ...manifest }, null, 2)}\n`)
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('verifyRuntimeClosure', () => {
  it('requires a transitive workspace peer until the runtime manifest declares it', async () => {
    const root = fixture({ name: 'helper', dependencies: { '@scope/worker': 'workspace:^' } })
    workspace(root, '@scope/worker', { peerDependencies: { '@scope/peer': 'workspace:^' } })
    workspace(root, '@scope/peer', {})
    expect((await verifyRuntimeClosure(root, manifestPath)).failures).toEqual(['helper -> @scope/worker -> @scope/peer'])
    writeFileSync(join(root, manifestPath), JSON.stringify({ name: 'helper', dependencies: { '@scope/worker': 'workspace:^', '@scope/peer': 'workspace:^' } }))
    expect(await verifyRuntimeClosure(root, manifestPath)).toMatchObject({ failures: [], workspacePackageCount: 2 })
  })

  it('skips optional workspace peers', async () => {
    const root = fixture({ name: 'runtime', dependencies: { '@scope/root': 'workspace:^' } })
    workspace(root, '@scope/root', {
      peerDependencies: { '@scope/required': 'workspace:^', '@scope/optional': 'workspace:^' },
      peerDependenciesMeta: { '@scope/optional': { optional: true } },
    })
    workspace(root, '@scope/required', {})
    workspace(root, '@scope/optional', {})

    const result = await verifyRuntimeClosure(root, manifestPath)

    expect(result.workspacePackageCount).toBe(1)
    expect(result.failures).toEqual(['runtime -> @scope/root -> @scope/required'])
  })
})
