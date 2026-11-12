/**
 * 契约测试用的 ACP agent：作为子进程跑，经 stdio 说 ACP v1（SDK 1.4 的 agent 端），按提示词里的
 * `scenario:<名字>` 演一个场景——流式回复、一次工具调用、一次权限请求（取消则停下）、一次表单式提问
 * （`elicitation/create`）、一张几个问题的表单（单选与多选各带"其他"文本字段，`_meta.liwa.otherFor` 的写法同
 * liwa ACP 服务端；说出收到的结构化答案）、说出输入里的图片、一直跑到被取消；会话有模型选项
 * （`session/set_config_option`）与两种模式（`session/set_mode`）。不是测试文件。
 * @module @liwa/brain-acp/tests/fixtures/mock-acp-agent
 */

import { randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import {
  agent as createAgentApp, methods, ndJsonStream, PROTOCOL_VERSION, RequestError,
  type AgentContext, type ContentBlock, type PromptResponse, type SessionConfigOption, type SessionModeState,
} from '@agentclientprotocol/sdk'

const cancels = new Map<string, () => void>()
const cancelled = new Set<string>()
const MODELS = ['mock-small', 'mock-large']
const models = new Map<string, string>()
const modes = new Map<string, string>()

function promptText(prompt: ContentBlock[]): string {
  return prompt.map(block => (block.type === 'text' ? block.text : '')).join('')
}

function configOptions(sessionId: string): SessionConfigOption[] {
  return [{
    id: 'model',
    name: 'Model',
    category: 'model',
    type: 'select',
    currentValue: models.get(sessionId) ?? 'mock-small',
    options: MODELS.map(value => ({ value, name: value })),
  }]
}

function modeState(sessionId: string): SessionModeState {
  return {
    currentModeId: modes.get(sessionId) ?? 'default',
    availableModes: [{ id: 'default', name: 'Default' }, { id: 'plan', name: 'Plan' }],
  }
}

const usage = { inputTokens: 13, outputTokens: 5, cachedReadTokens: 2, totalTokens: 20 }

async function say(client: AgentContext, sessionId: string, text: string): Promise<void> {
  const messageId = randomUUID()
  for (const chunk of [text.slice(0, 4), text.slice(4)]) {
    await client.notify(methods.client.session.update, {
      sessionId,
      update: { sessionUpdate: 'agent_message_chunk', messageId, content: { type: 'text', text: chunk } },
    })
  }
}

async function runScenario(client: AgentContext, sessionId: string, scenario: string, prompt: ContentBlock[]): Promise<PromptResponse> {
  switch (scenario) {
    case 'tool': {
      await client.notify(methods.client.session.update, {
        sessionId,
        update: { sessionUpdate: 'tool_call', toolCallId: 'call-read', title: 'Read README.md', kind: 'read', status: 'in_progress', rawInput: { path: 'README.md' } },
      })
      await client.notify(methods.client.session.update, {
        sessionId,
        update: { sessionUpdate: 'tool_call_update', toolCallId: 'call-read', status: 'completed', rawOutput: { content: '# readme' } },
      })
      await say(client, sessionId, 'Read the readme.')
      return { stopReason: 'end_turn', usage }
    }
    case 'permission': {
      cancelled.delete(sessionId)
      cancels.set(sessionId, () => { cancelled.add(sessionId) })
      await client.notify(methods.client.session.update, {
        sessionId,
        update: { sessionUpdate: 'tool_call', toolCallId: 'call-shell', title: 'Run ls', kind: 'execute', status: 'pending', rawInput: { command: 'ls' } },
      })
      const { outcome } = await client.request(methods.client.session.requestPermission, {
        sessionId,
        toolCall: { toolCallId: 'call-shell', title: 'Run ls', kind: 'execute' },
        options: [
          { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
          { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
          { optionId: 'no', name: 'Reject', kind: 'reject_once' },
        ],
      })
      const allowed = outcome.outcome === 'selected' && (outcome.optionId === 'yes' || outcome.optionId === 'always')
      await client.notify(methods.client.session.update, {
        sessionId,
        update: { sessionUpdate: 'tool_call_update', toolCallId: 'call-shell', status: allowed ? 'completed' : 'failed', rawOutput: allowed ? { output: 'README.md' } : { message: 'denied' } },
      })
      // 客户端以"拒绝并停下"作答时紧接着发 session/cancel：留一点时间让它到达，像真 agent 一样停在这里。
      await new Promise(resolve => setTimeout(resolve, 100))
      cancels.delete(sessionId)
      if (cancelled.delete(sessionId)) return { stopReason: 'cancelled' }
      await say(client, sessionId, allowed ? 'Ran it.' : 'Did not run it.')
      return { stopReason: 'end_turn', usage }
    }
    case 'question': {
      const response = await client.request(methods.client.elicitation.create, {
        sessionId,
        mode: 'form',
        message: 'Which color should the button be?',
        requestedSchema: {
          type: 'object',
          properties: {
            color: {
              type: 'string',
              title: 'Color',
              description: 'Which color should the button be?',
              oneOf: [{ const: 'red', title: 'red' }, { const: 'blue', title: 'blue' }],
            },
          },
        },
      })
      const color = response.action === 'accept' && 'content' in response ? (response.content as Record<string, unknown> | null)?.color : undefined
      await say(client, sessionId, typeof color === 'string' ? `Answered: ${color}` : `Question ${response.action}`)
      return { stopReason: 'end_turn', usage }
    }
    case 'answers': {
      const other = (target: string): { type: 'string'; title: string; description: string; _meta: { liwa: { otherFor: string } } } =>
        ({ type: 'string', title: 'Other', description: `Optional free-text answer for ${target}`, _meta: { liwa: { otherFor: target } } })
      const choice = (label: string): { const: string; title: string } => ({ const: label, title: label })
      const response = await client.request(methods.client.elicitation.create, {
        sessionId,
        mode: 'form',
        message: 'A few questions before I start.',
        requestedSchema: {
          type: 'object',
          properties: {
            pick: { type: 'string', title: 'Pick', description: 'Which color should the button be?', oneOf: [choice('red'), choice('blue, green')] },
            pick__other: other('pick'),
            tags: { type: 'array', title: 'Tags', description: 'Which tags apply?', items: { anyOf: [choice('a, b'), choice('c'), choice('d')] } },
            tags__other: other('tags'),
            note: { type: 'string', title: 'Note', description: 'Anything else?' },
          },
        },
      })
      if (response.action !== 'accept' || !('content' in response)) {
        await say(client, sessionId, `Question ${response.action}`)
        return { stopReason: 'end_turn', usage }
      }
      // 照这张表单读回答案：选项在问题自己的字段，补充文字在它的"其他"字段；自由文本问题就是它自己的字段。
      const content = (response.content ?? {}) as Record<string, unknown>
      const read = (key: string, free: boolean): { selected: string[]; custom?: string } => {
        const value = content[key]
        const custom = free ? value : content[`${key}__other`]
        const selected = free ? [] : Array.isArray(value) ? value.map(String) : typeof value === 'string' ? [value] : []
        return { selected, ...(typeof custom === 'string' && custom !== '' ? { custom } : {}) }
      }
      await say(client, sessionId, `ANSWERS ${JSON.stringify({ pick: read('pick', false), tags: read('tags', false), note: read('note', true) })}`)
      return { stopReason: 'end_turn', usage }
    }
    case 'image': {
      const images = prompt.flatMap(block => (block.type === 'image' ? [block.mimeType] : []))
      await say(client, sessionId, images.length === 0 ? 'No images.' : `Images: ${images.join(', ')}`)
      return { stopReason: 'end_turn', usage }
    }
    case 'long':
      // 先登记取消再说话：客户端在 prompt 发出时就报回合开始，取消可能在说话的两次 await 之间到达。
      return new Promise<PromptResponse>((resolve) => {
        const output = Promise.withResolvers<undefined>()
        cancels.set(sessionId, () => {
          // ACP 的终止答复之后不能再发旧回合的块，否则新回合无法从无 turnId 的通知识别归属。
          void output.promise.then(() => { resolve({ stopReason: 'cancelled' }) })
        })
        void say(client, sessionId, 'Working on it').then(
          () => { output.resolve(undefined) },
          (_closedConnection: unknown) => { output.resolve(undefined) }, // 连接已断时不再有输出需要排空。
        )
      })
    default:
      await say(client, sessionId, `Reply for ${scenario}.`)
      return { stopReason: 'end_turn', usage }
  }
}

const app = createAgentApp({ name: 'mock-acp-agent' })
  .onRequest(methods.agent.initialize, () => ({
    protocolVersion: PROTOCOL_VERSION,
    agentCapabilities: {
      loadSession: false,
      promptCapabilities: { image: true, audio: false, embeddedContext: false },
      sessionCapabilities: { resume: {}, close: {} },
    },
    authMethods: [],
  }))
  .onRequest(methods.agent.session.new, () => {
    const sessionId = randomUUID()
    return { sessionId, configOptions: configOptions(sessionId), modes: modeState(sessionId) }
  })
  .onRequest(methods.agent.session.resume, ({ params }) => ({
    configOptions: configOptions(params.sessionId),
    modes: modeState(params.sessionId),
  }))
  .onRequest(methods.agent.session.close, () => ({}))
  .onRequest(methods.agent.session.setConfigOption, ({ params }) => {
    if (params.configId !== 'model' || typeof params.value !== 'string' || !MODELS.includes(params.value)) {
      throw RequestError.invalidParams(undefined, `unknown option ${params.configId}=${String(params.value)}`)
    }
    models.set(params.sessionId, params.value)
    return { configOptions: configOptions(params.sessionId) }
  })
  .onRequest(methods.agent.session.setMode, async ({ params, client }) => {
    if (!modeState(params.sessionId).availableModes.some(mode => mode.id === params.modeId)) {
      throw RequestError.invalidParams(undefined, `unknown mode ${params.modeId}`)
    }
    modes.set(params.sessionId, params.modeId)
    await client.notify(methods.client.session.update, {
      sessionId: params.sessionId,
      update: { sessionUpdate: 'current_mode_update', currentModeId: params.modeId },
    })
    return {}
  })
  .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    const scenario = /scenario:([a-z]+)/u.exec(promptText(params.prompt))?.[1] ?? 'reply'
    return runScenario(client, params.sessionId, scenario, params.prompt)
  })
  .onNotification(methods.agent.session.cancel, ({ params }) => {
    cancels.get(params.sessionId)?.()
    cancels.delete(params.sessionId)
  })

app.connect(ndJsonStream(
  Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
))
process.stdin.on('end', () => { process.exit(0) })
