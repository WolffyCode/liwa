import { describe, expect, it } from 'vitest'
import type { PromptResponse, RequestPermissionRequest } from '@agentclientprotocol/sdk'
import type { Agent } from '@liwa/agent'
import type { ApprovalRequestEvent } from '@liwa/user-approval/types'
import { AcpExtensionHost, AcpExtensionRegistry, type AcpSessionView } from '../src/extensions.ts'

const agent = {} as Agent
const view: AcpSessionView = { sessionId: 's1' as AcpSessionView['sessionId'], agent, prompting: false, notify: () => Promise.resolve(), admit: () => Promise.resolve([]) }

function registry(): AcpExtensionHost {
  return new AcpExtensionHost({ session: id => (id === 's1' ? view : undefined), sessionOf: candidate => (candidate === agent ? view : undefined) })
}

describe('AcpExtensionRegistry', () => {
  it('collects extension methods once and refuses late or clashing registrations', async () => {
    const extensions = registry()
    const release = extensions.register({ name: 'a', methods: { _a: () => Promise.resolve({ ok: true }) } })
    expect(() => extensions.register({ name: 'b', methods: { _a: () => Promise.resolve({}) } })).toThrow(/already registered/)
    expect(() => extensions.register({ name: 'c', methods: { plain: () => Promise.resolve({}) } })).toThrow(/must start with "_"/)
    const methods = extensions.seal()
    expect([...methods.keys()]).toEqual(['_a'])
    expect(await methods.get('_a')?.({}, { signal: new AbortController().signal, session: () => undefined })).toEqual({ ok: true })
    expect(() => extensions.register({ name: 'late' })).toThrow(/after the transport connected/)
    release()
    const facade = new AcpExtensionRegistry(extensions)
    expect(facade.session('s1')).toBe(view)
    expect(facade.sessionOf(agent)).toBe(view)
    expect(() => facade.register({ name: 'late' })).toThrow(/after the transport connected/)
  })

  it('chains session setup, response, and permission hooks in order; the first cancel option wins', async () => {
    const extensions = registry()
    const order: string[] = []
    extensions.register({
      name: 'first',
      setupSession: () => { order.push('first') },
      promptResponse: (_session, response) => ({ ...response, _meta: { first: true } }),
      permissionRequest: (_session, _agent, _approval, request) => ({ ...request, toolCall: { ...request.toolCall, title: 'one' } }),
      cancelOptions: () => undefined,
    })
    extensions.register({
      name: 'second',
      setupSession: () => { order.push('second') },
      promptResponse: (_session, response) => ({ ...response, _meta: { ...response._meta, second: true } }),
      cancelOptions: (_session, meta) => ({ keepInbox: meta?.['keep'] === true }),
    })
    await extensions.setupSession({ agentCtx: {} as never, sessionId: view.sessionId, meta: undefined, resumed: false })
    expect(order).toEqual(['first', 'second'])
    const response: PromptResponse = { stopReason: 'end_turn' }
    expect(extensions.promptResponse(view, response)).toEqual({ stopReason: 'end_turn', _meta: { first: true, second: true } })
    const request: RequestPermissionRequest = { sessionId: 's1', toolCall: { toolCallId: 'c' }, options: [] }
    expect(extensions.permissionRequest(view, agent, { agent, toolName: 'write' } satisfies ApprovalRequestEvent, request).toolCall.title).toBe('one')
    expect(extensions.cancelOptions(view, { keep: true })).toEqual({ keepInbox: true })
  })
})
