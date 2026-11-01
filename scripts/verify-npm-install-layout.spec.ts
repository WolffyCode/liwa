import { describe, expect, it } from 'vitest'
import type { NpmPackageLock, RegistryIndex } from './benchmark-npm-resolution.ts'
import {
  assertDualLiwaInstallLayout,
  assertResolutionWorkBudget,
  buildDualLiwaRegistry,
  MAX_RESOLUTION_WORK_UNITS,
} from './verify-npm-install-layout.ts'

function validLayout(): NpmPackageLock {
  return {
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { '@liwa/cli': '0.2.0', 'liwa-previous': 'npm:@liwa/cli@0.1.0' } },
      'node_modules/@liwa/cordis': { version: '4.0.1' },
      'node_modules/@liwa/cli': {
        version: '0.2.0',
        dependencies: { '@liwa/child': '^0.2.0' },
        peerDependencies: { '@liwa/cordis': '^4.0.1' },
      },
      'node_modules/@liwa/child': {
        version: '0.2.0',
        dependencies: { '@liwa/leaf': '^0.2.0' },
      },
      'node_modules/@liwa/leaf': { version: '0.2.0' },
      'node_modules/liwa-previous': {
        name: '@liwa/cli',
        version: '0.1.0',
        dependencies: { '@liwa/child': '^0.1.0' },
        peerDependencies: { '@liwa/cordis': '^4.0.1' },
      },
      'node_modules/liwa-previous/node_modules/@liwa/child': {
        version: '0.1.0',
        dependencies: { '@liwa/leaf': '^0.1.0' },
      },
      'node_modules/liwa-previous/node_modules/@liwa/leaf': { version: '0.1.0' },
    },
  }
}

describe('npm install layout verifier', () => {
  it('creates two incompatible versions of every Liwa package', () => {
    const index: RegistryIndex = new Map([
      ['@liwa/cli', new Map([['0.1.1-rc.2', {
        name: '@liwa/cli',
        version: '0.1.1-rc.2',
        dependencies: { '@liwa/child': '^0.1.1-rc.2' },
        peerDependencies: { '@liwa/cordis': '^4.0.1' },
      }]])],
      ['@liwa/child', new Map([['0.1.1-rc.2', {
        name: '@liwa/child',
        version: '0.1.1-rc.2',
      }]])],
      ['@liwa/cordis', new Map([['4.0.1', {
        name: '@liwa/cordis',
        version: '4.0.1',
      }]])],
    ])

    const dual = buildDualLiwaRegistry(index, '0.1.1-rc.2')

    expect([...dual.get('@liwa/cli')?.keys() ?? []]).toEqual(['0.1.0', '0.2.0'])
    expect(dual.get('@liwa/cli')?.get('0.1.0')).toMatchObject({
      version: '0.1.0',
      dependencies: { '@liwa/child': '^0.1.0' },
      peerDependencies: { '@liwa/cordis': '^4.0.1' },
    })
    expect(dual.get('@liwa/cli')?.get('0.2.0')).toMatchObject({
      version: '0.2.0',
      dependencies: { '@liwa/child': '^0.2.0' },
    })
    expect(dual.get('@liwa/cordis')).toBe(index.get('@liwa/cordis'))
  })

  it('accepts isolated Liwa releases with one shared Cordis installation', () => {
    expect(assertDualLiwaInstallLayout(validLayout())).toEqual({
      liwaPackagesPerVersion: 3,
      checkedLiwaEdges: 4,
    })
  })

  it.each([
    ['react', 'node_modules/react'],
    ['react-dom', 'node_modules/react-dom'],
    ['react', 'node_modules/liwa-previous/node_modules/react'],
    ['react-dom', 'node_modules/liwa-previous/node_modules/react-dom'],
  ])('rejects browser runtime %s installed at %s in the Liwa-only consumer', (name, path) => {
    const layout = validLayout()
    const packages = { ...layout.packages, [path]: { version: '18.3.1' } }
    expect(() => assertDualLiwaInstallLayout({ ...layout, packages })).toThrow(
      `${path}: ${name} is a browser build input`,
    )
  })

  it('rejects an internal edge that crosses release versions', () => {
    const layout = validLayout()
    const packages = { ...layout.packages }
    Reflect.deleteProperty(packages, 'node_modules/liwa-previous/node_modules/@liwa/leaf')

    expect(() => assertDualLiwaInstallLayout({ ...layout, packages })).toThrow(
      'node_modules/liwa-previous/node_modules/@liwa/child: dependencies '
      + '@liwa/leaf resolves to node_modules/@liwa/leaf@0.2.0, expected 0.1.0',
    )
  })

  it('rejects a second Cordis installation', () => {
    const layout = validLayout()
    const packages = {
      ...layout.packages,
      'node_modules/liwa-previous/node_modules/@liwa/cordis': { version: '4.0.1' },
    }

    expect(() => assertDualLiwaInstallLayout({ ...layout, packages })).toThrow(
      'expected one shared @liwa/cordis',
    )
  })
})

describe('resolution work budget', () => {
  it('accepts the measured dual-release graph', () => {
    expect(assertResolutionWorkBudget({ liwaPackagesPerVersion: 320, checkedLiwaEdges: 2836 }))
      .toBe(907_520)
  })

  it('accepts a graph exactly at the budget and rejects one internal edge above it', () => {
    const packages = 320
    const edgesAtBudget = Math.floor(MAX_RESOLUTION_WORK_UNITS / packages)

    expect(packages * edgesAtBudget).toBe(MAX_RESOLUTION_WORK_UNITS)
    expect(assertResolutionWorkBudget({ liwaPackagesPerVersion: packages, checkedLiwaEdges: edgesAtBudget }))
      .toBe(MAX_RESOLUTION_WORK_UNITS)
    expect(() => assertResolutionWorkBudget({
      liwaPackagesPerVersion: packages,
      checkedLiwaEdges: edgesAtBudget + 1,
    })).toThrow(`= ${String(MAX_RESOLUTION_WORK_UNITS + packages)} unit(s), budget ${String(MAX_RESOLUTION_WORK_UNITS)} unit(s)`)
  })

  it('accepts the headroom and rejects a runaway graph with its own measured counts', () => {
    expect(assertResolutionWorkBudget({ liwaPackagesPerVersion: 350, checkedLiwaEdges: 3200 }))
      .toBe(1_120_000)
    expect(() => assertResolutionWorkBudget({ liwaPackagesPerVersion: 400, checkedLiwaEdges: 3000 }))
      .toThrow(`400 package(s) per release x 3000 internal edge(s) = 1200000 unit(s), budget ${String(MAX_RESOLUTION_WORK_UNITS)} unit(s)`)
  })
})
