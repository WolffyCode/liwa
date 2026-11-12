import { Context } from '@liwa/cordis'
import LocalSubprocessRuntime from '@liwa/subprocess-local'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ProviderCommandError, execProviderCommand, findProviderExecutable, spawnProviderProcess,
  type ProviderProcessHost,
} from '../src/index.ts'
import type { SubprocessHandle, SubprocessOutcome } from '@liwa/subprocess'

describe('provider process helpers', () => {
  const ctx = new Context()
  let host: ProviderProcessHost

  beforeAll(async () => {
    await ctx.plugin(LocalSubprocessRuntime)
    host = ctx.subprocess
  })
  afterAll(async () => { await ctx.fiber.dispose() })

  it('finds an executable or reports null when absent', async () => {
    expect(await findProviderExecutable(host, process.execPath)).toBe(process.execPath)
    expect(await findProviderExecutable(host, 'liwa-no-such-binary-for-tests', { PATH: '/nonexistent', UNSET: undefined })).toBeNull()
    await expect(findProviderExecutable(host, 'relative/path')).rejects.toThrow(/relative path/)
  })

  it('runs a command to completion and collects output', async () => {
    const result = await execProviderCommand(host, process.execPath, ['-e', 'console.log(process.env.BRIDGE_VALUE); console.error("err")'], {
      envOverlay: { BRIDGE_VALUE: 'from-overlay' },
      baseEnv: { OTHER: 'base' },
      cwd: process.cwd(),
    })
    expect(result).toEqual({ stdout: 'from-overlay\n', stderr: 'err\n' })
  })

  it('rejects a failing command with exit facts', async () => {
    const failure = execProviderCommand(host, process.execPath, ['-e', 'console.log("partial"); process.exit(3)'])
    await expect(failure).rejects.toBeInstanceOf(ProviderCommandError)
    await expect(failure).rejects.toMatchObject({ code: 3, killed: false, stdout: 'partial\n' })
  })

  it('terminates a command on timeout and refuses an already-cancelled command', async () => {
    const timedOut = await execProviderCommand(host, process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { timeout: 100, graceMs: 200 })
      .catch((error: unknown) => error)
    expect(timedOut).toBeInstanceOf(ProviderCommandError)
    expect(timedOut).toMatchObject({ killed: true })
    expect(String(timedOut)).toMatch(/terminated after 100ms/)
    const controller = new AbortController()
    controller.abort()
    const cancelled = await execProviderCommand(host, process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { signal: controller.signal, graceMs: 200 })
      .catch((error: unknown) => error)
    expect(cancelled).toMatchObject({ killed: true, code: null })
    expect(String(cancelled)).toMatch(/cancelled before start/)
  })

  it('spawns a long-lived CLI with piped stdio', async () => {
    const handle = spawnProviderProcess(host, process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], {
      cwd: process.cwd(),
      env: { DROPPED: undefined },
      graceMs: 500,
    })
    const chunks: Buffer[] = []
    handle.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk))
    handle.stdin?.end('ping')
    expect((await handle.done).exitCode).toBe(0)
    expect(Buffer.concat(chunks).toString()).toBe('ping')
  })

  it('reports a signaled process with no collected streams and a cancellation without a timeout', async () => {
    const finished = Promise.withResolvers<SubprocessOutcome>()
    const handle: SubprocessHandle = {
      stdin: undefined, stdout: undefined, stderr: undefined, control: undefined, collected: {},
      done: finished.promise, terminate: () => {}, waitForExit: () => Promise.resolve(true),
    }
    const processHost: ProviderProcessHost = { resolveExecutable: command => Promise.resolve(command), spawn: () => handle }
    const signaled = execProviderCommand(processHost, 'fake', [])
    finished.resolve({ exitCode: null, signal: 'SIGTERM' })
    await expect(signaled).rejects.toMatchObject({ killed: false, code: null, stdout: '', stderr: '' })
    const cancelled = Promise.withResolvers<SubprocessOutcome>()
    const signal = new AbortController()
    const running = execProviderCommand({ ...processHost, spawn: () => ({ ...handle, done: cancelled.promise }) }, 'fake', [], { signal: signal.signal })
    signal.abort()
    cancelled.resolve({ exitCode: null, signal: 'SIGTERM' })
    await expect(running).rejects.toThrow('terminated after cancellation')
  })
})
