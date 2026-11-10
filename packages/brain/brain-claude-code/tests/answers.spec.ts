import { describe, expect, it } from 'vitest'
import type { AgentPermissionRequest } from '@liwa/brain-shared/paseo/agent/agent-sdk-types'
import { paseoQuestions } from '@liwa/brain-shared'
import { claudeAnswerInput, sessionPermissionUpdate } from '../src/permissions.ts'

const request = (questions: unknown[]): AgentPermissionRequest => ({ id: 'ask', provider: 'claude', name: 'AskUserQuestion', kind: 'question', input: { questions } })
const question = { header: 'h', question: 'Which?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true }

describe('Claude structured answers', () => {
  it('maps contract ids to exact question text and preserves selections', () => {
    const req = request([question])
    expect(claudeAnswerInput(req, paseoQuestions(req), { h: { selected: ['A', 'B'] } })).toMatchObject({ answers: { 'Which?': 'A, B' } })
    expect(claudeAnswerInput(req, paseoQuestions(req), { h: { selected: [], custom: 'something else' } })).toMatchObject({ answers: { 'Which?': 'something else' } })
    const single = request([{ ...question, multiSelect: false, options: [{ label: 'A, B' }] }])
    expect(claudeAnswerInput(single, paseoQuestions(single), { h: { selected: ['A, B'] } })).toMatchObject({ answers: { 'Which?': 'A, B' } })
  })

  it('rejects ambiguous or not-yet-verified answers rather than formatting them as prose', () => {
    const req = request([question])
    for (const answer of [{ selected: ['A'], custom: 'note' }, { selected: [], custom: 'A' }, { selected: [], custom: 'other, values' }]) {
      expect(() => claudeAnswerInput(req, paseoQuestions(req), { h: answer })).toThrow()
    }
    const dup = request([question, { ...question, header: 'other' }])
    expect(() => claudeAnswerInput(dup, paseoQuestions(dup), { h: { selected: ['A'] }, other: { selected: ['B'] } })).toThrow('Duplicate')
    const comma = request([{ ...question, options: [{ label: 'A,B' }] }])
    expect(() => claudeAnswerInput(comma, paseoQuestions(comma), { h: { selected: ['A,B'] } })).toThrow('comma')
  })
})

describe('Claude session permission rule', () => {
  it('creates a narrow session rule for an exact MCP tool', () => {
    expect(sessionPermissionUpdate({ id: 'r', provider: 'claude', name: 'mcp__liwa__report', kind: 'tool' })).toEqual({ type: 'addRules', rules: [{ toolName: 'mcp__liwa__report' }], behavior: 'allow', destination: 'session' })
  })
  it('does not broaden shell, file, wildcard, question or plan approvals', () => {
    for (const name of ['Bash', 'Read', 'mcp__liwa__*', 'AskUserQuestion', 'ExitPlanMode']) {
      expect(sessionPermissionUpdate({ id: 'r', provider: 'claude', name, kind: 'tool' })).toBeUndefined()
    }
  })
})

it('rejects duplicate option labels', () => {
  const req = request([{ ...question, options: [{ label: 'A' }, { label: 'A' }] }])
  expect(() => claudeAnswerInput(req, paseoQuestions(req), { h: { selected: ['A'] } })).toThrow('Duplicate option')
})
