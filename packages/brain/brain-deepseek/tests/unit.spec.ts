import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BrainError, ImplId, PermissionRequestId, SessionConfigSchema } from '@liwa/brain'
import { paseoLogger } from '@liwa/brain-shared'
import { createBrainTestHost, recordEvents, sampleSessionConfig } from '@liwa/brain-testkit'
import type { AgentSession, AgentStreamEvent } from '@liwa/brain-shared/paseo/agent/agent-sdk-types'
import {
  DEEPSEEK_META, DeepseekACPAgentClient, DeepseekBrainProvider, DeepseekBrainSession, LiwaChannel, RULES_FILE, SESSION_PATCH_FILE,
  liwaSessionMeta, resolveLiwaLauncher, runsFromSource, sessionPatchRows, writeRules, writeSessionPatch,
} from '../src/index.ts'
import { INSTALL_ANCHOR } from './fixtures/provider.ts'

const settings = { provider: 'deepseek-official', apiKeyEnv: 'DEEPSEEK_API_KEY', presetPrefix: 'deepseek-', instructionsMaxBytes: 65_536 }

describe('deepseek session patch and launch', () => {
  it('writes one patch per launch: key name, preset by kind, persona, the model only when given, and the session policy', async () => {
    const config = SessionConfigSchema.parse(sampleSessionConfig('/w', { mindKind: 'instance', persona: { stable: 'You are Mina. {{not a variable}}', notes: 'n', version: 'v' }, model: 'deepseek-v4-pro', compaction: 'off', rules: 'be brief' }))
    expect(sessionPatchRows(config, settings)).toEqual([
      { id: 'llm-deepseek', config: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
      { id: 'agent-preset-registry', config: { default: 'deepseek-instance' } },
      { id: 'system-prompt', config: { personaPrefix: 'You are Mina. {{not a variable}}', includeLiwaIdentity: false } },
      { id: 'agent-default-model', config: { provider: 'deepseek-official', model: 'deepseek-v4-pro' } },
      { id: 'agent-instructions', disabled: false, config: { maxBytes: 65_536, instructionFileCandidates: [], localInstructionFileCandidates: [] } },
      { id: 'skill-filesystem', disabled: true, config: { includeDefaultRoots: false, customSkillDirs: [] } },
      { id: 'tool-skill', disabled: true },
      { id: 'compaction-basic', disabled: true },
      { id: 'tool-result-pruner', disabled: true },
    ])
    const bare = SessionConfigSchema.parse(sampleSessionConfig('/w', { projectDocs: true, skillsDir: '/skills' }))
    expect(sessionPatchRows(bare, settings)).toEqual([
      { id: 'llm-deepseek', config: { apiKeyEnv: 'DEEPSEEK_API_KEY' } },
      { id: 'agent-preset-registry', config: { default: 'deepseek-work' } },
      { id: 'agent-instructions', disabled: false, config: { maxBytes: 65_536 } },
      { id: 'skill-filesystem', disabled: false, config: { includeDefaultRoots: true, customSkillDirs: ['/skills'] } },
      { id: 'tool-skill', disabled: false },
      { id: 'compaction-basic', disabled: false },
      { id: 'tool-result-pruner', disabled: false },
    ])
    const plain = SessionConfigSchema.parse(sampleSessionConfig('/w'))
    expect(sessionPatchRows(plain, settings).find(row => row.id === 'agent-instructions')).toMatchObject({ disabled: true })
    const home = await mkdtemp(join(tmpdir(), 'liwa-deepseek-patch-'))
    try {
      const path = await writeSessionPatch(home, config, settings)
      expect(path).toBe(join(home, SESSION_PATCH_FILE))
      const text = await readFile(path, 'utf8')
      expect(JSON.parse(text.slice(text.indexOf('\n') + 1))).toEqual(sessionPatchRows(config, settings))
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('maps a session config onto `_meta.liwa`', () => {
    const config = SessionConfigSchema.parse(sampleSessionConfig('/w'))
    expect(liwaSessionMeta(config)).toEqual({
      mindKind: 'work', owner: { taskId: 'contract-task', gen: 1 }, notes: '', version: 'test',
      limits: { maxInferencesPerTurn: 8, maxToolCallsPerTurn: 16, watchdogMs: 60_000 },
      concludeOn: ['report'], childPolicy: { native: true, maxDepth: 1, maxConcurrent: 2 }, nativeToolPolicy: 'worktree',
    })
  })

  it('writes the member rules as the user-level instruction file, and removes them when empty', async () => {
    const home = await mkdtemp(join(tmpdir(), 'liwa-deepseek-rules-'))
    try {
      expect(await writeRules(home, 'Answer briefly.')).toBe(join(home, RULES_FILE))
      expect(await readFile(join(home, RULES_FILE), 'utf8')).toBe('本交接优先于通用指令。\n\nAnswer briefly.\n')
      expect(await writeRules(home, '  ')).toBeUndefined()
      await expect(readFile(join(home, RULES_FILE), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('launches the same installation, from source when the parent runs from source', () => {
    const source = resolveLiwaLauncher(INSTALL_ANCHOR, true, () => 'file:///tsx/esm')
    expect(source.argv.slice(1, 3)).toEqual(['--import', 'file:///tsx/esm'])
    expect(source.argv.at(-1)).toMatch(/apps[/\\]cli[/\\]src[/\\]bin\.ts$/)
    expect(source.env.TSX_TSCONFIG_PATH).toMatch(/apps[/\\]cli[/\\]tsconfig\.json$/)
    expect(source.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(runsFromSource(INSTALL_ANCHOR, join(INSTALL_ANCHOR, '..', 'src', 'bin.ts'))).toBe(true)
    expect(runsFromSource(INSTALL_ANCHOR, undefined)).toBe(false)
    expect(() => resolveLiwaLauncher('/no/such/install/package.json', true, () => 'x')).toThrow(/neither/)
  })

  it('registers as unavailable, without spawning, when the installation cannot start liwa', async () => {
    const host = await createBrainTestHost()
    try {
      const provider = new DeepseekBrainProvider({
        impl: ImplId('deepseek'),
        client: new DeepseekACPAgentClient({
          logger: paseoLogger(host.ctx.logger('brain-deepseek-test')),
          command: ['liwa', '--profile', 'deepseek'],
          env: {},
          processHost: host.ctx.subprocess,
        }),
        patch: settings,
        env: { resolve: () => Promise.resolve({ DEEPSEEK_API_KEY: 'k' }) },
        version: undefined,
        launcherProblem: 'the Liwa installation at /w has neither lib/bin.js nor src/bin.ts',
      })
      expect(await provider.probe(host.probeContext())).toEqual({
        available: false, problems: ['the Liwa installation at /w has neither lib/bin.js nor src/bin.ts'],
      })
      const launch = host.launch()
      const opening = provider.createSession(host.sessionConfig(), launch)
      await expect(opening).rejects.toBeInstanceOf(BrainError)
      await expect(opening).rejects.toMatchObject({ category: 'unavailable' })
      expect(launch.processes).toEqual([])
    } finally {
      await host.dispose()
    }
  })
})

describe('deepseek _liwa client codec', () => {
  it('sends `_meta.liwa` on session/new and resume, and keep-queue only on the next cancel', () => {
    const channel = new LiwaChannel({ mindKind: 'think' })
    expect(channel.requestMeta('session/new')).toEqual({ liwa: { mindKind: 'think' } })
    expect(channel.requestMeta('session/resume')).toEqual({ liwa: { mindKind: 'think' } })
    expect(channel.requestMeta('session/prompt')).toBeUndefined()
    expect(channel.requestMeta('session/cancel')).toBeUndefined()
    channel.armCancel(true, false)
    expect(channel.requestMeta('session/cancel')).toEqual({ liwa: { keepQueue: true, stopChildren: false } })
    expect(channel.requestMeta('session/cancel')).toBeUndefined()
  })

  it('turns `_meta.liwa` from the server into usage, conclude tools, child events, and permission sources', () => {
    const subscribers = new Set<(event: AgentStreamEvent) => void>()
    const paseo = {
      provider: 'deepseek', id: 's1',
      subscribe: (callback: (event: AgentStreamEvent) => void) => {
        subscribers.add(callback)
        return () => { subscribers.delete(callback) }
      },
    } as Pick<AgentSession, 'provider' | 'id' | 'subscribe'> as AgentSession
    const push = (event: AgentStreamEvent): void => { for (const subscriber of subscribers) subscriber(event) }
    const channel = new LiwaChannel({})
    // 握手期间到的消息先缓存，会话包好时交出（此时还没有订阅者，所以这一条不进记录）。
    channel.observe({ kind: 'session-update', notification: { sessionId: 's1', update: { sessionUpdate: 'session_info_update' }, _meta: { liwa: { child: { event: 'started', childId: 'k0', label: 'early' } } } } })
    const session = new DeepseekBrainSession({ impl: ImplId('deepseek'), meta: DEEPSEEK_META, session: paseo, blobs: { readBlob: () => Promise.reject(new Error('no blobs')) } }, channel)
    const events = recordEvents(session).events
    channel.observe({ kind: 'session-update', notification: { sessionId: 's1', update: { sessionUpdate: 'session_info_update' }, _meta: { liwa: { child: { event: 'started', childId: 'k1', label: 'spawn' } } } } })
    push({ type: 'turn_started', provider: 'deepseek', turnId: 't1' })
    channel.observe({ kind: 'permission-request', requestId: 'p1', request: { sessionId: 's1', toolCall: { toolCallId: 'c' }, options: [], _meta: { liwa: { childId: 'k1' } } } })
    push({ type: 'permission_requested', provider: 'deepseek', turnId: 't1', request: { id: 'p1', provider: 'deepseek', name: 'other', title: 'write', kind: 'tool', actions: [{ id: 'allow-once', label: 'Allow', behavior: 'allow' }] } })
    channel.observe({ kind: 'session-update', notification: { sessionId: 's1', update: { sessionUpdate: 'session_info_update' }, _meta: { liwa: { child: { event: 'ended', childId: 'k1', stopReason: 'completed', usage: { tokens: { input: 3, output: 1 }, inferences: 1 } } } } } })
    channel.observe({ kind: 'prompt-response', turnId: 't1', response: { stopReason: 'end_turn', _meta: { liwa: { usage: { tokens: { input: 9, output: 4 }, inferences: 2 }, concludedBy: 'reply' } } } })
    push({ type: 'turn_completed', provider: 'deepseek', turnId: 't1', usage: { inputTokens: 6, outputTokens: 3 } })
    // 服务端在没有提示词时自己跑起来的回合（后台子会话叫醒根会话）。
    channel.observe({ kind: 'session-update', notification: { sessionId: 's1', update: { sessionUpdate: 'session_info_update' }, _meta: { liwa: { turn: { event: 'started', turnId: 'auto' } } } } })
    push({ type: 'timeline', provider: 'deepseek', item: { type: 'assistant_message', text: 'woke', messageId: 'w' } })
    channel.observe({ kind: 'session-update', notification: { sessionId: 's1', update: { sessionUpdate: 'session_info_update' }, _meta: { liwa: { turn: { event: 'ended', turnId: 'auto', stopReason: 'completed', usage: { tokens: { input: 2, output: 1 }, inferences: 1 } } } } } })
    channel.observe({ kind: 'session-update', notification: { sessionId: 's1', update: { sessionUpdate: 'session_info_update' }, _meta: { liwa: { turn: { event: 'started', turnId: 'auto2' } } } } })
    channel.observe({ kind: 'session-update', notification: { sessionId: 's1', update: { sessionUpdate: 'session_info_update' }, _meta: { liwa: { turn: { event: 'ended', turnId: 'auto2', stopReason: 'cancelled', usage: {} } } } } })
    expect(events).toEqual([
      { kind: 'child.started', childId: 'k1', childKind: 'native-child', label: 'spawn', provider: 'deepseek' },
      { kind: 'turn.started', turnId: 't1' },
      expect.objectContaining({ kind: 'permission.request', requestId: PermissionRequestId('p1'), tool: 'write', childId: 'k1', turnId: 't1' }),
      { kind: 'child.ended', childId: 'k1', stopReason: 'completed', usage: { tokens: { input: 3, output: 1 }, inferences: 1 } },
      { kind: 'turn.completed', turnId: 't1', usage: { tokens: { input: 9, output: 4 }, inferences: 2 }, concludedBy: 'reply' },
      { kind: 'turn.started', turnId: 'auto' },
      { kind: 'item.message', turnId: 'auto', itemId: 'w', delta: 'woke', final: false },
      { kind: 'item.message', turnId: 'auto', itemId: 'w', delta: '', final: true },
      { kind: 'turn.completed', turnId: 'auto', usage: { tokens: { input: 2, output: 1 }, inferences: 1 } },
      { kind: 'turn.started', turnId: 'auto2' },
      { kind: 'turn.interrupted', turnId: 'auto2', reason: 'cancelled' },
    ])
  })
})
