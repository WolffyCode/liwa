/**
 * AskUserQuestion 的无歧义编码与最窄的会话权限规则。
 * @module @liwa/brain-claude-code/permissions
 */
import { BrainError, type PermissionAnswer, type PermissionQuestion } from '@liwa/brain'
import type { AgentMetadata, AgentPermissionRequest, AgentPermissionUpdate } from '@liwa/brain-shared/paseo/agent/agent-sdk-types'

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
  for (const question of questions) {
    if (Object.hasOwn(native, question.question)) throw new BrainError('invalid_input', 'brain.claude_answer_ambiguous', 'Duplicate question text cannot be encoded by Claude')
    const answer = answers[question.id] as PermissionAnswer
    const labels = question.options.map(option => option.label)
    if (new Set(labels).size !== labels.length) throw new BrainError('invalid_input', 'brain.claude_answer_ambiguous', 'Duplicate option labels cannot be encoded by Claude')
    if (answer.selected.length > 0 && answer.custom !== undefined && answer.custom.trim() !== '') {
      throw new BrainError('invalid_input', 'brain.claude_answer_notes_unverified', 'Selection plus notes requires real CLI annotations verification; choose options or provide a free-text answer')
    }
    if (question.multiSelect && (answer.selected.some(label => label.includes(',')) || answer.custom?.includes(','))) {
      throw new BrainError('invalid_input', 'brain.claude_answer_ambiguous', 'A comma in a multi-select answer is ambiguous in Claude')
    }
    if (answer.selected.length === 0 && labels.includes(answer.custom as string)) {
      throw new BrainError('invalid_input', 'brain.claude_answer_ambiguous', 'Free text identical to an option must be submitted as a selection')
    }
    native[question.question] = answer.selected.length > 0 ? answer.selected.join(', ') : answer.custom as string
  }
  return { ...request.input, answers: native }
}

/**
 * 仅为精确命名的 MCP 工具生成 session 规则，不照抄永久规则、模式或目录扩权建议。
 * @param request - 权限请求。
 * @returns 安全的会话规则；不能生成时省略该选项。
 */
export function sessionPermissionUpdate(request: AgentPermissionRequest): AgentPermissionUpdate | undefined {
  if (request.kind !== 'tool' || !/^mcp__[A-Za-z0-9_-]+__[A-Za-z0-9_-]+$/.test(request.name)) return undefined
  return { type: 'addRules', rules: [{ toolName: request.name }], behavior: 'allow', destination: 'session' }
}
