/**
 * Registry tests for `@liwa/shell-env`: built-in facts, contributor
 * ownership and validation, collection ordering, effect-scoped disposal, and
 * the explicit disposer contract.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@liwa/cordis'
import { ToolCallId } from '@liwa/llm'
import type { Agent } from '@liwa/agent'
import { SESSION_FORMAT_VERSION } from '@liwa/session'
import type { ToolExecution } from '@liwa/tools'
import { ShellEnvRegistry } from '@liwa/shell-env'
import * as BashEnvPlugin from '@liwa/shell-env'

const testToolSignal = new AbortController().signal

afterEach(() => vi.unstubAllEnvs())

function execution(sessionId?: string): ToolExecution {
  return {
    signal: testToolSignal,
    token: Symbol('bash-env-test') as ToolExecution['token'],
    callId: ToolCallId('bash-env-call'),
    rootCallId: ToolCallId('bash-env-call'),
    name: 'bash',
    arguments: { command: 'true' },
    ...(sessionId === undefined
      ? {}
      : {
        agent: {
          session: {
            header: { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 0, isSeeded: false },
          },
        } as unknown as Agent,
      }),
  }
}

describe('ShellEnvRegistry', () => {
  it('collects unconditional shell facts and the current agent session id', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { liwaHome: './test-liwa-home' })

    expect(registry.collect(execution())).toEqual({
      LIWA_HOME: resolve('./test-liwa-home'),
      LIWA_SHELL: '1',
    })
    expect(registry.collect(execution('session-a'))).toEqual({
      LIWA_HOME: resolve('./test-liwa-home'),
      LIWA_SESSION_ID: 'session-a',
      LIWA_SHELL: '1',
    })
  })

  it('collects the launcher-provided profile name and directory when a profile context exists', () => {
    const ctx = new Context()
    ctx.provide('profileContext', {
      name: 'web', dir: '/profiles/web', patchPath: '/profiles/web/cordis.patch.yml', installAnchor: '/liwa/package.json',
      cwd: '/work', home: '/home', startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
    })
    const registry = new ShellEnvRegistry(ctx, { liwaHome: './test-liwa-home' })
    expect(registry.collect(execution())).toMatchObject({ LIWA_PROFILE: 'web', LIWA_PROFILE_DIR: '/profiles/web' })
    expect(() => registry.register({
      name: 'profile-claimer',
      variables: { LIWA_PROFILE: { description: 'Reserved key.' } },
      resolve: () => ({}),
    })).toThrow(/reserved key "LIWA_PROFILE"/)
  })

  it('resolves LIWA_HOME from the ambient override or the user-home default', () => {
    vi.stubEnv('LIWA_HOME', './ambient-liwa-home')
    const fromEnvironment = new ShellEnvRegistry(new Context())
    expect(fromEnvironment.collect(execution()).LIWA_HOME).toBe(resolve('./ambient-liwa-home'))

    vi.stubEnv('LIWA_HOME', undefined)
    const fromDefault = new ShellEnvRegistry(new Context())
    expect(fromDefault.collect(execution()).LIWA_HOME).toBe(join(homedir(), '.liwa'))
  })

  it('collects declared contributor variables and omits unavailable values', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { liwaHome: './test-liwa-home' })
    registry.register({
      name: 'optional-session-fact',
      variables: {
        LIWA_SESSION_OPTIONAL: { description: 'Optional session-scoped test fact.' },
      },
      resolve: exec => exec.agent === undefined ? {} : { LIWA_SESSION_OPTIONAL: exec.agent.session.header.id },
    })
    registry.register({
      name: 'always-available-fact',
      variables: {
        LIWA_ALWAYS_AVAILABLE: { description: 'Always-available test fact.' },
      },
      resolve: () => ({ LIWA_ALWAYS_AVAILABLE: 'yes' }),
    })

    expect(registry.collect(execution())).not.toHaveProperty('LIWA_SESSION_OPTIONAL')
    expect(registry.collect(execution()).LIWA_ALWAYS_AVAILABLE).toBe('yes')
    expect(registry.collect(execution('session-b')).LIWA_SESSION_OPTIONAL).toBe('session-b')
    expect(registry.list()).toEqual([
      {
        contributor: 'always-available-fact',
        description: 'Always-available test fact.',
        key: 'LIWA_ALWAYS_AVAILABLE',
      },
      {
        contributor: 'optional-session-fact',
        description: 'Optional session-scoped test fact.',
        key: 'LIWA_SESSION_OPTIONAL',
      },
    ])
  })

  it('rejects duplicate variable ownership at registration time', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { liwaHome: './test-liwa-home' })
    registry.register({
      name: 'first',
      variables: { LIWA_SHARED: { description: 'First owner.' } },
      resolve: () => ({ LIWA_SHARED: 'first' }),
    })

    expect(() => registry.register({
      name: 'second',
      variables: { LIWA_SHARED: { description: 'Second owner.' } },
      resolve: () => ({ LIWA_SHARED: 'second' }),
    })).toThrow(/LIWA_SHARED.*first.*second|LIWA_SHARED.*second.*first/)
  })

  it('rejects duplicate contributor names and malformed declarations', () => {
    const registry = new ShellEnvRegistry(new Context(), { liwaHome: './test-liwa-home' })
    registry.register({
      name: 'declared',
      variables: { LIWA_DECLARED: { description: 'Declared fact.' } },
      resolve: () => ({}),
    })

    expect(() => registry.register({
      name: 'declared',
      variables: { LIWA_ANOTHER: { description: 'Another fact.' } },
      resolve: () => ({}),
    })).toThrow(/already registered/)
    expect(() => registry.register({
      name: ' ',
      variables: { LIWA_BLANK_NAME: { description: 'Blank owner.' } },
      resolve: () => ({}),
    })).toThrow(/name must be non-empty/)
    expect(() => registry.register({
      name: 'invalid-key',
      variables: { liwa_invalid: { description: 'Invalid key.' } } as unknown as Record<'LIWA_INVALID', { description: string }>,
      resolve: () => ({}),
    })).toThrow(/invalid key/)
    expect(() => registry.register({
      name: 'reserved-key',
      variables: { LIWA_HOME: { description: 'Reserved key.' } },
      resolve: () => ({}),
    })).toThrow(/reserved key/)
    expect(() => registry.register({
      name: 'blank-description',
      variables: { LIWA_BLANK_DESCRIPTION: { description: ' ' } },
      resolve: () => ({}),
    })).toThrow(/must describe/)
  })

  it('rejects undeclared variables returned by a contributor', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { liwaHome: './test-liwa-home' })
    registry.register({
      name: 'drifted-provider',
      variables: { LIWA_DECLARED: { description: 'Declared fact.' } },
      resolve: () => ({ LIWA_UNDECLARED: 'bad' }),
    })

    expect(() => registry.collect(execution())).toThrow(/drifted-provider.*LIWA_UNDECLARED/)
  })

  it('rejects non-string values returned by a contributor', () => {
    const registry = new ShellEnvRegistry(new Context(), { liwaHome: './test-liwa-home' })
    registry.register({
      name: 'wrong-value-type',
      variables: { LIWA_STRING: { description: 'String fact.' } },
      resolve: () => ({ LIWA_STRING: 42 }) as unknown as Record<'LIWA_STRING', string>,
    })

    expect(() => registry.collect(execution())).toThrow(/wrong-value-type.*non-string.*LIWA_STRING/)
  })

  it('removes an effect-scoped contributor when its plugin is disposed', async () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { liwaHome: './test-liwa-home' })
    const fiber = await ctx.plugin({
      inject: ['shellEnv'],
      apply(inner: Context) {
        inner.shellEnv.register({
          name: 'temporary',
          variables: { LIWA_TEMPORARY: { description: 'Temporary fact.' } },
          resolve: () => ({ LIWA_TEMPORARY: 'present' }),
        })
      },
    })

    expect(registry.collect(execution()).LIWA_TEMPORARY).toBe('present')
    await fiber.dispose()
    expect(registry.collect(execution())).not.toHaveProperty('LIWA_TEMPORARY')
  })

  it('returns an explicit contributor disposer', () => {
    const registry = new ShellEnvRegistry(new Context(), { liwaHome: './test-liwa-home' })
    const dispose = registry.register({
      name: 'explicit-disposal',
      variables: { LIWA_EXPLICIT_DISPOSAL: { description: 'Explicitly disposed fact.' } },
      resolve: () => ({ LIWA_EXPLICIT_DISPOSAL: 'present' }),
    })

    expect(registry.collect(execution()).LIWA_EXPLICIT_DISPOSAL).toBe('present')
    dispose()
    expect(registry.collect(execution())).not.toHaveProperty('LIWA_EXPLICIT_DISPOSAL')
  })

  it('the plugin registers the service with no contributors on load', async () => {
    const ctx = new Context()
    await ctx.plugin(BashEnvPlugin)
    expect(ctx.shellEnv).toBeInstanceOf(ShellEnvRegistry)
    expect(ctx.shellEnv.list()).toEqual([])
  })
})
