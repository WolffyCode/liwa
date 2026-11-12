import { describe, expect, it } from 'vitest'
import type { AgentPermissionRequest } from '@liwa/brain-shared/paseo/agent/agent-sdk-types'
import { paseoQuestions } from '@liwa/brain-shared'
import { claudeAnswerInput, sessionPermissionOptions } from '../src/permissions.ts'

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
    for (const answer of [{ selected: [], custom: 'A' }, { selected: [], custom: 'other, values' }]) {
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
    expect(sessionPermissionOptions({ id: 'r', provider: 'claude', name: 'mcp__liwa__report', kind: 'tool' })[0]?.response.updatedPermissions).toEqual([{ type: 'addRules', rules: [{ toolName: 'mcp__liwa__report' }], behavior: 'allow', destination: 'session' }])
  })
  it('does not broaden shell, file, wildcard, question or plan approvals', () => {
    for (const name of ['Bash', 'Read', 'mcp__liwa__*', 'AskUserQuestion', 'ExitPlanMode']) {
      expect(sessionPermissionOptions({ id: 'r', provider: 'claude', name, kind: 'tool' })).toEqual([])
    }
  })
})

it('rejects duplicate option labels', () => {
  const req = request([{ ...question, options: [{ label: 'A' }, { label: 'A' }] }])
  expect(() => claudeAnswerInput(req, paseoQuestions(req), { h: { selected: ['A'] } })).toThrow('Duplicate option')
})

it('encodes selection notes as native annotations without changing the answer', () => {
  const req = request([question])
  expect(claudeAnswerInput(req, paseoQuestions(req), { h: { selected: ['A', 'B'], custom: '理由, with commas' } })).toMatchObject({
    answers: { 'Which?': 'A, B' }, annotations: { 'Which?': { notes: '理由, with commas' } },
  })
})

it('offers CLI suggestions only in provider mode and rewrites every destination to session', () => {
  const req: AgentPermissionRequest = { id: 'r', provider: 'claude', name: 'Bash', kind: 'tool', suggestions: [
    { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' },
    { type: 'setMode', mode: 'bypassPermissions', destination: 'session' },
    { type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'session' },
  ] }
  const options = sessionPermissionOptions(req)
  expect(options).toHaveLength(1)
  expect(options[0]?.option).toMatchObject({ effect: 'allow_session', sessionRules: ['Bash(npm test:*)'] })
  expect(options[0]?.response.updatedPermissions).toEqual([{ ...req.suggestions?.[0], destination: 'session' }])
  expect(sessionPermissionOptions({ ...req, kind: 'question' })).toEqual([])
})

it('deduplicates CLI suggestions and retains each distinct rule choice', () => {
  const rule = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'projectSettings' }
  const options = sessionPermissionOptions({ id: 'r', provider: 'claude', kind: 'tool', name: 'Bash', suggestions: [rule, rule, { ...rule, rules: [{ toolName: 'Read', ruleContent: 'docs/**' }] }] })
  expect(options.map(choice => choice.option.id)).toEqual(['allow_session', 'allow_session_1'])
})
