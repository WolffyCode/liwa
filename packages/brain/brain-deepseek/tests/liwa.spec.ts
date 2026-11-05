import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { BrainEvent, BrainProviderSession, SessionConfigInput } from '@liwa/brain'
import {
  createBrainTestHost, isTurnTerminal, recordEvents, textInput,
  type BrainTestHost, type EventRecorder,
} from '@liwa/brain-testkit'
import { resolveLiwaLauncher, type DeepseekBrainProvider, type DeepseekBrainSession } from '../src/index.ts'
import { INSTALL_ANCHOR, deepseekProvider } from './fixtures/provider.ts'
import { startScriptedModel, type ScriptedModel } from './fixtures/scripted-model.ts'

const TIMEOUT = 120_000
const EVENT_TIMEOUT = 45_000

interface RequestBody {
  system?: string | { type?: string; text?: string }[]
  tools?: { name?: string }[]
  messages?: { content?: unknown }[]
}

function systemText(body: RequestBody): string {
  return typeof body.system === 'string' ? body.system : (body.system ?? []).map(block => block.text ?? '').join('\n')
}

describe('deepseek _liwa over a real liwa --profile deepseek process', () => {
  let model: ScriptedModel
  let files: string
  let host: BrainTestHost
  let provider: DeepseekBrainProvider
  const opened: { session: BrainProviderSession; recorder: EventRecorder; home: string }[] = []

  beforeAll(async () => {
    files = await mkdtemp(join(tmpdir(), 'liwa-deepseek-liwa-'))
    await writeFile(join(files, 'README.md'), '# fixture\n')
    model = await startScriptedModel({ readPath: join(files, 'README.md'), outsidePath: join(files, 'outside.txt') })
  })
  afterAll(async () => {
    await model.close()
    await rm(files, { recursive: true, force: true })
  })
  beforeEach(async () => {
    host = await createBrainTestHost()
    provider = deepseekProvider(host, { DEEPSEEK_API_KEY: 'scripted-key', DEEPSEEK_BASE_URL: model.baseURL })
  }, TIMEOUT)
  afterEach(async () => {
    for (const entry of opened.splice(0)) {
      entry.recorder.stop()
      await entry.session.close()
    }
    await host.dispose()
  }, TIMEOUT)

  interface OpenedSession { session: DeepseekBrainSession; recorder: EventRecorder; home: string }
  const open = async (overrides: Partial<SessionConfigInput> = {}): Promise<OpenedSession> => {
    const launch = host.launch()
    const session = await provider.createSession(host.sessionConfig(overrides), launch) as DeepseekBrainSession
    const entry = { session, recorder: recordEvents(session), home: launch.homeDir }
    opened.push(entry)
    return entry
  }

  /**
   * 会话进程实际的组合（`liwa --profile deepseek --dump-config`，同一个会话 home 与会话 patch）：行号 → 是否关着。
   * @param home - 会话 home（它的 LIWA_HOME）。
   * @returns 各行是否 `disabled`。
   */
  const effectiveRows = async (home: string): Promise<Map<string, boolean>> => {
    const launcher = resolveLiwaLauncher(INSTALL_ANCHOR, true, () => import.meta.resolve('tsx/esm'))
    const [command, ...args] = [...launcher.argv, '--profile', 'deepseek', ...launcher.patches.flatMap(patch => ['--patch', patch]), '--dump-config']
    const { stdout } = await promisify(execFile)(command ?? process.execPath, args, {
      env: { ...process.env, ...launcher.env, LIWA_HOME: home, DEEPSEEK_API_KEY: 'scripted-key' },
      maxBuffer: 64 * 1024 * 1024,
    })
    const rows = new Map<string, boolean>()
    let current: string | undefined
    for (const line of stdout.split('\n')) {
      const row = /^- id: (\S+)$/u.exec(line)
      if (row?.[1] !== undefined) {
        current = row[1]
        rows.set(current, false)
      } else if (current !== undefined && /^ {2}disabled: true$/u.test(line)) {
        rows.set(current, true)
      } else if (!line.startsWith(' ')) {
        current = undefined
      }
    }
    return rows
  }

  const turn = async (entry: { session: BrainProviderSession; recorder: EventRecorder }, text: string): Promise<Extract<BrainEvent, { kind: 'turn.completed' | 'turn.interrupted' | 'turn.failed' }>> => {
    const { turnId } = await entry.session.startTurn(textInput(text))
    return entry.recorder.waitFor((event): event is Extract<BrainEvent, { kind: 'turn.completed' | 'turn.interrupted' | 'turn.failed' }> =>
      isTurnTerminal(event) && event.turnId === turnId, EVENT_TIMEOUT)
  }

  const requestsWith = (token: string): RequestBody[] =>
    (model.requests as RequestBody[]).filter(body => JSON.stringify(body.messages ?? []).includes(token))

  it('composes each session from _meta.liwa: preset by kind, persona prefix, session notes', async () => {
    const instanceToken = `instance-${randomUUID()}`
    const instance = await open({
      mindKind: 'instance',
      persona: { stable: 'PERSONA-MARK: you are Mina.', notes: 'NOTES-MARK: the owner is away today.', version: 'v7' },
      childPolicy: { native: false, maxDepth: 0, maxConcurrent: 0, crossCli: [] },
    })
    expect((await turn(instance, `scenario:reply ${instanceToken}`)).kind).toBe('turn.completed')
    const [instanceRequest] = requestsWith(instanceToken)
    expect(instanceRequest).toBeDefined()
    const system = systemText(instanceRequest ?? {})
    expect(system).toContain('PERSONA-MARK: you are Mina.')
    expect(system).toContain('NOTES-MARK: the owner is away today.')
    expect(system).not.toContain('powered by 灵鲸')
    const instanceTools = (instanceRequest?.tools ?? []).map(tool => tool.name)
    expect(instanceTools).not.toContain('bash')
    expect(instanceTools).not.toContain('read')

    const workToken = `work-${randomUUID()}`
    const work = await open({ mindKind: 'work' })
    expect((await turn(work, `scenario:reply ${workToken}`)).kind).toBe('turn.completed')
    const workTools = (requestsWith(workToken)[0]?.tools ?? []).map(tool => tool.name)
    expect(workTools).toEqual(expect.arrayContaining(['bash', 'read', 'subagent']))
    expect((await work.session.serverUsage()).mindKind).toBe('work')
  }, TIMEOUT)

  it('reports usage with inferences and ends the turn on a conclude tool', async () => {
    const entry = await open({ concludeOn: ['read'] })
    const terminal = await turn(entry, `scenario:tool ${randomUUID()}`)
    expect(terminal).toMatchObject({ kind: 'turn.completed', concludedBy: 'read', usage: { inferences: 1 } })
    if (terminal.kind === 'turn.completed') expect(terminal.usage.tokens?.input).toBeGreaterThan(0)
  }, TIMEOUT)

  it('rejects the step past the inference budget and still closes the turn', async () => {
    const token = randomUUID()
    const entry = await open({ limits: { maxInferencesPerTurn: 1, maxToolCallsPerTurn: 8, watchdogMs: 60_000 } })
    const terminal = await turn(entry, `scenario:tool ${token}`)
    expect(terminal).toMatchObject({ kind: 'turn.completed', usage: { inferences: 1 } })
    expect(requestsWith(token)).toHaveLength(1)
  }, TIMEOUT)

  it('denies tool calls past the tool budget', async () => {
    const entry = await open({ limits: { maxInferencesPerTurn: 8, maxToolCallsPerTurn: 1, watchdogMs: 60_000 } })
    expect((await turn(entry, `scenario:two-tools ${randomUUID()}`)).kind).toBe('turn.completed')
    const completed = entry.recorder.events.flatMap(event => (event.kind === 'item.tool_call.completed' ? [event.ok] : []))
    expect(completed).toEqual([true, false])
  }, TIMEOUT)

  it('steers into the next step of the running turn', async () => {
    const entry = await open()
    const { turnId } = await entry.session.startTurn(textInput(`scenario:steer ${randomUUID()}`))
    await entry.recorder.waitForKind('item.tool_call.started', event => event.turnId === turnId, EVENT_TIMEOUT)
    expect(await entry.session.deliver(textInput('STEER-MARK: also say hi'), { semantics: 'next_step', wake: false, expectedTurnId: turnId })).toBe('accepted')
    await entry.recorder.waitForKind('turn.completed', event => event.turnId === turnId, EVENT_TIMEOUT)
    const reply = entry.recorder.events.filter(event => event.kind === 'item.message').map(event => (event.kind === 'item.message' ? event.delta : '')).join('')
    expect(reply).toBe('steer seen')
  }, TIMEOUT)

  it('forwards a native child agent\'s escalation to the owner with its childId, never to the parent (01 §4.5, §10 item 9)', async () => {
    const entry = await open()
    const token = randomUUID()
    const { turnId } = await entry.session.startTurn(textInput(`scenario:child-permission ${token}`))
    const started = await entry.recorder.waitForKind('child.started', undefined, EVENT_TIMEOUT)
    expect(started.turnId).toBe(turnId)
    // 子会话越权写：请求经根会话直推主人，带上子会话号；父会话（模型）没有答复的路。
    const request = await entry.recorder.waitForKind('permission.request', undefined, EVENT_TIMEOUT)
    expect(request.childId).toBe(started.childId)
    expect(request.category).toBe('tool')
    // 主人看得到要批的是什么：子会话这次调用的工具、目标路径、写入内容与提权理由（review N3）。
    expect(request.tool).toBe('write')
    expect(request.args).toMatchObject({ file_path: join(files, 'outside.txt'), content: 'child\n', sandbox_permissions: 'danger-full-access' })
    expect(request.description).toMatch(/^escalate sandbox to danger-full-access: the child asks for a write outside the workspace/u)
    const allow = request.options.find(option => option.effect === 'allow_once')
    expect(allow).toBeDefined()
    await entry.session.respondToPermission(request.requestId, { optionId: allow?.id ?? '' })
    await entry.recorder.waitForKind('permission.resolved', event => event.requestId === request.requestId, EVENT_TIMEOUT)
    await entry.recorder.waitForKind('child.ended', event => event.childId === started.childId, EVENT_TIMEOUT)
    const terminal = await entry.recorder.waitFor((event): event is Extract<BrainEvent, { kind: 'turn.completed' }> => event.kind === 'turn.completed' && event.turnId === turnId, EVENT_TIMEOUT)
    expect(await readFile(join(files, 'outside.txt'), 'utf8')).toBe('child\n')
    // 子会话的 token 算进父回合；推理次数只数父会话自己的模型调用（含子会话完成后续跑的那一步）。
    expect(terminal.usage.inferences).toBe(requestsWith(token).length)
    const children = await entry.session.serverChildren()
    expect(children).toHaveLength(1)
    expect(children[0]).toMatchObject({ childId: started.childId, state: 'ended', stopReason: 'completed', label: 'spawn' })
    expect(children[0]?.usage.inferences).toBe(2)
  }, TIMEOUT)

  it('applies the session policy: work + nativeToolPolicy none + compaction off + no repository documents + rules', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'liwa-deepseek-repo-'))
    const token = `policy-${randomUUID()}`
    try {
      await writeFile(join(repo, 'AGENTS.md'), '# REPO-DOC-MARK must not reach the model\n')
      const entry = await open({
        cwd: repo,
        nativeToolPolicy: 'none',
        compaction: 'off',
        projectDocs: false,
        rules: 'RULES-MARK: always answer in one line.',
        childPolicy: { native: false, maxDepth: 0, maxConcurrent: 0, crossCli: [] },
      })
      expect((await turn(entry, `scenario:reply ${token}`)).kind).toBe('turn.completed')
      const [request] = requestsWith(token)
      expect(request).toBeDefined()
      expect((request?.tools ?? []).map(tool => tool.name)).toEqual([])
      const sent = JSON.stringify(request)
      expect(sent).toContain('RULES-MARK: always answer in one line.')
      expect(sent).toContain('本交接优先于通用指令。')
      expect(sent).not.toContain('REPO-DOC-MARK')
      // 不给的工具也不在系统提示词里出现它们的用法（否则模型以为自己有、照着文字去调）。
      for (const guidance of ['[exit code: N]', 'job_output', 'get_goal', 'subagent', 'workflow', 'Use the read tool', 'web_search', 'ask_user_question']) {
        expect(sent).not.toContain(guidance)
      }
      const composition = await effectiveRows(entry.home)
      expect(composition.get('compaction-basic')).toBe(true)
      expect(composition.get('tool-result-pruner')).toBe(true)
      expect(composition.get('agent-instructions')).toBe(false)
      expect(composition.get('skill-filesystem')).toBe(true)
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  }, TIMEOUT)

  it('applies the session policy: readonly tools, repository documents, and the member skills', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'liwa-deepseek-repo-'))
    const skills = await mkdtemp(join(tmpdir(), 'liwa-deepseek-skills-'))
    const token = `readonly-${randomUUID()}`
    try {
      await writeFile(join(repo, 'AGENTS.md'), '# REPO-DOC-MARK reaches the model in work sessions\n')
      await mkdir(join(skills, 'member-skill'), { recursive: true })
      await writeFile(join(skills, 'member-skill', 'SKILL.md'), '---\nname: member-skill\ndescription: SKILL-MARK member skill\n---\nUse it.\n')
      const entry = await open({
        cwd: repo,
        nativeToolPolicy: 'readonly',
        projectDocs: true,
        skillsDir: skills,
        childPolicy: { native: false, maxDepth: 0, maxConcurrent: 0, crossCli: [] },
      })
      expect((await turn(entry, `scenario:reply ${token}`)).kind).toBe('turn.completed')
      const [request] = requestsWith(token)
      const tools = (request?.tools ?? []).map(tool => tool.name)
      expect(tools).toEqual(expect.arrayContaining(['read', 'grep', 'glob', 'skill', 'web_search']))
      for (const writer of ['bash', 'write', 'edit', 'subagent', 'subagent_fork', 'job_kill']) expect(tools).not.toContain(writer)
      const sent = JSON.stringify(request)
      expect(sent).toContain('REPO-DOC-MARK')
      expect(sent).toContain('SKILL-MARK')
    } finally {
      await rm(repo, { recursive: true, force: true })
      await rm(skills, { recursive: true, force: true })
    }
  }, TIMEOUT)

  it('refuses combinations it cannot honour before starting a process', async () => {
    const skills = await mkdtemp(join(tmpdir(), 'liwa-deepseek-skills-'))
    try {
      const launch = host.launch()
      await expect(provider.createSession(host.sessionConfig({ nativeToolPolicy: 'none', skillsDir: skills, childPolicy: { native: false, maxDepth: 0, maxConcurrent: 0, crossCli: [] } }), launch))
        .rejects.toMatchObject({ code: 'brain.deepseek_policy_conflict' })
      await expect(provider.createSession(host.sessionConfig({ nativeToolPolicy: 'readonly' }), launch))
        .rejects.toMatchObject({ code: 'brain.deepseek_policy_conflict' })
      await expect(provider.createSession(host.sessionConfig({ env: { LIWA_HOME: '/elsewhere' } }), launch))
        .rejects.toMatchObject({ code: 'brain.env_clash' })
      await expect(provider.createSession(host.sessionConfig({ mindKind: 'think', modeId: 'plan', childPolicy: { native: false, maxDepth: 0, maxConcurrent: 0, crossCli: [] } }), launch))
        .rejects.toMatchObject({ code: 'brain.mode_unknown' })
      expect(launch.processes.filter(handle => handle !== undefined).length).toBeLessThanOrEqual(1)
    } finally {
      await rm(skills, { recursive: true, force: true })
    }
  }, TIMEOUT)

  it('enters plan mode: the plan policy reaches the model and the mode change is reported', async () => {
    const entry = await open({ modeId: 'plan' })
    expect(await entry.session.currentMode()).toBe('plan')
    const token = `plan-${randomUUID()}`
    expect((await turn(entry, `scenario:reply ${token}`)).kind).toBe('turn.completed')
    expect(JSON.stringify(requestsWith(token)[0])).toContain('You are in plan mode.')
    expect(await entry.session.setMode('default')).toEqual({ modeId: 'default', appliesAt: 'now' })
    await entry.recorder.waitForKind('session.mode_changed', event => event.modeId === 'default', EVENT_TIMEOUT)
    const after = `default-${randomUUID()}`
    expect((await turn(entry, `scenario:reply ${after}`)).kind).toBe('turn.completed')
    // 系统提示词的更新进对话历史（DeepSeek 的 in-history）：切回默认模式时模型收到切换的说明。
    expect(JSON.stringify(requestsWith(after)[0])).toContain('The user switched this session back to the default mode.')
  }, TIMEOUT)

  it('runs the plan-mode loop: the plan review reaches the owner as a question, approval leaves plan mode', async () => {
    const entry = await open({ modeId: 'plan' })
    const { turnId } = await entry.session.startTurn(textInput(`scenario:plan-exit ${randomUUID()}`))
    const review = await entry.recorder.waitForKind('permission.request', event => event.category === 'question', EVENT_TIMEOUT)
    // 表单字段只有标题与说明：问题与它的细节（计划全文）一起放在说明里。
    expect(review.questions?.[0]?.question).toContain('Approve this plan and leave plan mode?')
    expect(review.questions?.[0]?.question).toContain('# Add a README section')
    const answer = review.options.find(option => option.effect === 'allow_once')
    const approve = review.questions?.[0]?.options.find(option => option.label === 'Approve')
    await entry.session.respondToPermission(review.requestId, { optionId: answer?.id ?? '', answers: { [review.questions?.[0]?.id ?? '']: { selected: [approve?.label ?? ''] } } })
    await entry.recorder.waitFor((event): event is Extract<BrainEvent, { kind: 'turn.completed' }> => event.kind === 'turn.completed' && event.turnId === turnId, EVENT_TIMEOUT)
    expect(entry.recorder.events.filter(event => event.kind === 'item.message' && event.turnId === turnId).map(event => (event.kind === 'item.message' ? event.delta : '')).join('')).toContain('Plan approved')
    await entry.recorder.waitForKind('session.mode_changed', event => event.modeId === 'default', EVENT_TIMEOUT)
    expect(await entry.session.currentMode()).toBe('default')
  }, TIMEOUT)

  it('switches the model for later requests', async () => {
    const entry = await open()
    await entry.session.setModel('deepseek-v4-pro')
    await entry.recorder.waitForKind('session.model_changed', event => event.model === 'deepseek-v4-pro', EVENT_TIMEOUT)
    const token = `model-${randomUUID()}`
    expect((await turn(entry, `scenario:reply ${token}`)).kind).toBe('turn.completed')
    expect((requestsWith(token)[0] as { model?: string } | undefined)?.model).toBe('deepseek-v4-pro')
  }, TIMEOUT)

  it('keeps native child agents off when the session child policy says so', async () => {
    const entry = await open({ childPolicy: { native: false, maxDepth: 1, maxConcurrent: 2, crossCli: [] } })
    expect((await turn(entry, `scenario:child ${randomUUID()}`)).kind).toBe('turn.completed')
    expect(entry.recorder.events.some(event => event.kind === 'child.started')).toBe(false)
    const subagent = entry.recorder.events.find(event => event.kind === 'item.tool_call.completed')
    expect(subagent).toMatchObject({ ok: false })
  }, TIMEOUT)
})
