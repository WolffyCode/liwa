import { afterEach, describe, expect, it } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { SessionId } from '@liwa/session'
import PlanModeController from '@liwa/plan-mode'
import UserQuestionService, { UserQuestionError, type AskUserQuestionItem } from '@liwa/user-questions'
import { answerFromContent, questionSchema } from '../src/questions.ts'
import { makeBridgeHarness, type BridgeHarness } from './harness.ts'

const COLOR: AskUserQuestionItem = {
  id: 'color',
  header: 'Color',
  question: 'Which color?',
  options: [{ label: 'red' }, { label: 'blue', description: 'calm' }],
}

describe('ACP user questions over form elicitation', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  async function session(elicitation: boolean): Promise<{ harness: BridgeHarness; sessionId: string }> {
    const opened = await makeBridgeHarness()
    harness = opened
    await opened.ctx.plugin(UserQuestionService)
    const clientCapabilities = elicitation ? { elicitation: { form: {} } } : {}
    await opened.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities })
    const { sessionId } = await opened.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    return { harness: opened, sessionId }
  }

  it('asks a client that advertised form elicitation and returns its structured answer', async () => {
    const { harness, sessionId } = await session(true)
    const agent = harness.ctx.agents.get(SessionId(sessionId))!
    harness.onElicitation = () => ({ action: 'accept', content: { color: 'blue', toppings: ['a', 'b'], toppings__other: 'cheese', note: 'hi' } })
    const answer = await harness.ctx.userQuestions.ask({
      agent,
      questions: [
        COLOR,
        { id: 'toppings', question: 'Toppings?', options: [{ label: 'a' }, { label: 'b' }], multiSelect: true },
        { id: 'note', question: 'Anything else?' },
      ],
    })
    expect(answer).toEqual({ answers: [
      { id: 'color', selected: ['blue'] },
      { id: 'toppings', selected: ['a', 'b'], custom: 'cheese' },
      { id: 'note', selected: [], custom: 'hi' },
    ] })
    expect(harness.elicitations[0]).toMatchObject({
      sessionId,
      mode: 'form',
      requestedSchema: { type: 'object', properties: {
        color: { type: 'string', title: 'Color', oneOf: [{ const: 'red', title: 'red' }, { const: 'blue', title: 'blue', description: 'calm' }] },
        color__other: { type: 'string', _meta: { liwa: { otherFor: 'color' } } },
        toppings: { type: 'array', items: { anyOf: [{ const: 'a', title: 'a' }, { const: 'b', title: 'b' }] } },
        note: { type: 'string', description: 'Anything else?' },
      } },
    })
  })

  it('treats a declined or cancelled form as a dismissed question, and an abort as withdrawn', async () => {
    const { harness, sessionId } = await session(true)
    const agent = harness.ctx.agents.get(SessionId(sessionId))!
    harness.onElicitation = () => ({ action: 'decline' })
    await expect(harness.ctx.userQuestions.ask({ agent, questions: [COLOR] })).rejects.toMatchObject({ code: 'ASK_CANCELLED' })
    harness.onElicitation = () => ({ action: 'accept', content: {} })
    await expect(harness.ctx.userQuestions.ask({ agent, questions: [COLOR] })).rejects.toMatchObject({ code: 'BAD_ANSWER' })
    const controller = new AbortController()
    harness.onElicitation = () => new Promise(() => { controller.abort() })
    const withdrawn = harness.ctx.userQuestions.ask({ agent, questions: [COLOR], signal: controller.signal })
    await expect(withdrawn).rejects.toBeInstanceOf(UserQuestionError)
  })

  it('leaves questions to other answerers when the client cannot answer forms', async () => {
    const { harness, sessionId } = await session(false)
    const agent = harness.ctx.agents.get(SessionId(sessionId))!
    await expect(harness.ctx.userQuestions.ask({ agent, questions: [COLOR] })).rejects.toMatchObject({ code: 'NO_PROVIDER' })
    expect(harness.elicitations).toEqual([])
  })

  it('maps question items to a form and back', () => {
    expect(questionSchema([{ id: 'ok', question: 'Approve?', detail: 'the plan', options: [{ label: 'Yes' }, { label: 'No' }], intent: { kind: 'approval', approve: 'Yes', reject: 'No' } }]))
      .toEqual({ type: 'object', required: [], properties: { ok: { type: 'string', title: 'Approve?', description: 'Approve?\n\nthe plan', oneOf: [{ const: 'Yes', title: 'Yes' }, { const: 'No', title: 'No' }] } } })
    expect(answerFromContent([COLOR], { color: 'purple' })).toEqual({ answers: [{ id: 'color', selected: [], custom: 'purple' }] })
    expect(() => answerFromContent([{ ...COLOR, multiSelect: true }], { color: ['green'] })).toThrow(/no option/)
  })
})

describe('ACP session modes over plan mode', () => {
  let harness: BridgeHarness | undefined

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
  })

  it('reports default and plan, switches between them, and notifies when the switch is logged', async () => {
    harness = await makeBridgeHarness()
    await harness.ctx.plugin(PlanModeController, { section: 'You are in plan mode.' })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    expect(created.modes?.currentModeId).toBe('default')
    expect(created.modes?.availableModes.map(mode => [mode.id, mode.name])).toEqual([['default', 'Default'], ['plan', 'Plan']])
    await harness.client.setSessionMode({ sessionId: created.sessionId, modeId: 'plan' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(harness.updates).toContainEqual({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' })
    expect(harness.ctx.planMode.get(harness.ctx.agents.get(SessionId(created.sessionId))!)).toEqual({ active: true })
    await expect(harness.client.setSessionMode({ sessionId: created.sessionId, modeId: 'bypass' })).rejects.toThrow(/unknown mode/)
    await harness.client.setSessionMode({ sessionId: created.sessionId, modeId: 'default' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(harness.updates.at(-1)).toEqual({ sessionUpdate: 'current_mode_update', currentModeId: 'default' })
  })

  it('offers no modes without a plan-mode service', async () => {
    harness = await makeBridgeHarness()
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const created = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    expect(created.modes).toBeUndefined()
    await expect(harness.client.setSessionMode({ sessionId: created.sessionId, modeId: 'plan' })).rejects.toThrow(/no modes/)
  })
})
