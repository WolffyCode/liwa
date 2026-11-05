/**
 * 契约测试用的脚本化模型端点：说 Messages 兼容的 SSE，让真的 `liwa --profile deepseek` 进程（真的
 * llm-deepseek 适配器经 `DEEPSEEK_BASE_URL` 指过来）按提示词里的 `scenario:<名字>` 演一个场景。按对话状态
 * 回答，不按请求次序，所以多个会话、子会话可以交错。不是测试文件，测试里起它。
 * @module @liwa/brain-deepseek/tests/fixtures/scripted-model
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { CHILD_PERMISSION_MARK, echoAnswers } from '@liwa/brain-testkit'
import type { PermissionAnswer } from '@liwa/brain'

/** 脚本化模型的可调项。 */
export interface ScriptedModelOptions {
  /** `tool` 场景读的文件。 */
  readPath: string
  /** `permission` 场景写的文件（在工作区之外，触发批准）。 */
  outsidePath: string
}

/** 一个起好的脚本化模型。 */
export interface ScriptedModel {
  /** 给 `DEEPSEEK_BASE_URL` 的地址（含 `/v1`）。 */
  readonly baseURL: string
  /** 收到的请求体，按到达顺序。 */
  readonly requests: unknown[]
  /** 每个请求到达的时刻（`Date.now()`），与 {@link requests} 一一对应。 */
  readonly arrivals: number[]
  /** 关掉服务器（挂着的流一起断）。 */
  close(): Promise<void>
}

interface MessageBlock {
  type?: string
  text?: string
  content?: string | MessageBlock[]
  source?: { media_type?: string }
}

interface ChatMessage {
  role?: string
  content?: string | MessageBlock[]
}

/**
 * 一条消息的文本。
 * @param message - Messages 请求里的一条消息。
 * @returns 文本块连起来。
 */
function messageText(message: ChatMessage): string {
  if (typeof message.content === 'string') return message.content
  return (message.content ?? []).map(block => (block.type === 'text' ? block.text ?? '' : '')).join('')
}

/**
 * 一个请求体里点名的场景（测试里按它挑出某个会话的请求）。
 * @param body - 请求体。
 * @returns 场景名。
 */
export function requestScenario(body: unknown): string {
  return scenarioOf((body as { messages?: ChatMessage[] }).messages ?? [])
}

/**
 * 请求里点名的场景（从对话里第一处 `scenario:<名字>` 读）。
 * @param messages - 对话。
 * @returns 场景名。
 */
function scenarioOf(messages: ChatMessage[]): string {
  for (const message of messages) {
    if (message.role !== 'user') continue
    const match = /scenario:([a-z-]+)/u.exec(messageText(message))
    if (match?.[1] !== undefined) return match[1]
  }
  return 'reply'
}

/**
 * 对话里已经有工具结果（每个场景至多调一次工具，有结果就是收尾那一步；插话可能排在结果之后）。
 * @param messages - 对话。
 * @returns 是否。
 */
function afterToolResult(messages: ChatMessage[]): boolean {
  return messages.some(message => Array.isArray(message.content) && message.content.some(block => block.type === 'tool_result'))
}

/**
 * 最后一个工具结果的文字。
 * @param messages - 对话。
 * @returns 文字；没有时为空串。
 */
function lastToolResult(messages: ChatMessage[]): string {
  const blocks = messages.flatMap(message => (Array.isArray(message.content) ? message.content : [])).filter(block => block.type === 'tool_result')
  const content = blocks.at(-1)?.content
  if (typeof content === 'string') return content
  return (content ?? []).map(block => block.text ?? '').join('')
}

/**
 * `ask_user_question` 的结果（`{"answers":[{ id, selected, custom? }]}`）读成以问题号为键的答案。
 * @param result - 工具结果的文字。
 * @returns 答案；读不出时为空。
 */
function toolAnswers(result: string): Record<string, PermissionAnswer> {
  try {
    const parsed = JSON.parse(result) as { answers?: { id: string; selected: string[]; custom?: string }[] }
    return Object.fromEntries((parsed.answers ?? []).map(answer => [
      answer.id,
      { selected: answer.selected, ...(answer.custom === undefined ? {} : { custom: answer.custom }) },
    ]))
  } catch (_notJson) {
    // 不是答案（例如问题被撤下）：说出空答案，测试按不符处理。
    return {}
  }
}

/**
 * 对话里出现过的图片的 MIME。
 * @param messages - 对话。
 * @returns MIME。
 */
function imageTypes(messages: ChatMessage[]): string[] {
  return messages.flatMap(message => (Array.isArray(message.content) ? message.content : []))
    .flatMap(block => (block.type === 'image' ? [block.source?.media_type ?? 'image/?'] : []))
}

function send(response: ServerResponse, event: Record<string, unknown>): void {
  response.write(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
}

function openStream(response: ServerResponse): void {
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive' })
  response.flushHeaders()
  send(response, {
    type: 'message_start',
    message: { id: 'scripted-message', type: 'message', role: 'assistant', model: 'scripted', content: [], usage: { input_tokens: 11, output_tokens: 0 } },
  })
}

function text(response: ServerResponse, reply: string): void {
  openStream(response)
  send(response, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  for (const chunk of [reply.slice(0, Math.ceil(reply.length / 2)), reply.slice(Math.ceil(reply.length / 2))]) {
    send(response, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk } })
  }
  send(response, { type: 'content_block_stop', index: 0 })
  send(response, { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 7 } })
  send(response, { type: 'message_stop' })
  response.end()
}

function toolUse(response: ServerResponse, name: string, input: Record<string, unknown>): void {
  openStream(response)
  send(response, { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `call-${name}-${String(Date.now())}`, name, input: {} } })
  send(response, { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } })
  send(response, { type: 'content_block_stop', index: 0 })
  send(response, { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 5 } })
  send(response, { type: 'message_stop' })
  response.end()
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array))
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * 起一个脚本化模型。
 * @param options - 场景要用的文件路径。
 * @returns 起好的模型。
 */
export async function startScriptedModel(options: ScriptedModelOptions): Promise<ScriptedModel> {
  const requests: unknown[] = []
  const arrivals: number[] = []
  const live = new Set<ServerResponse>()
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || !(request.url ?? '').endsWith('/messages')) {
        response.writeHead(404).end()
        return
      }
      const body = await readBody(request)
      requests.push(body)
      arrivals.push(Date.now())
      const messages = (body as { messages?: ChatMessage[] }).messages ?? []
      const scenario = scenarioOf(messages)
      const done = afterToolResult(messages)
      live.add(response)
      response.on('close', () => { live.delete(response) })
      switch (scenario) {
        case 'tool':
          if (done) text(response, 'Read it.')
          else toolUse(response, 'read', { file_path: options.readPath })
          return
        case 'permission':
          // 收尾那一步慢一点：主人以"拒绝并停下"作答时，紧随其后的 session/cancel 先到。
          if (done) setTimeout(() => { text(response, 'Wrote it, or was told not to.') }, 300)
          // 写工作区之外并申请越权：沙箱策略为 ask 时要经批准（ACP 的 session/request_permission）。
          else toolUse(response, 'write', {
            file_path: options.outsidePath,
            content: 'scripted\n',
            sandbox_permissions: 'danger-full-access',
            justification: 'the contract test asks for a write outside the workspace',
          })
          return
        case 'child':
          if (done) text(response, 'The child is back.')
          else toolUse(response, 'subagent', { prompt: 'scenario:child-inner look around', description: 'explore' })
          return
        case 'child-inner':
          text(response, 'Child looked around.')
          return
        case 'child-permission':
          if (done) text(response, 'The child asked and came back.')
          else toolUse(response, 'subagent', { prompt: 'scenario:child-write write a file', description: 'writer' })
          return
        case 'child-write':
          if (done) text(response, 'Child wrote it, or was told not to.')
          else toolUse(response, 'write', {
            file_path: options.outsidePath,
            content: 'child\n',
            sandbox_permissions: 'danger-full-access',
            justification: `the child asks for a write outside the workspace (${CHILD_PERMISSION_MARK})`,
          })
          return
        case 'two-tools': {
          // 连调两次工具再收尾（测工具调用预算）。
          const results = messages.filter(message => Array.isArray(message.content) && message.content.some(block => block.type === 'tool_result')).length
          if (results >= 2) text(response, 'Read it twice.')
          else toolUse(response, 'read', { file_path: options.readPath })
          return
        }
        case 'steer':
          // 第一步跑一个慢工具；插话在下一步的请求里出现与否，原样说出来。
          if (done) text(response, messages.some(message => messageText(message).includes('STEER-MARK')) ? 'steer seen' : 'steer missing')
          else toolUse(response, 'bash', { command: 'sleep 2', description: 'wait two seconds' })
          return
        case 'question':
          if (done) text(response, `Answered: ${lastToolResult(messages)}`)
          else toolUse(response, 'ask_user_question', {
            questions: [{
              id: 'color',
              header: 'Color',
              question: 'Which color should the button be?',
              options: [{ label: 'red' }, { label: 'blue', description: 'the calm one' }],
            }],
          })
          return
        case 'answers':
          // 一次问三个问题：选项带逗号的单选、多选与只收自由文本的问题；作答后原样说出收到的结构化答案。
          if (done) text(response, `Answered: ${echoAnswers(toolAnswers(lastToolResult(messages)))}`)
          else toolUse(response, 'ask_user_question', {
            questions: [
              { id: 'pick', header: 'Pick', question: 'Which color should the button be?', options: [{ label: 'red' }, { label: 'blue, green' }] },
              { id: 'tags', header: 'Tags', question: 'Which tags apply?', options: [{ label: 'a, b' }, { label: 'c' }, { label: 'd' }], multi_select: true },
              { id: 'note', header: 'Note', question: 'Anything else?' },
            ],
          })
          return
        case 'image':
          text(response, `Images: ${imageTypes(messages).join(', ') || 'none'}`)
          return
        case 'plan-exit':
          // 计划模式里交一份计划给主人审（exit_plan_mode → 计划审批问题），批了再说出结果。
          if (done) text(response, `Plan review: ${lastToolResult(messages)}`)
          else toolUse(response, 'exit_plan_mode', { plan: '# Add a README section\n\n1. Write the section.\n2. Link it from the index.' })
          return
        case 'background':
          // 开一个慢的后台子会话，然后父会话挂着（等被抢占取消）；子会话完成后根会话被叫醒，说出子会话的结果。
          if (messages.some(message => messageText(message).includes('BACKGROUND-DONE'))) text(response, 'The background child reported BACKGROUND-DONE.')
          else if (done) openStream(response)
          else toolUse(response, 'subagent', { prompt: 'scenario:background-inner take your time', description: 'researcher' })
          return
        case 'background-inner':
          // 子会话先跑一个慢命令，再交回结果。
          if (done) text(response, 'BACKGROUND-DONE: the notes are ready.')
          else toolUse(response, 'bash', { command: 'sleep 2', description: 'wait two seconds' })
          return
        case 'long':
          // 挂着不答，直到客户端取消（连接被关）。
          openStream(response)
          return
        default:
          text(response, `Reply for ${scenario}.`)
      }
    })().catch(() => { response.destroy() })
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const { port } = server.address() as AddressInfo
  return {
    baseURL: `http://127.0.0.1:${String(port)}/v1`,
    requests,
    arrivals,
    async close() {
      for (const response of live) response.destroy()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    },
  }
}
