import { describe, expect, it } from 'vitest'
import type { AgentPermissionRequest } from '@liwa/brain-shared/paseo/agent/agent-sdk-types'
import { elicitationAnswerInput, elicitationQuestions, isElicitationRequest } from '../src/elicitation.ts'
import { ACP_ELICITATION_REQUEST } from '../src/paseo/agent/providers/acp-agent.ts'

const other = (target: string): Record<string, unknown> => ({ type: 'string', title: 'Other', _meta: { liwa: { otherFor: target } } })

/** 一个表单问答翻成的 Paseo 请求（迁来的客户端的写法：表单原样放在 `input.requestedSchema`）。 */
function formRequest(properties: Record<string, unknown>): AgentPermissionRequest {
  return {
    id: 'e1',
    provider: 'acp',
    name: ACP_ELICITATION_REQUEST,
    kind: 'question',
    title: 'A few questions',
    description: 'A few questions',
    input: { requestedSchema: { type: 'object', properties } },
  }
}

const FORM = formRequest({
  pick: { type: 'string', title: 'Pick', description: 'Which color?', oneOf: [{ const: 'red', title: 'red' }, { const: 'blue, green', title: 'blue, green', description: 'both' }] },
  pick__other: other('pick'),
  tags: { type: 'array', title: 'Tags', items: { anyOf: [{ const: 'a, b', title: 'a, b' }, { const: 'c', title: 'c' }] } },
  tags__other: other('tags'),
  note: { type: 'string', title: 'Note', description: 'Anything else?' },
  plain: { type: 'string', title: 'Pick', enum: ['x', 'y'] },
  list: { type: 'array', title: 'List', items: { type: 'string', enum: ['p', 'q'] } },
  free: { type: 'array', title: 'Free list', items: { type: 'string' } },
  ok: { type: 'boolean', title: 'OK?' },
  count: { type: 'integer', title: 'Count' },
  ratio: { type: 'number', title: 'Ratio' },
  stray: other('missing'),
  weird: { type: '_custom', title: 'Unknown' },
})

describe('ACP form elicitation codec', () => {
  it('reads one question per field: options, multi-select, free text, booleans, numbers, and orphan "other" fields', () => {
    expect(isElicitationRequest(FORM)).toBe(true)
    expect(isElicitationRequest({ ...FORM, kind: 'tool' })).toBe(false)
    expect(isElicitationRequest({ ...FORM, name: 'AskUserQuestion' })).toBe(false)
    expect(elicitationQuestions(FORM)).toEqual([
      { id: 'pick', question: 'Which color?', header: 'Pick', options: [{ label: 'red' }, { label: 'blue, green', description: 'both' }], multiSelect: false },
      { id: 'tags', question: 'Tags', header: 'Tags', options: [{ label: 'a, b' }, { label: 'c' }], multiSelect: true },
      { id: 'note', question: 'Anything else?', header: 'Note', options: [], multiSelect: false },
      // 同名标题加上字段名区分。
      { id: 'plain', question: 'Pick', header: 'Pick (plain)', options: [{ label: 'x' }, { label: 'y' }], multiSelect: false },
      { id: 'list', question: 'List', header: 'List', options: [{ label: 'p' }, { label: 'q' }], multiSelect: true },
      { id: 'free', question: 'Free list', header: 'Free list', options: [], multiSelect: true },
      { id: 'ok', question: 'OK?', header: 'OK?', options: [{ label: 'Yes' }, { label: 'No' }], multiSelect: false },
      { id: 'count', question: 'Count', header: 'Count', options: [], multiSelect: false },
      { id: 'ratio', question: 'Ratio', header: 'Ratio', options: [], multiSelect: false },
      // 找不到所属问题的"其他"字段自成一个自由文本问题，不丢。
      { id: 'stray', question: 'Other', header: 'Other', options: [], multiSelect: false },
    ])
  })

  it('fills the form from the answer structure: selections in the field, custom text in its "other" field, commas intact', () => {
    expect(elicitationAnswerInput(FORM, {
      pick: { selected: ['blue, green'], custom: 'keep, both' },
      tags: { selected: ['a, b', 'c'], custom: 'x, y' },
      note: { selected: [], custom: 'free, text' },
      plain: { selected: ['y'] },
      list: { selected: ['q'] },
      free: { selected: [], custom: 'one, item' },
      ok: { selected: ['No'] },
      count: { selected: [], custom: ' 3 ' },
      ratio: { selected: [], custom: '0.5' },
      stray: { selected: [], custom: 'loose' },
    })).toEqual({ content: {
      pick: 'blue, green',
      pick__other: 'keep, both',
      tags: ['a, b', 'c'],
      tags__other: 'x, y',
      note: 'free, text',
      plain: 'y',
      list: ['q'],
      free: ['one, item'],
      ok: false,
      count: 3,
      ratio: 0.5,
      stray: 'loose',
    } })
    // 只给补充文字：选项字段留空；没答的问题不填。
    expect(elicitationAnswerInput(FORM, { pick: { selected: [], custom: 'purple' }, ok: { selected: ['Yes'] } }))
      .toEqual({ content: { pick__other: 'purple', ok: true } })
  })

  it('ignores malformed enum entries and keeps valid labels and descriptions', () => {
    const request = formRequest({
      pick: {
        type: 'string',
        title: '',
        oneOf: ['', null, 42, [], {}, { const: '' }, { const: 7 }, 'red', { const: 'blue', description: '' }, { const: 'green', description: 'fresh' }],
      },
    })
    expect(elicitationQuestions(request)).toEqual([
      { id: 'pick', question: 'pick', header: 'pick', options: [{ label: 'red' }, { label: 'blue' }, { label: 'green', description: 'fresh' }], multiSelect: false },
    ])
    expect(elicitationAnswerInput(request, { pick: { selected: ['green'] } })).toEqual({ content: { pick: 'green' } })
  })

  it.each([undefined, null, false, [], {}, { properties: null }, { properties: { invalid: null, unsupported: { type: 'object' } } }])(
    'keeps an unreadable schema pending for decline: %j',
    (schema) => {
      const request = { ...FORM, input: { requestedSchema: schema } }
      expect(elicitationQuestions(request)).toEqual([{ id: 'answer', question: 'A few questions', options: [], multiSelect: false }])
      expect(() => elicitationAnswerInput(request, { answer: { selected: [], custom: 'cannot fit' } }))
        .toThrow(expect.objectContaining({ code: 'brain.permission_answers_invalid', message: 'the form has no field this client can fill; decline it instead' }))
    },
  )

  it.each([undefined, null, 'string'])(
    'treats an array without readable items as a free list: %j',
    (items) => {
      const request = formRequest({ list: { type: 'array', items } })
      expect(elicitationQuestions(request)).toEqual([{ id: 'list', question: 'list', header: 'list', options: [], multiSelect: true }])
      expect(elicitationAnswerInput(request, { list: { selected: [] } })).toEqual({ content: { list: [] } })
      expect(elicitationAnswerInput(request, { list: { selected: [], custom: 'one, item' } })).toEqual({ content: { list: ['one, item'] } })
    },
  )

  it('preserves empty selections and empty custom text without filling omitted answers', () => {
    expect(elicitationAnswerInput(FORM, {
      pick: { selected: [] },
      tags: { selected: [], custom: 'only, custom' },
      list: { selected: [] },
      free: { selected: [] },
      note: { selected: [], custom: '' },
    })).toEqual({ content: { tags: [], tags__other: 'only, custom', list: [], free: [], note: '' } })
  })

  it.each([
    { field: 'count', answer: { selected: [] }, problem: 'a integer field takes one integer as free text' },
    { field: 'ratio', answer: { selected: [] }, problem: 'a number field takes one number as free text' },
    { field: 'ratio', answer: { selected: [], custom: 'Infinity' }, problem: 'a number field takes one number as free text' },
    { field: 'note', answer: { selected: [] }, problem: 'a free-text field takes custom text' },
    { field: 'ok', answer: { selected: [] }, problem: 'a yes/no field takes exactly one of Yes or No' },
    { field: 'ok', answer: { selected: ['Yes', 'No'] }, problem: 'a yes/no field takes exactly one of Yes or No' },
    { field: 'ok', answer: { selected: ['Yes'], custom: 'extra' }, problem: 'a yes/no field takes exactly one of Yes or No' },
  ])('refuses an unrepresentable answer for $field: $answer', ({ field, answer, problem }) => {
    expect(() => elicitationAnswerInput(FORM, { [field]: answer })).toThrow(expect.objectContaining({
      code: 'brain.permission_answers_invalid',
      message: `the form field ${JSON.stringify(field)} cannot take this answer: ${problem}`,
    }))
  })

  it('refuses answers the form cannot hold instead of dropping them', () => {
    const refuse = (answers: Parameters<typeof elicitationAnswerInput>[1]): void => {
      expect(() => elicitationAnswerInput(FORM, answers)).toThrow(expect.objectContaining({ code: 'brain.permission_answers_invalid' }))
    }
    refuse({ plain: { selected: ['x'], custom: 'no other field' } })
    refuse({ list: { selected: ['p'], custom: 'no other field' } })
    refuse({ pick: { selected: ['red', 'blue, green'] } })
    refuse({ pick: { selected: ['purple'] } })
    refuse({ note: { selected: ['x'] } })
    refuse({ ok: { selected: [], custom: 'maybe' } })
    refuse({ count: { selected: [], custom: '2.5' } })
    refuse({ ratio: { selected: [], custom: 'many' } })
    refuse({ ratio: { selected: [], custom: ' ' } })
    // 没有一个能填的字段的表单：只能谢绝。
    const empty = formRequest({ weird: { type: '_custom' } })
    expect(elicitationQuestions(empty)).toEqual([{ id: 'answer', question: 'A few questions', options: [], multiSelect: false }])
    expect(() => elicitationAnswerInput(empty, { answer: { selected: [], custom: 'x' } })).toThrow(expect.objectContaining({ code: 'brain.permission_answers_invalid' }))
    const { title, description: _description, input, ...bare } = empty
    expect(elicitationQuestions(bare)).toEqual([{ id: 'answer', question: ACP_ELICITATION_REQUEST, options: [], multiSelect: false }])
    expect(elicitationQuestions({ ...bare, ...(title === undefined ? {} : { title }) })).toEqual([{ id: 'answer', question: 'A few questions', options: [], multiSelect: false }])
    expect(input).toBeDefined()
  })
})
