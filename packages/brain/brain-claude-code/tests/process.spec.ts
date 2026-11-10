import { afterEach, describe, expect, it } from 'vitest'
import { createBrainTestHost, type BrainTestHost } from '@liwa/brain-testkit'
import { claudeSpawnSpec, ManagedClaudeCodeProcess, sdkEnvironmentOverlay } from '../src/process.ts'

let host: BrainTestHost | undefined
afterEach(async () => { await host?.dispose() })

describe('managed Claude SDK process', () => {
  it('requires an explicit working directory and removes omitted ambient variables', () => {
    expect(() => claudeSpawnSpec({ command: 'claude', args: [], env: {}, signal: new AbortController().signal }, 200)).toThrow('workspace')
    expect(sdkEnvironmentOverlay({ ONLY: 'owned' })).toMatchObject({ ONLY: 'owned', PATH: undefined })
  })

  it('transports protocol streams and waits for actual termination', async () => {
    host = await createBrainTestHost()
    const handle = host.launch().spawn(claudeSpawnSpec({ command: process.execPath, args: ['-e', 'process.stdin.pipe(process.stdout)'], cwd: host.root, env: {}, signal: new AbortController().signal }, 200))
    const child = new ManagedClaudeCodeProcess(handle)
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    const exited = new Promise<void>((resolve) =>{  child.once('exit', () =>{  resolve() }) })
    expect(child.killed).toBe(false)
    expect(child.exitCode).toBeNull()
    expect(child.signalCode).toBeNull()
    child.stdin.end('protocol')
    await exited
    expect(Buffer.concat(chunks).toString()).toBe('protocol')
    expect(child.exitCode).toBe(0)
    expect(child.kill('SIGTERM')).toBe(false)
    await child.dispose()
  })

  it('delegates kill to the managed process owner once', async () => {
    host = await createBrainTestHost()
    const child = new ManagedClaudeCodeProcess(host.launch().spawn(claudeSpawnSpec({ command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], cwd: host.root, env: {}, signal: new AbortController().signal }, 200)))
    expect(child.kill('SIGTERM')).toBe(true)
    expect(child.kill('SIGKILL')).toBe(false)
    expect(child.killed).toBe(true)
    await child.dispose()
    expect(child.outcome).toBeDefined()
  })
})

it('forwards a real spawn failure to SDK listeners without an unhandled error event', async () => {
  host = await createBrainTestHost()
  const handle = host.launch().spawn(claudeSpawnSpec({ command: '/no/such/liwa-claude', args: [], cwd: host.root, env: {}, signal: new AbortController().signal }, 200))
  const child = new ManagedClaudeCodeProcess(handle)
  const error = new Promise<Error>((resolve) =>{  child.on('error', resolve) })
  const ignored = (): void => { throw new Error('removed listener ran') }
  child.on('exit', ignored)
  child.off('exit', ignored)
  expect(await error).toBeInstanceOf(Error)
  await expect(child.dispose()).rejects.toThrow()
})
