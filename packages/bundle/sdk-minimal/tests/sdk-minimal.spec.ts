/** The standalone SDK-minimal bundle's complete declared Cordis tree. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseEntryYaml } from '@liwa/cordis-plugin-include'

function packageName(specifier: string): string {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!
}

describe('liwa-sdk-minimal bundle', () => {
  it('declares one standalone allowlisted tree with every row dependency', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      liwa?: { bundle?: { patch?: string } }
    }
    expect(manifest.liwa?.bundle?.patch).toBe('./cordis.patch.yml')
    const patches = parseEntryYaml(readFileSync(resolve(root, manifest.liwa!.bundle!.patch!), 'utf8')) as Array<{ insert?: Array<{ id?: string; inject?: string[]; name?: string; config?: Record<string, unknown>; disabled?: unknown }> }>
    expect(patches).toHaveLength(1)
    const rows = patches[0]?.insert ?? []
    expect(rows.map(row => [row.id, row.name])).toEqual([
      ['sdk-app-startup', '@liwa/sdk-app'],
      ['sdk-jsonrpc-server', '@liwa/sdk-jsonrpc-server'],
      ['deepseek-llm-api-extensions', '@liwa/deepseek-llm-api-extensions'],
      ['session-log-deepseek', '@liwa/session-log-deepseek'],
      ['plugin-package-inventory-deepseek', '@liwa/plugin-package-inventory-deepseek'],
      ['llm-deepseek', '@liwa/llm-deepseek-api-key'],
      ['sandbox', '@liwa/sandbox-local'],
      ['filesystem', '@liwa/fs-local'],
      ['attachment-local', '@liwa/attachment-local'],
      ['tool-fs', '@liwa/tool-fs'],
      ['working-directory', '@liwa/working-directory'],
      ['tool-working-directory', '@liwa/tool-working-directory'],
      ['session-projection', '@liwa/session-projection'],
      ['token-meter', '@liwa/token-meter'],
      ['compaction-basic', '@liwa/compaction-basic'],
      ['image-offload', '@liwa/compaction-image-offload'],
      ['sandbox-policy', '@liwa/sandbox-policy'],
      ['subprocess', '@liwa/subprocess-local'],
      ['pty', '@liwa/terminal'],
      ['terminal-bash', '@liwa/terminal-bash'],
      ['terminal-pwsh', '@liwa/terminal-bash'],
      ['timer', '@liwa/cordis-plugin-timer'],
      ['llm', '@liwa/llm'],
      ['session', '@liwa/session'],
      ['session-title', '@liwa/session-title'],
      ['system-prompt', '@liwa/system-prompt'],
      ['tools', '@liwa/tools'],
      ['tool-executor-native', '@liwa/tool-executor-native'],
      ['mcp-resources', '@liwa/mcp-resources'],
      ['agent', '@liwa/agent'],
      ['llm-retry', '@liwa/llm-retry'],
      ['jobs', '@liwa/jobs-local'],
      ['agent-loop', '@liwa/agent-loop'],
      ['persistent-bash', '@liwa/tool-bash-persistent'],
      ['persistent-pwsh', '@liwa/tool-pwsh-persistent'],
      ['sessions', '@liwa/session-persistence-jsonl'],
      ['session-checkpoint-policy', '@liwa/session-checkpoint-policy'],
    ])
    expect(rows.find(row => row.id === 'sdk-app-startup')?.config).toEqual({ profile: 'sdk-minimal' })
    expect(rows.find(row => row.id === 'sdk-jsonrpc-server')).toMatchObject({
      inject: ['sdkAppStartup', 'loader'],
      config: { maxTokensAsSuccess: false },
    })
    expect(rows.find(row => row.id === 'llm-deepseek')?.config).toEqual({
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      defaultContextWindow: { __jsExpr: 'Number(process.env.LIWA_CONTEXT_WINDOW ?? 1000000)' },
      streamIdleTimeoutMs: 172800000,
    })
    expect(rows.find(row => row.id === 'system-prompt')?.config).toEqual({
      includeLiwaIdentity: false,
      includeRuntimeContext: false,
      personaPrefix: { __jsExpr: "process.env.LIWA_SYSTEM_PROMPT ?? 'You are a helpful software engineer assistant.'" },
    })
    expect(rows.find(row => row.id === 'agent-loop')?.config).toEqual({ agents: [] })
    expect(rows.find(row => row.id === 'tool-fs')?.config).toEqual({ read: false, readImage: true, write: false, edit: false })
    expect(rows.find(row => row.id === 'compaction-basic')?.config).toBeUndefined()
    expect(rows.find(row => row.id === 'terminal-bash')).toMatchObject({
      disabled: { __jsExpr: "process.platform === 'win32'" },
    })
    expect(rows.find(row => row.id === 'terminal-pwsh')).toMatchObject({
      disabled: { __jsExpr: "process.platform !== 'win32'" },
      config: { shellDialect: 'pwsh', timeoutMs: 300000 },
    })
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(
      [...new Set(rows.map(row => row.name).filter((name): name is string => name !== undefined).map(packageName))].sort(),
    )
  })
})
