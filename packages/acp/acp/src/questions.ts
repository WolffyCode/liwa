/**
 * 底座的"向用户提问"（`ctx.userQuestions`，模型的 `ask_user_question`、计划审批）经标准 ACP 的表单式
 * elicitation（`elicitation/create`）问客户端。只在客户端初始化时声明了 `elicitation.form` 才接手，否则交给下一个
 * 答复者。每个问题一个表单字段（字段名 = 问题号）：有选项的单选是带 `oneOf` 的字符串、多选是 `anyOf` 的数组，
 * 没有选项的是自由文本；有选项且允许补充文字的问题另配一个"其他"文本字段，以 `_meta.liwa.otherFor` 标明属于
 * 哪个问题（客户端 `@liwa/brain-acp` 按它把补充文字归回那个问题）。客户端谢绝或取消按"用户撤下了问题"处理。
 * @module @liwa/acp/questions
 */

import type { ElicitationPropertySchema, ElicitationSchema } from '@agentclientprotocol/sdk'
import {
  UserQuestionError,
  type AskUserQuestionAnswer, type AskUserQuestionAnswerItem, type AskUserQuestionItem,
} from '@liwa/user-questions'

/** "其他"文本字段名的后缀（字段的 `_meta.liwa.otherFor` 才是归属的依据）。 */
const OTHER_SUFFIX = '__other'

/**
 * 问题 → 表单字段。
 * @param item - 底座的问题。
 * @returns 字段名到字段定义。
 */
function questionFields(item: AskUserQuestionItem): [string, ElicitationPropertySchema][] {
  const title = item.header ?? item.question
  const description = item.detail === undefined ? item.question : `${item.question}\n\n${item.detail}`
  const options = item.options ?? []
  if (options.length === 0) return [[item.id, { type: 'string', title, description }]]
  const choices = options.map(option => ({
    const: option.label,
    title: option.label,
    ...(option.description === undefined ? {} : { description: option.description }),
  }))
  const field: ElicitationPropertySchema = item.multiSelect === true
    ? { type: 'array', title, description, items: { anyOf: choices } }
    : { type: 'string', title, description, oneOf: choices }
  // 审批类问题只有固定动作，不收自由文本。
  if (item.intent?.kind === 'approval') return [[item.id, field]]
  return [
    [item.id, field],
    [`${item.id}${OTHER_SUFFIX}`, { type: 'string', title: 'Other', description: `Optional free-text answer for "${title}"`, _meta: { liwa: { otherFor: item.id } } }],
  ]
}

/**
 * 一组问题的表单。
 * @param questions - 底座的问题。
 * @returns elicitation 的 `requestedSchema`。
 */
export function questionSchema(questions: readonly AskUserQuestionItem[]): ElicitationSchema {
  return { type: 'object', properties: Object.fromEntries(questions.flatMap(questionFields)), required: [] }
}

/**
 * 客户端填回的表单 → 底座的答案；每个问题都要有答（选中的选项或自由文本）。
 * @param questions - 底座的问题。
 * @param content - 客户端的表单内容。
 * @returns 底座的答案。
 * @throws {UserQuestionError} `BAD_ANSWER`：有问题没答，或选了不存在的选项。
 */
export function answerFromContent(
  questions: readonly AskUserQuestionItem[],
  content: Readonly<Record<string, unknown>>,
): AskUserQuestionAnswer {
  const answers: AskUserQuestionAnswerItem[] = questions.map((item) => {
    const labels = new Set((item.options ?? []).map(option => option.label))
    const raw = content[item.id]
    const values = (Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw]).map(String).filter(value => value !== '')
    const selected = values.filter(value => labels.has(value))
    const strays = values.filter(value => !labels.has(value))
    if (labels.size > 0 && strays.length > 0 && item.multiSelect === true) {
      throw new UserQuestionError(`question ${item.id} has no option ${JSON.stringify(strays[0])}`, 'BAD_ANSWER')
    }
    const other = content[`${item.id}${OTHER_SUFFIX}`]
    const customText = [...strays, ...(typeof other === 'string' && other.trim() !== '' ? [other.trim()] : [])].join(', ')
    if (selected.length === 0 && customText === '') {
      throw new UserQuestionError(`question ${item.id} was not answered`, 'BAD_ANSWER')
    }
    return { id: item.id, selected, ...(customText === '' ? {} : { custom: customText }) }
  })
  return { answers }
}
