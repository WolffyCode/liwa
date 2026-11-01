/** The optional Developer Tools bundle enables both inspectors, including fetch capture. */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseEntryYaml } from '@liwa/cordis-plugin-include'

describe('Inspector profile bundle', () => {
  it('publishes one layer containing both inspectors and the Statistics view', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      publishConfig: { access: string }
      liwa: { bundle: { patch: string } }
      dependencies: Record<string, string>
    }
    expect(manifest.publishConfig.access).toBe('public')
    expect(manifest.liwa.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toEqual({
      '@liwa/experimental-client-ui-stats': 'workspace:*',
      '@liwa/experimental-inspector': 'workspace:*',
      '@liwa/experimental-session-inspector': 'workspace:*',
    })
    expect(parseEntryYaml(readFileSync(new URL(`../${manifest.liwa.bundle.patch}`, import.meta.url), 'utf8'))).toEqual([{ insert: [
      {
        id: 'experimental-inspector', name: '@liwa/experimental-inspector',
        disabled: false, config: { captureFetch: true },
      },
      { id: 'session-inspector', name: '@liwa/experimental-session-inspector' },
      { id: 'client-ui-stats', name: '@liwa/experimental-client-ui-stats' },
    ] }])
  })
})
