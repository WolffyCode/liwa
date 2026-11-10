import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeAgentSession } from '../src/paseo/agent/providers/claude/agent.ts'
import { ClaudeDiagnostics } from '../src/diagnostics.ts'

const create = () => new ClaudeAgentSession({ provider: 'claude', cwd: '/unused', providerOptions: {} }, {
  logger: new ClaudeDiagnostics([]).logger({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  diagnostics: new ClaudeDiagnostics([]), controlTimeoutMs: 100, sdkOptions: {},
  resolveBinary: () => Promise.reject(new Error('must not launch')),
  spawn: () => { throw new Error('must not launch') }, disposeProcess: () => Promise.resolve(),
})
const declare = async (session: ClaudeAgentSession) => {
  const events = await session['translateMessageToEvents']({ type: 'system', subtype: 'task_started', task_id: 'native-task', tool_use_id: 'child-tool', task_type: 'local_agent', description: 'worker', session_id: 'session', uuid: '00000000-0000-4000-8000-000000000001' })
  for (const event of events) session['pushEvent'](event)
}
const request = (session: ClaudeAgentSession, signal: AbortSignal) => session['handlePermissionRequest']('Read', {}, { agentID: 'native-task', toolUseID: 'read-1', signal })
afterEach(() => vi.useRealTimers())

describe('child permission attribution', () => {
  it('publishes only the declared canonical identity when announcement arrives in time', async () => {
    vi.useFakeTimers()
    const session = create()
    const response = request(session, new AbortController().signal)
    await declare(session)
    await vi.advanceTimersByTimeAsync(0)
    const pending = session.getPendingPermissions()
    expect(pending).toHaveLength(1)
    expect(pending[0]?.metadata?.childId).toBe('child-tool')
    await session.respondToPermission(pending[0]!.id, { behavior: 'allow' })
    expect(await response).toMatchObject({ behavior: 'allow' })
    expect(await session['permissionChildIdentity']('native-task', new AbortController().signal)).toBe('child-tool')
    await session.close()
  })

  it.each([false, true])('denies unknown child after timeout; late announcement=%s never changes a published ID', async (late) => {
    vi.useFakeTimers()
    const session = create()
    const response = request(session, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(100)
    expect(await response).toMatchObject({ behavior: 'deny' })
    expect(JSON.stringify(await response)).toContain('Restart the child')
    expect(JSON.stringify(await response)).not.toContain('native-task')
    expect(session.getPendingPermissions()).toEqual([])
    if (late) {
      await declare(session)
      expect(await session['permissionChildIdentity']('native-task', new AbortController().signal)).toBe('child-tool')
      expect(session.getPendingPermissions()).toEqual([])
    }
    await session.close()
  })

  it.each(['abort', 'close', 'pre-abort'])('settles identity wait on %s without waiting for the deadline', async (kind) => {
    vi.useFakeTimers()
    const session = create()
    const controller = new AbortController()
    if (kind === 'pre-abort') controller.abort()
    const response = request(session, controller.signal)
    if (kind === 'abort') controller.abort()
    if (kind === 'close') await session.close()
    expect(await response).toMatchObject({ behavior: 'deny', interrupt: true })
    expect(session.getPendingPermissions()).toEqual([])
    await session.close()
    expect(vi.getTimerCount()).toBe(0)
  })
})
