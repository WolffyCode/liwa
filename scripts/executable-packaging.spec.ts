import { existsSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { pinStagedDependencyVersions, pkgConfigExcludingCheckout, removePackageManagerRecords } from './executable-packaging.ts'
import { materializeStagedLinks } from './build-exe-for-python-sdk-staging.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'liwa-exe-deploy-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  const staging = join(root, 'staging')
  await mkdir(source)
  await mkdir(join(staging, 'node_modules'), { recursive: true })
  return { root, source, staging, modules: join(staging, 'node_modules') }
}

async function writeFiles(directory: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(directory, path)), { recursive: true })
    await writeFile(join(directory, path), content)
  }
}

/** List files below a directory whose contents mention a path. */
async function filesMentioning(directory: string, path: string): Promise<string[]> {
  const mentions: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    const file = join(entry.parentPath, entry.name)
    if ((await readFile(file, 'utf8')).includes(path)) mentions.push(file)
  }
  return mentions
}

it('materializes a package junction without deleting its source and drops linked command directories', async () => {
  const test = await fixture()
  await mkdir(join(test.source, 'peer'))
  await writeFile(join(test.source, 'peer/index.js'), 'intact')
  await symlink(join(test.source, 'peer'), join(test.modules, 'peer'), 'junction')
  await symlink(join(test.source, 'peer'), join(test.modules, '.bin'), 'junction')
  await materializeStagedLinks(test.staging)
  expect((await lstat(join(test.modules, 'peer'))).isSymbolicLink()).toBe(false)
  expect(await readFile(join(test.modules, 'peer/index.js'), 'utf8')).toBe('intact')
  expect(await readFile(join(test.source, 'peer/index.js'), 'utf8')).toBe('intact')
  await expect(lstat(join(test.modules, '.bin'))).rejects.toThrow('ENOENT')
})

it('leaves no build-checkout path in a deployed payload while keeping its runtime files', async () => {
  const checkout = await mkdtemp(join(tmpdir(), 'liwa-exe-checkout-'))
  onTestFinished(() => rm(checkout, { recursive: true, force: true }))
  // The Python carrier is deployed inside the checkout, so pnpm's records name both locations.
  const staging = join(checkout, 'python/sdk-runtime/src/liwa_runtime/runtime/node')
  const agentSource = `file://${checkout}/packages/core/agent`
  await writeFiles(staging, {
    'package.json': JSON.stringify({
      name: 'closure', private: true,
      dependencies: { '@liwa/agent': `@liwa/agent@${agentSource}`, '@liwa/cordis': `file:${checkout}/vendor/cordis`, 'zod': '4.4.3' },
      peerDependencies: { '@liwa/cordis': 'workspace:~' },
      devDependencies: {},
      optionalDependencies: {},
    }),
    'pnpm-lock.yaml': `importers:\n  .:\n    dependencies:\n      '@liwa/agent': ${agentSource}\n`,
    'pnpm-workspace.yaml': `patchedDependencies:\n  pkg@1.0.0: ${checkout}/patches/pkg@1.0.0.patch\n`,
    'node_modules/.modules.yaml': `injectedDeps:\n  ${agentSource.slice('file:'.length)}:\n    - node_modules/@liwa/agent\n`,
    'node_modules/.pnpm/lock.yaml': `importers:\n  .:\n    dependencies:\n      '@liwa/agent': ${agentSource}\n`,
    'node_modules/.pnpm-workspace-state-v1.json': JSON.stringify({ projects: { [staging]: { name: 'closure' } } }),
    'node_modules/@liwa/agent/package.json': JSON.stringify({ name: '@liwa/agent', version: '0.2.2-alpha.2', dependencies: { '@liwa/cordis': 'workspace:~' } }),
    'node_modules/@liwa/agent/lib/index.js': 'export {}\n',
    'node_modules/@liwa/agent/node_modules/.bin/tool': '#!/bin/sh\n',
    'node_modules/@liwa/cordis/package.json': JSON.stringify({ name: '@liwa/cordis', version: '4.0.0' }),
    'node_modules/zod/package.json': JSON.stringify({ name: 'zod', version: '4.4.3' }),
  })

  await removePackageManagerRecords(staging)
  await pinStagedDependencyVersions(staging)

  expect(await filesMentioning(staging, checkout)).toEqual([])
  for (const record of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'node_modules/.modules.yaml', 'node_modules/.pnpm',
    'node_modules/.pnpm-workspace-state-v1.json', 'node_modules/@liwa/agent/node_modules/.bin']) {
    expect(existsSync(join(staging, record)), record).toBe(false)
  }
  const manifest = JSON.parse(await readFile(join(staging, 'package.json'), 'utf8')) as Record<string, unknown>
  expect(manifest.dependencies).toEqual({ '@liwa/agent': '0.2.2-alpha.2', '@liwa/cordis': '4.0.0', 'zod': '4.4.3' })
  expect(manifest.peerDependencies).toEqual({ '@liwa/cordis': 'workspace:~' })
  expect(await readFile(join(staging, 'node_modules/@liwa/agent/lib/index.js'), 'utf8')).toBe('export {}\n')
})

it('rejects a locally specified dependency that the payload does not install', async () => {
  const test = await fixture()
  await writeFile(join(test.staging, 'package.json'), JSON.stringify({ dependencies: { missing: 'missing@file:///checkout/missing' } }))
  await expect(pinStagedDependencyVersions(test.staging)).rejects.toThrow('dependencies.missing')
})

it('ignores the checkout around a staged payload, including the dot-prefixed pnpm store', () => {
  const config = pkgConfigExcludingCheckout('C:\\work\\liwa', ['package.json'], ['**/*.map'])
  expect(config.pkg.assets).toEqual(['package.json'])
  expect(config.pkg.ignore).toEqual([
    '**/*.map', 'C:/work/liwa/node_modules/**', 'C:/work/liwa/node_modules/.pnpm/**',
    ...['packages', 'apps', 'vendor', 'native', 'scripts'].map(tree => `C:/work/liwa/${tree}/**`),
    'C:/work/liwa/tsconfig*.json',
  ])
})
