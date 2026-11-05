import { afterEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { ToolCallId, createToolResultMessage } from '@liwa/llm'
import type { Agent } from '@liwa/agent'
import { SessionId, SessionSeq } from '@liwa/session'
import ApprovalService, { type ApprovalRequest } from '@liwa/user-approval'
import { makeBridgeHarness, type BridgeHarness } from './harness.ts'

describe('ACP machine permission policy', () => {
  let harness: BridgeHarness | undefined
  /** Sequence number of the last `tool/call` the owned request logged. */
  let callSeq = SessionSeq(0)

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  async function ownedRequest(overrides: Partial<ApprovalRequest> = {}): Promise<ApprovalRequest> {
    if (harness === undefined) throw new Error('missing harness')
    await harness.ctx.plugin(ApprovalService)
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const agent = harness.ctx.agents.get(SessionId(sessionId))!
    agent.session.append('turn/start', { turn: 1 })
    agent.session.append('step/start', { turn: 1, step: 1 })
    callSeq = agent.session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId('call-9'), name: 'bash', arguments: '{"command":"ls /etc"}' }).seq
    return { agent, toolName: 'bash', callId: ToolCallId('call-9'), ...overrides }
  }

  it('maps the two advertised one-shot choices', async () => {
    harness = await makeBridgeHarness()
    harness.onPermission = () => {
      expect(harness?.sessionUpdates.at(-1)?.update).toMatchObject({
        sessionUpdate: 'tool_call',
        toolCallId: 'call-9',
      })
      return { outcome: { outcome: 'selected', optionId: 'allow-once' } }
    }
    const request = await ownedRequest()
    await expect(harness.ctx.approval.request(request)).resolves.toBe('allowed-once')
    expect(harness.permissionRequests[0]).toMatchObject({
      sessionId: request.agent.session.id,
      // The request describes the call it asks about: the tool and its raw input.
      toolCall: { toolCallId: 'call-9', title: 'bash', kind: 'other', rawInput: { command: 'ls /etc' } },
      options: [
        { optionId: 'allow-once', kind: 'allow_once' },
        { optionId: 'reject-once', kind: 'reject_once' },
      ],
    })
    expect(harness.permissionRequests[0]?.toolCall).not.toHaveProperty('content')

    harness.onPermission = () => ({ outcome: { outcome: 'selected', optionId: 'reject-once' } })
    await expect(harness.ctx.approval.request(request)).resolves.toBe('rejected')
  })

  it('carries the asker\'s reason, and only the tool name for a call it never saw', async () => {
    harness = await makeBridgeHarness()
    harness.onPermission = () => ({ outcome: { outcome: 'selected', optionId: 'reject-once' } })
    const request = await ownedRequest({ reason: 'escalate sandbox to danger-full-access: needs /etc' })
    await expect(harness.ctx.approval.request(request)).resolves.toBe('rejected')
    expect(harness.permissionRequests[0]?.toolCall).toEqual({
      toolCallId: 'call-9',
      title: 'bash',
      kind: 'other',
      rawInput: { command: 'ls /etc' },
      content: [{ type: 'content', content: { type: 'text', text: 'escalate sandbox to danger-full-access: needs /etc' } }],
    })
    // A finished call is forgotten; an unknown call id carries only the asked tool name.
    request.agent.session.append('tool/result', {
      turn: 1, step: 1, message: createToolResultMessage({ callId: ToolCallId('call-9'), content: [{ type: 'text', text: 'ok' }], isError: false }),
    }, { surfaceOp: 'append', sourceEventSeqs: [callSeq] })
    await expect(harness.ctx.approval.request({ ...request, reason: '' })).resolves.toBe('rejected')
    expect(harness.permissionRequests[1]?.toolCall).toEqual({ toolCallId: 'call-9', title: 'bash', kind: 'other' })
  })

  it('describes a descendant\'s call through the root session that reports it', async () => {
    harness = await makeBridgeHarness()
    harness.onPermission = () => ({ outcome: { outcome: 'selected', optionId: 'allow-once' } })
    const root = await ownedRequest()
    const { agent: child } = await harness.ctx.agents.create({
      sessionId: SessionId('child-1'),
      parentAgent: root.agent,
      meta: { cwd: process.cwd(), parentSession: root.agent.session.id, origin: 'subagent' },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    child.session.append('turn/start', { turn: 1 })
    child.session.append('step/start', { turn: 1, step: 1 })
    child.session.append('tool/call', {
      turn: 1, step: 1, callId: ToolCallId('child-call'), name: 'write',
      arguments: '{"file_path":"/outside/child.txt","content":"from the child","sandbox_permissions":"danger-full-access","justification":"asked"}',
    })
    await expect(harness.ctx.approval.request({ agent: child, toolName: 'write', callId: ToolCallId('child-call'), reason: 'escalate sandbox to danger-full-access: asked' }))
      .resolves.toBe('allowed-once')
    expect(harness.permissionRequests[0]).toMatchObject({
      sessionId: root.agent.session.id,
      toolCall: {
        toolCallId: 'child-call',
        title: 'write',
        rawInput: { file_path: '/outside/child.txt', content: 'from the child', sandbox_permissions: 'danger-full-access', justification: 'asked' },
        content: [{ type: 'content', content: { type: 'text', text: 'escalate sandbox to danger-full-access: asked' } }],
      },
    })
    // The descendant's calls never reached the client as updates.
    expect(harness.sessionUpdates.some(update => update.update.sessionUpdate === 'tool_call' && update.update.toolCallId === 'child-call')).toBe(false)
  })

  it('maps cancellation and unknown choices without granting access', async () => {
    harness = await makeBridgeHarness()
    const request = await ownedRequest()
    await expect(harness.ctx.approval.request(request)).resolves.toBe('cancelled')
    harness.onPermission = () => ({ outcome: { outcome: 'selected', optionId: 'unknown-grant' } })
    await expect(harness.ctx.approval.request(request)).resolves.toBe('rejected')
  })

  it('fails closed when the client errors the permission request', async () => {
    harness = await makeBridgeHarness()
    const request = await ownedRequest()
    harness.onPermission = () => { throw new Error('client gone') }
    await expect(harness.ctx.approval.request(request)).resolves.toBe('unavailable')
  })

  it('delegates a same-id foreign agent', async () => {
    harness = await makeBridgeHarness()
    const request = await ownedRequest()
    const events = [{ type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } }]
    const foreign = {
      session: {
        id: request.agent.session.id,
        seq: events.length,
        eventAt: (seq: number) => events[seq],
        snapshotEvents: () => events,
        append: () => ({}),
      },
    } as unknown as Agent
    await expect(harness.ctx.approval.request({ agent: foreign, toolName: 'bash', callId: ToolCallId('call') }))
      .resolves.toBe('unavailable')
    expect(harness.permissionRequests).toHaveLength(0)
  })

  it('delegates requests that have no protocol tool-call identity', async () => {
    harness = await makeBridgeHarness()
    const request = await ownedRequest()
    await expect(harness.ctx.approval.request({ agent: request.agent, toolName: request.toolName }))
      .resolves.toBe('unavailable')
    expect(harness.permissionRequests).toHaveLength(0)
  })
})
