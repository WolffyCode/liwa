/** SDK fixture for native registry changes and unmodified DeepSeek request observation. */
import { appendFile } from 'node:fs/promises'
import { defineTool } from '@liwa/tools'

export const name = 'sdk-dynamic-tool-cache-fixture'
export const inject = ['tools', 'systemPrompt']

/** Observe each agent request on the wire and let the model add or remove a scoped tool. */
export function apply(ctx, config) {
  const states = new Map()
  ctx.on('session/event', (session, event) => {
    const state = states.get(session.id)
    if (state !== undefined && event.type === 'step/start') {
      state.turn = event.data.turn
      state.step = event.data.step
    }
  })
  // The DeepSeek adapter calls the process fetch per request, so wrapping it shows the exact serialized
  // body. Only agent requests carry cache_tool_control; title and other utility requests are skipped.
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/messages') && typeof init?.body === 'string') {
      const body = JSON.parse(init.body)
      if (body.tools?.some(tool => tool.name === 'cache_tool_control')) {
        const [state] = states.values()
        if (state === undefined) throw new Error('The SDK request has no observed agent.')
        await appendFile(config.evidencePath, `${JSON.stringify({ ...state, body })}\n`)
      }
    }
    return originalFetch(input, init)
  }
  ctx.effect(() => () => { globalThis.fetch = originalFetch })
  ctx.on('agent/created', ({ agent }) => {
    const scope = agent.ctx
    const state = { stage: 'initial', turn: 0, step: 0 }
    states.set(agent.id, state)
    scope.effect(() => () => { states.delete(agent.id) })
    scope.effect(() => scope.tools.restrict({ allow: [] }))
    let guidance = ''
    scope.systemPrompt.section({ name: 'sdk:dynamic-tool-guidance', order: 400, text: () => guidance })
    let removeTool
    scope.effect(() => scope.tools.register(defineTool({
      name: 'cache_tool_control',
      description: 'Add or remove the temporary cache_sample tool. It becomes available on the model step after add returns.',
      parameters: { action: { type: 'string', enum: ['add', 'remove'], required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute({ action }) {
        if (action === 'add') {
          if (removeTool !== undefined) throw new Error('The sample tool is already registered.')
          if (config.updatePrompt) guidance = 'Place each generated sample label on its own line.'
          removeTool = scope.effect(() => scope.tools.register(defineTool({
            name: 'cache_sample',
            description: 'Read a randomly generated sample label created for this example run.',
            parameters: {},
            output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
            async execute() {
              await appendFile(config.callsPath, 'sample\n')
              return config.sampleLabel
            },
          })))
          state.stage = 'added'
          await appendFile(config.callsPath, 'add\n')
          return 'Tool added. Call cache_sample on the next model step to obtain the generated sample label.'
        }
        if (removeTool === undefined) throw new Error('The sample tool is not registered.')
        await removeTool()
        removeTool = undefined
        state.stage = 'removed'
        await appendFile(config.callsPath, 'remove\n')
        return 'Tool removed. The sample tool is unavailable.'
      },
    })))
  })
}
