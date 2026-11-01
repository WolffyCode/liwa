/** The SDK app bundle's declared profile patch. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseEntryYaml } from '@liwa/cordis-plugin-include'

describe('liwa-sdk-app bundle', () => {
  it('declares startup-gated JSON-RPC serving without overriding base HMR policy', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      liwa?: { bundle?: { patch?: string } }
    }
    expect(manifest.liwa?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toHaveProperty('@liwa/sdk-jsonrpc-server')
    const patches = parseEntryYaml(readFileSync(resolve(root, manifest.liwa!.bundle!.patch!), 'utf8')) as Array<{ id?: string; disabled?: boolean; insert?: Array<{ id?: string; inject?: string[]; name?: string }> }>
    expect(patches.find(patch => patch.id === 'hmr')).toMatchObject({ disabled: true })
    expect(patches.find(patch => patch.id === 'session-title-llm')).toMatchObject({ disabled: true })
    expect(patches.find(patch => patch.id === 'system-prompt')).toMatchObject({
      config: { personaPrefix: 'You are a coding agent powered by the {{model}} model.' },
    })
    const rows = patches.flatMap(patch => patch.insert ?? [])
    expect(rows.find(row => row.id === 'sdk-app-startup')?.name).toBe('@liwa/sdk-app')
    expect(rows.find(row => row.id === 'sdk-jsonrpc-server')?.inject).toEqual(['sdkAppStartup', 'loader'])
  })
})
