import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@liwa/cordis'
import { internals as cmdlineInternals, provideCmdline } from '@liwa/cmdline'
import LocalSubprocessRuntime from '@liwa/subprocess-local'
import BrainRegistry, { TurnId } from '@liwa/brain'
import * as scriptedProvider from '@liwa/brain-testkit/plugin'
import { afterEach, describe, expect, it } from 'vitest'
import * as runner from '../src/index.ts'
import * as startup from '../src/startup.ts'
import { internals as runnerInternals } from '../src/runner-internals.ts'
import { internals as startupInternals } from '../src/startup-internals.ts'

interface Run {
  code: number
  stdout: string
  stderr: string
}

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function brain(args: string[], options: { tty?: boolean; answers?: string[]; provider?: boolean } = {}): Promise<Run> {
  const root = await mkdtemp(join(tmpdir(), 'liwa-brain-cli-'))
  const ctx = new Context()
  const out: string[] = []
  const err: string[] = []
  const saved = { ...runnerInternals }
  const savedTty = startupInternals.stdinIsTty
  const savedCmdline = { stdout: cmdlineInternals.stdout, stderr: cmdlineInternals.stderr }
  cmdlineInternals.stdout = { write: (chunk: string) => out.push(chunk) }
  cmdlineInternals.stderr = { write: (chunk: string) => err.push(chunk) }
  runnerInternals.stdout = { write: (chunk: string) => out.push(chunk) }
  runnerInternals.stderr = { write: (chunk: string) => err.push(chunk) }
  const answers = [...options.answers ?? []]
  runnerInternals.ask = async () => answers.shift() ?? ''
  startupInternals.stdinIsTty = () => options.tty ?? false
  cleanups.push(async () => {
    Object.assign(runnerInternals, saved)
    startupInternals.stdinIsTty = savedTty
    Object.assign(cmdlineInternals, savedCmdline)
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const exited = new Promise<number>((resolve) => {
    provideCmdline(ctx, { args, exit: resolve })
  })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(BrainRegistry, { membersRoot: join(root, 'members') })
  if (options.provider !== false) await ctx.plugin(scriptedProvider, { impl: 'fake', process: true, stepDelayMs: 0 })
  await ctx.plugin(startup)
  void ctx.plugin(runner, { maxInferencesPerTurn: 8, maxToolCallsPerTurn: 16, watchdogMs: 60_000, concludeOn: ['report'] })
  const code = await exited
  return { code, stdout: out.join(''), stderr: err.join('') }
}

describe('liwa brain', () => {
  it('lists and probes the mounted providers', async () => {
    const listed = await brain(['list'])
    expect(listed.code).toBe(0)
    expect(listed.stdout).toMatch(/^IMPL\s+TRANSPORT\s+AVAILABLE\s+VERSION\s+PLUGIN\nfake\s+scripted\s+yes\s+scripted/m)
    const json = await brain(['list', '--json'])
    expect(JSON.parse(json.stdout)).toMatchObject([{ impl: 'fake', available: true }])
    const empty = await brain(['list'], { provider: false })
    expect(empty.stdout).toBe('no brain providers are mounted in this profile\n')
    const probed = await brain(['probe', 'fake'])
    expect(probed).toMatchObject({ code: 0 })
    expect(probed.stdout).toContain('available: yes')
    const probedJson = await brain(['probe', 'fake', '--json'])
    expect(JSON.parse(probedJson.stdout)).toMatchObject({ impl: 'fake', available: true, problems: [] })
    const unknown = await brain(['probe', 'nobody'])
    expect(unknown.code).toBe(1)
    expect(unknown.stderr).toContain('no brain provider named nobody')
  })

  it('runs one turn and prints its events', async () => {
    const result = await brain(['run', '--provider', 'fake', '--model', 'scripted-1', 'hello', 'there'])
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/^turn\.started\s+turn=/m)
    expect(result.stdout).toMatch(/^item\.message\s+"Turn 1: you"/m)
    expect(result.stdout).toMatch(/^item\.message\s+.*\(final\)$/m)
    expect(result.stdout).toMatch(/^turn\.completed\s+turn=\S+ usage=\{"tokens"/m)
    expect(result.stdout).toMatch(/^process\.exited/m)
    expect(result.stderr).toMatch(/brain session brain-session-\S+ opened on fake/)
    expect(result.stderr).toMatch(/closed \(usage \{"tokens"/)
  })

  it('answers permissions by mode, in JSON or by asking', async () => {
    const denied = await brain(['run', '--provider', 'fake', '--mode', 'deny', '--json', 'permission please'])
    const events = denied.stdout.trim().split('\n').map(line => JSON.parse(line) as { kind: string; effect?: string; ok?: boolean })
    expect(events.find(event => event.kind === 'permission.resolved')?.effect).toBe('deny_once')
    expect(events.find(event => event.kind === 'item.tool_call.completed')?.ok).toBe(false)
    expect(denied.code).toBe(0)
    const allowed = await brain(['run', '--provider', 'fake', '--mode', 'allow-session', 'permission please'])
    expect(allowed.stdout).toMatch(/permission\.resolved\s+allow-session -> allow_session/)
    const asked = await brain(['run', '--provider', 'fake', 'permission please'], { tty: true, answers: ['1'] })
    expect(asked.stdout).toMatch(/permission\.resolved\s+allow-once -> allow_once/)
    const stopped = await brain(['run', '--provider', 'fake', '--mode', 'ask', 'permission please'], { tty: true, answers: ['4'] })
    expect(stopped.stdout).toMatch(/turn\.interrupted/)
    expect(stopped.code).toBe(1)
  })

  it('reports children, failures, and a CLI exit', async () => {
    const child = await brain(['run', '--provider', 'fake', '--mind', 'work', '--member', 'mina', 'child please'])
    expect(child.stdout).toMatch(/child\.started\s+child-\d+ "explore"/)
    expect(child.stdout).toMatch(/item\.message \[child child-\d+\]/)
    const failed = await brain(['run', '--provider', 'fake', 'fail please'])
    expect(failed.code).toBe(1)
    expect(failed.stdout).toMatch(/turn\.failed\s+turn=\S+ retryable: scripted failure/)
    const exited = await brain(['run', '--provider', 'fake', 'exit please'])
    expect(exited.code).toBe(0)
    // The command closes its session as soon as the turn ends; the CLI exit that follows is the closed session's.
    expect(exited.stdout).toMatch(/^process\.exited\s+code=/m)
  })

  it('rejects unusable invocations', async () => {
    const noTty = await brain(['run', '--provider', 'fake', '--mode', 'ask', 'hi'])
    expect(noTty.code).toBe(1)
    expect(noTty.stderr).toContain('--mode ask needs an interactive terminal')
    const blank = await brain(['run', '--provider', 'fake', ' '])
    expect(blank.stderr).toContain('a prompt is required')
    const help = await brain(['--help'])
    expect(help.stdout).toContain('liwa brain run --provider deepseek')
    const unknown = await brain(['run', '--provider', 'nobody', 'hi'])
    expect(unknown.code).toBe(1)
    expect(unknown.stderr).toContain('no brain provider named nobody')
  })
})

describe('liwa brain helpers', () => {
  it('formats every event kind on one line', () => {
    const lines = [
      runner.formatEvent({ kind: 'session.compacted', preTokens: 10 }),
      runner.formatEvent({ kind: 'usage.update', usage: { inferences: 1 } }),
      runner.formatEvent({ kind: 'turn.interrupted', turnId: TurnId('t') }),
      runner.formatEvent({ kind: 'turn.completed', turnId: TurnId('t'), usage: {}, concludedBy: 'report' }),
    ]
    expect(lines.every(line => !line.includes('\n'))).toBe(true)
    expect(lines[3]).toContain('concludedBy=report')
  })
})
