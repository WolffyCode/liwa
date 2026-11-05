/**
 * ACP 表单式 elicitation（`elicitation/create`）与契约问答之间的编解码。迁来的 Paseo ACP 客户端只做接线：把表单请求
 * 原样放进一个问答类 Paseo 权限请求（`input.requestedSchema`），答复时把 `updatedInput.content` 原样交回 agent；
 * 表单怎么读成问题、答案怎么填回表单都在这里。
 *
 * 读法：每个表单字段一个问题，问题号就是字段名。单选是带 `oneOf`（或 `enum`）的字符串，多选是 `items` 带 `anyOf`
 * （或 `enum`）的数组，没有选项的字符串、数字是自由文本，布尔给"是 / 否"两个选项；`_meta.liwa.otherFor` 标出的字段
 * 是那个问题的"其他"自由文本字段（liwa ACP 服务端的写法，见 `@liwa/acp` 的 questions 模块）。
 *
 * 填法：答案一直是结构——选中的选项进问题自己的字段，补充文字进它的"其他"字段（自由文本问题就是它自己的字段），
 * 从不把两者拼成一段文字，所以选项或补充文字里带逗号也不会混。表单装不下的答案（没有"其他"字段的问题带了补充
 * 文字、布尔或数字给的不是它能收的值）以 `invalid_input` 拒绝，请求仍待答。
 * @module @liwa/brain-acp/elicitation
 */

import { BrainError, type PermissionAnswer, type PermissionQuestion } from '@liwa/brain'
import type { AgentMetadata, AgentPermissionRequest } from '@liwa/brain-shared/paseo/agent/agent-sdk-types'
import { ACP_ELICITATION_REQUEST } from './paseo/agent/providers/acp-agent.ts'

/** 表单内容里一个字段的值（ACP 的 `ElicitationContentValue`）。 */
export type ElicitationValue = string | number | boolean | string[]

/** 一次作答填好的表单内容，以字段名为键。 */
export type ElicitationContent = Record<string, ElicitationValue>

/** 表单里的一个问题字段。 */
interface FormField {
  /** 字段名（= 问题号）。 */
  key: string
  /** 字段类型。 */
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array'
  /** 选项文字（没有选项的是自由文本）。 */
  labels: string[]
  /** 这个问题的"其他"自由文本字段名。 */
  otherKey: string | undefined
  /** 翻成的契约问题。 */
  question: PermissionQuestion
}

/**
 * 是不是一个普通对象。
 * @param value - 任意值。
 * @returns 是否。
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 读一个非空字符串字段。
 * @param record - 对象。
 * @param key - 字段名。
 * @returns 非空字符串，或 `undefined`。
 */
function text(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * 字段的 `_meta.liwa.otherFor`：它是哪个问题的"其他"自由文本字段。
 * @param property - 表单字段定义。
 * @returns 问题号，或 `undefined`。
 */
function otherFor(property: Record<string, unknown>): string | undefined {
  const meta = property['_meta']
  const liwa = isRecord(meta) ? meta['liwa'] : undefined
  return isRecord(liwa) ? text(liwa, 'otherFor') : undefined
}

/**
 * 一组枚举项的选项：带标题的 `{ const, title?, description? }`，或纯字符串。
 * @param entries - `oneOf` / `anyOf` / `enum`。
 * @returns 选项。
 */
function enumOptions(entries: unknown): PermissionQuestion['options'] {
  if (!Array.isArray(entries)) return []
  return entries.flatMap((entry): PermissionQuestion['options'] => {
    if (typeof entry === 'string') return entry === '' ? [] : [{ label: entry }]
    if (!isRecord(entry)) return []
    const label = text(entry, 'const')
    if (label === undefined) return []
    const description = text(entry, 'description')
    return [{ label, ...(description === undefined ? {} : { description }) }]
  })
}

/**
 * 一个表单字段的类型与选项。
 * @param property - 表单字段定义。
 * @returns 类型与选项；不认识的类型为 `undefined`。
 */
function fieldShape(property: Record<string, unknown>): { type: FormField['type']; options: PermissionQuestion['options'] } | undefined {
  switch (property['type']) {
    case 'string':
      return { type: 'string', options: enumOptions(property['oneOf'] ?? property['enum']) }
    case 'number':
    case 'integer':
      return { type: property['type'], options: [] }
    case 'boolean':
      return { type: 'boolean', options: [{ label: 'Yes' }, { label: 'No' }] }
    case 'array': {
      const items = property['items']
      return { type: 'array', options: isRecord(items) ? enumOptions(items['anyOf'] ?? items['enum']) : [] }
    }
    default:
      return undefined
  }
}

/**
 * 读出表单的问题字段。标着 `otherFor` 却找不到所属问题的字段当成一个独立的自由文本问题，不丢。
 * @param schema - elicitation 的 `requestedSchema`。
 * @returns 问题字段，按表单里的顺序。
 */
function formFields(schema: unknown): FormField[] {
  const properties = isRecord(schema) && isRecord(schema['properties']) ? schema['properties'] : {}
  const entries = Object.entries(properties).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
  const others = new Map<string, string>()
  for (const [key, property] of entries) {
    const target = otherFor(property)
    if (target !== undefined && target !== key && isRecord(properties[target]) && !others.has(target)) others.set(target, key)
  }
  const attached = new Set(others.values())
  const headers = new Set<string>()
  const fields: FormField[] = []
  for (const [key, property] of entries) {
    if (attached.has(key)) continue
    const shape = fieldShape(property)
    if (shape === undefined) continue
    const title = text(property, 'title') ?? key
    const header = headers.has(title) ? `${title} (${key})` : title
    headers.add(header)
    fields.push({
      key,
      type: shape.type,
      labels: shape.options.map(option => option.label),
      otherKey: others.get(key),
      question: { id: key, question: text(property, 'description') ?? title, header, options: shape.options, multiSelect: shape.type === 'array' },
    })
  }
  return fields
}

/**
 * 这个 Paseo 权限请求是不是迁来的 ACP 客户端翻出的表单问答。
 * @param request - Paseo 权限请求。
 * @returns 是否。
 */
export function isElicitationRequest(request: AgentPermissionRequest): boolean {
  return request.kind === 'question' && request.name === ACP_ELICITATION_REQUEST
}

/**
 * 表单问答请求里的问题。
 * @param request - 表单问答翻成的 Paseo 请求（`input.requestedSchema` 是原表单）。
 * @returns 契约问题，每个字段一个；读不出字段时给一个占位问题（请求仍合契约，作答会被拒，只能谢绝）。
 */
export function elicitationQuestions(request: AgentPermissionRequest): PermissionQuestion[] {
  const questions = formFields(request.input?.['requestedSchema']).map(field => field.question)
  if (questions.length > 0) return questions
  return [{ id: 'answer', question: request.description ?? request.title ?? request.name, options: [], multiSelect: false }]
}

/**
 * 拒绝一个装不进表单的答案。
 * @param field - 问题字段。
 * @param problem - 哪里装不下。
 * @returns 不返回。
 * @throws {BrainError} `invalid_input`。
 */
function unfit(field: FormField, problem: string): never {
  throw new BrainError('invalid_input', 'brain.permission_answers_invalid', `the form field ${JSON.stringify(field.key)} cannot take this answer: ${problem}`)
}

/**
 * 一个问题的答案填进表单。
 * @param field - 问题字段。
 * @param answer - 契约答案。
 * @param content - 要填的表单内容（就地写入）。
 */
function fill(field: FormField, answer: PermissionAnswer, content: ElicitationContent): void {
  const { selected, custom } = answer
  const unknown = selected.find(label => !field.labels.includes(label))
  if (unknown !== undefined) unfit(field, `it has no option ${JSON.stringify(unknown)}`)
  switch (field.type) {
    case 'boolean':
      if (custom !== undefined || selected.length !== 1) unfit(field, 'a yes/no field takes exactly one of Yes or No')
      content[field.key] = selected[0] === 'Yes'
      return
    case 'number':
    case 'integer': {
      const value = custom === undefined ? Number.NaN : Number(custom.trim())
      if (custom === undefined || custom.trim() === '' || !Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value))) {
        unfit(field, `a ${field.type} field takes one ${field.type} as free text`)
      }
      content[field.key] = value
      return
    }
    case 'array':
      if (field.labels.length === 0) {
        // 没有选项的列表：补充文字是列表里的一项。
        content[field.key] = custom === undefined ? [...selected] : [...selected, custom]
        return
      }
      content[field.key] = [...selected]
      break
    case 'string':
      if (field.labels.length === 0) {
        // 自由文本问题：它自己的字段就收补充文字。
        if (custom === undefined) unfit(field, 'a free-text field takes custom text')
        content[field.key] = custom
        return
      }
      if (selected.length > 1) unfit(field, 'a single-choice field takes one option')
      if (selected[0] !== undefined) content[field.key] = selected[0]
      break
  }
  if (custom === undefined) return
  if (field.otherKey === undefined) unfit(field, 'it has no free-text field for custom text')
  content[field.otherKey] = custom
}

/**
 * 契约答案填成表单内容（作答时交给 Paseo 的 `updatedInput.content`）。
 * @param request - 表单问答翻成的 Paseo 请求。
 * @param answers - 已核对的契约答案，以问题号（字段名）为键。
 * @returns 交给 Paseo 的 `updatedInput`。
 * @throws {BrainError} `invalid_input`：答案装不进这张表单。
 */
export function elicitationAnswerInput(
  request: AgentPermissionRequest,
  answers: Readonly<Record<string, PermissionAnswer>>,
): AgentMetadata {
  const content: ElicitationContent = {}
  const fields = formFields(request.input?.['requestedSchema'])
  if (fields.length === 0) {
    throw new BrainError('invalid_input', 'brain.permission_answers_invalid', 'the form has no field this client can fill; decline it instead')
  }
  for (const field of fields) {
    const answer = answers[field.key]
    if (answer !== undefined) fill(field, answer, content)
  }
  return { content }
}
