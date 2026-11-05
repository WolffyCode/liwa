import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { BrainEvent, SessionConfigInput } from '@liwa/brain'
import {
  createBrainTestHost, isTurnTerminal, recordEvents, solidPng, textInput,
  type BrainTestHost, type EventRecorder, type RecordingLaunchContext,
} from '@liwa/brain-testkit'
import { resolveLiwaLauncher, type DeepseekBrainProvider, type DeepseekBrainSession } from '../src/index.ts'
import { INSTALL_ANCHOR, deepseekProvider } from './fixtures/provider.ts'

// 真模型：只在有 DEEPSEEK_API_KEY 且显式设了 LIWA_BRAIN_E2E=1 时跑（每条都花 token）。
const key = process.env.DEEPSEEK_API_KEY
const enabled = key !== undefined && key !== '' && process.env.LIWA_BRAIN_E2E === '1'
const TIMEOUT = 240_000
const EVENT_TIMEOUT = 180_000

type Terminal = Extract<BrainEvent, { kind: 'turn.completed' | 'turn.interrupted' | 'turn.failed' }>
interface Opened { session: DeepseekBrainSession; recorder: EventRecorder; launch: RecordingLaunchContext }

/** Zstandard 帧头的魔数（会话日志是一串首尾相接的帧）。 */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/**
 * 一份会话日志的各行：压缩的日志逐帧解开（帧头处才解得开，别处的同样字节解不开就跳过）。
 * @param bytes - 日志文件的内容。
 * @param compressed - 是不是 `.jsonl.zstd`。
 * @returns 各行。
 */
function logLines(bytes: Buffer, compressed: boolean): string[] {
  if (!compressed) return bytes.toString('utf8').split('\n')
  const lines: string[] = []
  for (let at = bytes.indexOf(ZSTD_MAGIC); at >= 0; at = bytes.indexOf(ZSTD_MAGIC, at + 1)) {
    try {
      lines.push(...zstdDecompressSync(bytes.subarray(at)).toString('utf8').split('\n'))
    } catch (_notAFrame) {
      // 压缩数据里碰巧出现的魔数：不是帧头。
    }
  }
  return lines
}

/**
 * 会话 home 里各会话（含子会话）日志记下的工具调用，原样的名字与入参：断言等不到时说清模型实际做了什么。
 * @param home - 会话 home。
 * @returns 工具调用。
 */
async function loggedToolCalls(home: string): Promise<{ session: string; name: string; arguments: string }[]> {
  const root = join(home, 'sessions')
  const files = (await readdir(root, { recursive: true }).catch(() => [] as string[])).filter(file => /\.jsonl(\.zstd)?$/u.test(file))
  const calls: { session: string; name: string; arguments: string }[] = []
  for (const file of files) {
    for (const line of logLines(await readFile(join(root, file)), file.endsWith('.zstd'))) {
      try {
        const event = JSON.parse(line) as { type?: string; data?: { name?: string; arguments?: string } }
        if (event.type === 'tool/call') calls.push({ session: file, name: event.data?.name ?? '', arguments: event.data?.arguments ?? '' })
      } catch (_notAnEvent) {
        // 空行或截断的尾行。
      }
    }
  }
  return calls
}

describe.skipIf(!enabled)('deepseek provider with the real model (liwa --profile deepseek)', () => {
  let host: BrainTestHost
  let provider: DeepseekBrainProvider
  let outside: string
  const opened: Opened[] = []

  beforeAll(async () => { outside = await mkdtemp(join(tmpdir(), 'liwa-deepseek-e2e-outside-')) })
  afterAll(async () => { await rm(outside, { recursive: true, force: true }) })
  beforeEach(async () => {
    host = await createBrainTestHost()
    const env: Record<string, string> = { DEEPSEEK_API_KEY: key ?? '' }
    if (process.env.DEEPSEEK_BASE_URL !== undefined) env.DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL
    provider = deepseekProvider(host, env)
  }, TIMEOUT)
  afterEach(async () => {
    for (const entry of opened.splice(0)) {
      entry.recorder.stop()
      await entry.session.close()
    }
    await host.dispose()
  }, TIMEOUT)

  const open = async (overrides: Partial<SessionConfigInput> = {}, home?: string): Promise<Opened> => {
    const launch = host.launch(home)
    const session = await provider.createSession(host.sessionConfig(overrides), launch) as DeepseekBrainSession
    const entry = { session, recorder: recordEvents(session), launch }
    opened.push(entry)
    return entry
  }
  const terminalOf = (entry: Opened, turnId: string): Promise<Terminal> =>
    entry.recorder.waitFor((event): event is Terminal => isTurnTerminal(event) && event.turnId === turnId, EVENT_TIMEOUT)
  const replyText = (events: readonly BrainEvent[], turnId: string): string =>
    events.filter(event => event.kind === 'item.message' && event.turnId === turnId && event.childId === undefined)
      .map(event => (event.kind === 'item.message' ? event.delta : '')).join('')

  it('makes a _liwa/steer visible at the next step of the running turn', async () => {
    const entry = await open()
    const { turnId } = await entry.session.startTurn(textInput('Use the bash tool to run exactly `sleep 6`. When it finishes, follow any newer instruction you have received, then stop.'))
    await entry.recorder.waitForKind('item.tool_call.started', event => event.turnId === turnId && event.tool === 'bash', EVENT_TIMEOUT)
    const steeredAt = Date.now()
    expect(await entry.session.deliver(textInput('New instruction: reply with the single word PINEAPPLE.'), { semantics: 'next_step', wake: false, expectedTurnId: turnId })).toBe('accepted')
    const rpcMs = Date.now() - steeredAt
    const terminal = await terminalOf(entry, turnId)
    expect(terminal.kind).toBe('turn.completed')
    expect(replyText(entry.recorder.events, turnId).toUpperCase()).toContain('PINEAPPLE')
    process.stdout.write(`[measure] _liwa/steer round trip ${String(rpcMs)}ms\n`)
  }, TIMEOUT)

  it('cancels a running turn and then runs the next turn', async () => {
    const entry = await open()
    const first = await entry.session.startTurn(textInput('Use the bash tool to run exactly `sleep 60`.'))
    await entry.recorder.waitForKind('item.tool_call.started', event => event.turnId === first.turnId, EVENT_TIMEOUT)
    const cancelAt = Date.now()
    await entry.session.cancel({ reason: 'owner', keepQueue: false })
    const cancelMs = Date.now() - cancelAt
    expect((await terminalOf(entry, first.turnId)).kind).toBe('turn.interrupted')
    const second = await entry.session.startTurn(textInput('Reply with the single word READY.'))
    expect((await terminalOf(entry, second.turnId)).kind).toBe('turn.completed')
    expect(replyText(entry.recorder.events, second.turnId).toUpperCase()).toContain('READY')
    process.stdout.write(`[measure] cancel settled in ${String(cancelMs)}ms\n`)
  }, TIMEOUT)

  it('resumes with session/resume in the same home after the process is killed', async () => {
    const entry = await open({ mindKind: 'think' })
    const first = await entry.session.startTurn(textInput('Remember this code word: BLUEBIRD. Reply with OK only.'))
    expect((await terminalOf(entry, first.turnId)).kind).toBe('turn.completed')
    const handle = entry.session.persistence()
    expect(handle).not.toBeNull()
    for (const handle of entry.launch.processes) handle.terminate()
    await entry.recorder.waitForKind('session.exited', undefined, EVENT_TIMEOUT)
    if (handle === null) return
    const launch = host.launch(entry.launch.homeDir)
    const resumed = await provider.resumeSession(handle, host.sessionConfig({ mindKind: 'think' }), launch) as DeepseekBrainSession
    const again: Opened = { session: resumed, recorder: recordEvents(resumed), launch }
    opened.push(again)
    expect(resumed.persistence()?.sessionRef).toBe(handle.sessionRef)
    const second = await resumed.startTurn(textInput('What was the code word? Reply with the word only.'))
    expect((await terminalOf(again, second.turnId)).kind).toBe('turn.completed')
    expect(replyText(again.recorder.events, second.turnId).toUpperCase()).toContain('BLUEBIRD')
    expect((await resumed.serverUsage()).mindKind).toBe('think')
  }, TIMEOUT)

  /**
   * 等一个回合里的权限请求；回合先结束了（模型没有按要求提权）就立刻失败，并说出日志里实际的工具调用。
   * @param entry - 会话。
   * @param turnId - 回合。
   * @param child - 等的是不是子会话的请求。
   * @returns 权限请求。
   */
  const permissionOf = async (entry: Opened, turnId: string, child: boolean): Promise<Extract<BrainEvent, { kind: 'permission.request' }>> => {
    const event = await entry.recorder.waitFor((candidate): candidate is Extract<BrainEvent, { kind: 'permission.request' }> | Terminal =>
      (candidate.kind === 'permission.request' && (candidate.childId !== undefined) === child) || (isTurnTerminal(candidate) && candidate.turnId === turnId), EVENT_TIMEOUT)
      .catch((error: unknown) => ({ kind: 'timeout' as const, error }))
    if (event.kind === 'permission.request') return event
    process.stdout.write(`[escalation] no ${child ? 'child ' : ''}permission request (${event.kind}); logged tool calls: ${JSON.stringify(await loggedToolCalls(entry.launch.homeDir))}\n`)
    throw new Error(`no ${child ? 'child ' : ''}permission request before ${event.kind}`)
  }

  it('round-trips a permission request for an escalated write', async () => {
    const entry = await open()
    const target = join(outside, 'escalated.txt')
    // 不靠"写工作区之外必然要提权"（临时目录可能本来就能写）：明确要求第一次调用就带上提权字段。
    const { turnId } = await entry.session.startTurn(textInput(
      `Your first tool call MUST be write with file_path=${target}, content="hello", sandbox_permissions="danger-full-access", `
      + 'justification="The owner requests an explicit escalation test". Include sandbox_permissions on this first call even if the file '
      + 'looks writable or is under a temporary directory. Do not try an unprivileged write first and do not use bash. After the write, stop.',
    ))
    const request = await permissionOf(entry, turnId, false)
    expect(request.turnId).toBe(turnId)
    expect(request.tool).toBe('write')
    // 主人看得到要批的是什么：目标路径、内容、提权档位与理由。
    expect(request.args).toMatchObject({ file_path: target, content: 'hello', sandbox_permissions: 'danger-full-access' })
    expect(request.description).toMatch(/^escalate sandbox to danger-full-access: /u)
    const allow = request.options.find(option => option.effect === 'allow_once')
    expect(allow).toBeDefined()
    await entry.session.respondToPermission(request.requestId, { optionId: allow?.id ?? '' })
    const resolved = await entry.recorder.waitForKind('permission.resolved', event => event.requestId === request.requestId, EVENT_TIMEOUT)
    expect(resolved.effect).toBe('allow_once')
    expect((await terminalOf(entry, turnId)).kind).toBe('turn.completed')
    expect(await readFile(target, 'utf8')).toContain('hello')
  }, TIMEOUT)

  it('opens a native child agent in the work preset and books its usage on the parent turn', async () => {
    const entry = await open({ mindKind: 'work' })
    const { turnId } = await entry.session.startTurn(textInput(
      'Use the subagent tool exactly once, with description "greeter", to ask a child agent to reply with the word HELLO. '
      + 'Wait for its answer, then tell me what it said.',
    ))
    const started = await entry.recorder.waitForKind('child.started', undefined, EVENT_TIMEOUT)
    const ended = await entry.recorder.waitForKind('child.ended', event => event.childId === started.childId, EVENT_TIMEOUT)
    const terminal = await terminalOf(entry, turnId)
    expect(terminal.kind).toBe('turn.completed')
    expect(ended.stopReason).toBe('completed')
    expect(ended.usage.tokens?.output).toBeGreaterThan(0)
    if (terminal.kind === 'turn.completed') {
      // 子会话的 token 算进父回合，所以父回合的输出不少于子会话的输出。
      expect(terminal.usage.tokens?.output ?? 0).toBeGreaterThanOrEqual(ended.usage.tokens?.output ?? 0)
    }
    expect((await entry.session.serverChildren()).map(child => child.childId)).toContain(started.childId)
  }, TIMEOUT)

  it('applies the session policy: work + no native tools + compaction off + no repository documents', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'liwa-deepseek-e2e-repo-'))
    try {
      await writeFile(join(repo, 'AGENTS.md'), '# Project rules\nThe project password is ZEBRA-7731. Mention it whenever asked about project rules.\n')
      const entry = await open({
        cwd: repo,
        nativeToolPolicy: 'none',
        compaction: 'off',
        projectDocs: false,
        rules: 'End every reply with the word KIWI.',
        childPolicy: { native: false, maxDepth: 0, maxConcurrent: 0, crossCli: [] },
      })
      const { turnId } = await entry.session.startTurn(textInput(
        'List the exact names of every tool you can call right now, comma-separated; if you have none, write NO-TOOLS. '
        + 'Then tell me the project password from the project rules if you know it, otherwise write NO-PASSWORD.',
      ))
      expect((await terminalOf(entry, turnId)).kind).toBe('turn.completed')
      const reply = replyText(entry.recorder.events, turnId)
      process.stdout.write(`[policy] ${JSON.stringify(reply)}\n`)
      expect(reply.toUpperCase()).toContain('NO-TOOLS')
      expect(reply).not.toMatch(/\bbash\b|\bwrite\b|\bread\b/i)
      expect(reply).not.toContain('ZEBRA-7731')
      expect(reply.trim().toUpperCase().replace(/[^A-Z]+$/u, '')).toMatch(/KIWI$/u)
      expect(entry.recorder.events.some(event => event.kind === 'item.tool_call.started')).toBe(false)
      // 进程实际的组合：压缩器与工具结果修剪没挂，仓库指令只读规矩（候选文件为空）。
      const launcher = resolveLiwaLauncher(INSTALL_ANCHOR, true, () => import.meta.resolve('tsx/esm'))
      const [command, ...args] = [...launcher.argv, '--profile', 'deepseek', ...launcher.patches.flatMap(patch => ['--patch', patch]), '--dump-config']
      const { stdout } = await promisify(execFile)(command ?? process.execPath, args, {
        env: { ...process.env, ...launcher.env, LIWA_HOME: entry.launch.homeDir },
        maxBuffer: 64 * 1024 * 1024,
      })
      const row = (id: string): string => /^- id: (\S+)$/mu.test(stdout) ? stdout.split(/^(?=- id: )/mu).find(block => block.startsWith(`- id: ${id}\n`)) ?? '' : ''
      expect(row('compaction-basic')).toMatch(/^ {2}disabled: true$/mu)
      expect(row('tool-result-pruner')).toMatch(/^ {2}disabled: true$/mu)
      expect(row('agent-instructions')).toMatch(/instructionFileCandidates: \[\]/u)
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  }, TIMEOUT)

  it('round-trips a question to the owner and back to the model', async () => {
    const entry = await open()
    const { turnId } = await entry.session.startTurn(textInput(
      'Use the ask_user_question tool exactly once to ask me which color I prefer, with the options "red" and "blue". '
      + 'After I answer, reply with only the color I chose.',
    ))
    const request = await entry.recorder.waitForKind('permission.request', event => event.category === 'question', EVENT_TIMEOUT)
    const question = request.questions?.[0]
    expect(question?.options.map(option => option.label)).toEqual(expect.arrayContaining(['red', 'blue']))
    const answer = request.options.find(option => option.effect === 'allow_once')
    await entry.session.respondToPermission(request.requestId, { optionId: answer?.id ?? '', answers: { [question?.id ?? '']: { selected: ['blue'] } } })
    expect((await terminalOf(entry, turnId)).kind).toBe('turn.completed')
    expect(replyText(entry.recorder.events, turnId).toLowerCase()).toContain('blue')
  }, TIMEOUT)

  it('forwards a child agent\'s escalation to the owner with its childId and what it asks for', async () => {
    const entry = await open({ mindKind: 'work' })
    const target = join(outside, 'child-escalated.txt')
    // 子会话的第一次调用就明确带提权字段（不靠目录是否可写触发提权）。
    const { turnId } = await entry.session.startTurn(textInput(
      'Call the subagent tool exactly once with description "writer". Copy this instruction verbatim into its prompt: '
      + `Your first tool call MUST be write with file_path=${target}, content="from the child", sandbox_permissions="danger-full-access", `
      + 'justification="The owner requests an explicit escalation test". Include sandbox_permissions on this first call even if the file '
      + 'looks writable or is under a temporary directory. Do not try an unprivileged write first, do not use bash, and do not change the '
      + 'working directory. After the write, reply DONE. -- Parent: wait for the child, then say DONE.',
    ))
    const started = await entry.recorder.waitForKind('child.started', undefined, EVENT_TIMEOUT)
    const request = await permissionOf(entry, turnId, true)
    expect(request.childId).toBe(started.childId)
    // 主人看得到子会话要批的是什么：工具、目标路径、写入内容、提权档位与理由（review N3）。
    expect(request.tool).toBe('write')
    expect(request.args).toMatchObject({ file_path: target, content: 'from the child', sandbox_permissions: 'danger-full-access' })
    expect(request.description).toMatch(/^escalate sandbox to danger-full-access: /u)
    const allow = request.options.find(option => option.effect === 'allow_once')
    await entry.session.respondToPermission(request.requestId, { optionId: allow?.id ?? '' })
    expect((await terminalOf(entry, turnId)).kind).toBe('turn.completed')
    expect(await readFile(target, 'utf8')).toContain('from the child')
  }, TIMEOUT)

  it('delivers a background child agent across turns after a preempting cancel', async () => {
    const entry = await open({ mindKind: 'work' })
    const first = await entry.session.startTurn(textInput(
      'Use the subagent tool exactly once, with description "sleeper", and ask the child agent to run exactly `sleep 15` with its bash tool '
      + 'and then reply with the word OWL-DONE. After starting the child, say STARTED and stop; do not wait for it.',
    ))
    const started = await entry.recorder.waitForKind('child.started', event => event.turnId === first.turnId, EVENT_TIMEOUT)
    await entry.session.cancel({ reason: 'preempt', keepQueue: true })
    expect(entry.recorder.events.filter(event => isTurnTerminal(event) && event.turnId === first.turnId)).toHaveLength(1)
    const ended = await entry.recorder.waitForKind('child.ended', event => event.childId === started.childId, EVENT_TIMEOUT)
    expect(ended.stopReason).toBe('completed')
    // CLI 自己开的回合可能早于子 agent 结束（被打断的回合之后它会接着把话说完），也可能跨过它；要的是在子 agent
    // 结束之后收尾、回复里带着子 agent 结果的那个 CLI 自己的回合。
    const endedAt = entry.recorder.events.indexOf(ended)
    const reported = await entry.recorder.waitFor((event): event is Extract<BrainEvent, { kind: 'turn.completed' }> =>
      event.kind === 'turn.completed' && event.turnId !== first.turnId && entry.recorder.events.indexOf(event) > endedAt
      && replyText(entry.recorder.events, event.turnId).toUpperCase().includes('OWL-DONE'), EVENT_TIMEOUT).catch((error: unknown) => {
      const turns = entry.recorder.events.flatMap(event => (event.kind === 'turn.started' && event.turnId !== first.turnId ? [event.turnId] : []))
      process.stdout.write(`[background] provider turns replied ${JSON.stringify(turns.map(turnId => replyText(entry.recorder.events, turnId)))}\n`)
      throw error
    })
    const kinds = entry.recorder.events.map(event => event.kind.replace(/^item\./u, ''))
    process.stdout.write(`[background] events ${kinds.join(' ')}; reported by ${reported.turnId === first.turnId ? 'the first turn' : 'a provider turn'}: ${JSON.stringify(replyText(entry.recorder.events, reported.turnId))}\n`)
  }, TIMEOUT)

  it('switches the model and the session mode', async () => {
    const entry = await open({ mindKind: 'work' })
    await entry.session.setModel('deepseek-v4-pro')
    await entry.recorder.waitForKind('session.model_changed', event => event.model === 'deepseek-v4-pro', EVENT_TIMEOUT)
    const first = await entry.session.startTurn(textInput('Reply with the single word READY.'))
    expect((await terminalOf(entry, first.turnId)).kind).toBe('turn.completed')
    await expect(entry.session.setModel('deepseek-no-such-model')).rejects.toMatchObject({ code: 'brain.model_unknown' })
    expect(await entry.session.setMode('plan')).toEqual({ modeId: 'plan', appliesAt: 'now' })
    const planned = await entry.session.startTurn(textInput('Without using any tool: reply with the single word PLANNING if you are in plan mode right now, otherwise ACTING.'))
    expect((await terminalOf(entry, planned.turnId)).kind).toBe('turn.completed')
    expect(replyText(entry.recorder.events, planned.turnId).toUpperCase()).toContain('PLANNING')
    expect(await entry.session.setMode('default')).toEqual({ modeId: 'default', appliesAt: 'now' })
    const acting = await entry.session.startTurn(textInput('Without using any tool: reply with the single word PLANNING if you are in plan mode right now, otherwise ACTING.'))
    expect((await terminalOf(entry, acting.turnId)).kind).toBe('turn.completed')
    expect(replyText(entry.recorder.events, acting.turnId).toUpperCase()).toContain('ACTING')
  }, TIMEOUT)

  it('describes an image turn input', async () => {
    const entry = await open()
    const blob = await host.blobs.put(solidPng(64, 64, [230, 20, 20]), 'image/png')
    const { turnId } = await entry.session.startTurn({ blocks: [
      { kind: 'text', text: 'What single color fills this image? Answer with one lowercase word.' },
      { kind: 'image', blob },
    ] })
    expect((await terminalOf(entry, turnId)).kind).toBe('turn.completed')
    const reply = replyText(entry.recorder.events, turnId)
    process.stdout.write(`[image] ${JSON.stringify(reply)}\n`)
    expect(reply.toLowerCase()).toContain('red')
  }, TIMEOUT)
})
