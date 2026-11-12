/**
 * AskUserQuestion 的无歧义编码与最窄的会话权限规则。
 * @module @liwa/brain-claude-code/permissions
 */
import { z } from 'zod'
import { BrainError, type PermissionAnswer, type PermissionQuestion, type PermissionOption } from '@liwa/brain'
import type { AgentMetadata, AgentPermissionRequest, AgentPermissionResponse } from '@liwa/brain-shared/paseo/agent/agent-sdk-types'

/**
 * 以问题全文编码原生 answers；不能无损表示就保留待答。
 * @param request - 原生请求。
 * @param questions - 公共问题。
 * @param answers - 公共层已校验的答案。
 * @returns 原生输入。
 */
export function claudeAnswerInput(
  request: AgentPermissionRequest, questions: readonly PermissionQuestion[], answers: Readonly<Record<string, PermissionAnswer>>,
): AgentMetadata {
  const native: Record<string, string> = Object.create(null) as Record<string, string>
  const annotations: Record<string, { notes: string }> = {}
  for (const question of questions) {
    if (Object.hasOwn(native, question.question)) throw new BrainError('invalid_input', 'brain.claude_answer_ambiguous', 'Duplicate question text cannot be encoded by Claude')
    const answer = answers[question.id] as PermissionAnswer
    const labels = question.options.map(option => option.label)
    if (new Set(labels).size !== labels.length) throw new BrainError('invalid_input', 'brain.claude_answer_ambiguous', 'Duplicate option labels cannot be encoded by Claude')
    if (answer.selected.length > 0 && answer.custom !== undefined && answer.custom.trim() !== '') {
      annotations[question.question] = { notes: answer.custom }
    }
    if (question.multiSelect && (answer.selected.some(label => label.includes(',')) || (answer.selected.length === 0 && answer.custom?.includes(',')))) {
      throw new BrainError('invalid_input', 'brain.claude_answer_ambiguous', 'A comma in a multi-select answer is ambiguous in Claude')
    }
    if (answer.selected.length === 0 && labels.includes(answer.custom as string)) {
      throw new BrainError('invalid_input', 'brain.claude_answer_ambiguous', 'Free text identical to an option must be submitted as a selection')
    }
    native[question.question] = answer.selected.length > 0 ? answer.selected.join(', ') : answer.custom as string
  }
  return { ...request.input, answers: native, ...(Object.keys(annotations).length === 0 ? {} : { annotations }) }
}

const SessionRuleSchema = z.object({
  type: z.literal('addRules'), behavior: z.literal('allow'),
  rules: z.array(z.object({ toolName: z.string().min(1), ruleContent: z.string().optional() })).min(1),
})
const EXACT_MCP_TOOL = /^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$/

/**
 * CLI 匹配原生窄规则；精确 MCP 许可采用同一种会话选项表达。
 * @param request - CLI 的权限请求与规则建议。
 * @returns 可展示的同一种会话许可选项及其原生答复。
 */
export function sessionPermissionOptions(
  request: AgentPermissionRequest,
): { option: PermissionOption; response: Extract<AgentPermissionResponse, { behavior: 'allow' }>; tools: string[] }[] {
  if (request.kind !== 'tool') return []
  const updates = [...(request.suggestions ?? [])]
  if (EXACT_MCP_TOOL.test(request.name)) {
    updates.push({ type: 'addRules', rules: [{ toolName: request.name }], behavior: 'allow', destination: 'session' })
  }
  const options: { option: PermissionOption; response: Extract<AgentPermissionResponse, { behavior: 'allow' }>; tools: string[] }[] = []
  const seen = new Set<string>()
  for (const update of updates) {
    const parsed = SessionRuleSchema.safeParse(update)
    if (!parsed.success) continue
    const rules = parsed.data.rules
    if (rules.some(rule => !EXACT_MCP_TOOL.test(rule.toolName) && !rule.ruleContent)) continue
    const sessionRules = rules.map(rule => rule.ruleContent === undefined ? rule.toolName : `${rule.toolName}(${rule.ruleContent})`)
    const key = JSON.stringify(sessionRules)
    if (seen.has(key)) continue
    seen.add(key)
    options.push({
      option: { id: options.length === 0 ? 'allow_session' : `allow_session_${options.length}`, label: `Allow for this session: ${sessionRules.join(', ')}`, effect: 'allow_session', sessionRules },
      response: { behavior: 'allow', updatedPermissions: [{ ...parsed.data, destination: 'session' }] },
      tools: rules.map(rule => rule.toolName),
    })
  }
  return options
}
