/** Order child execution after the advanced parent records its corresponding handoff. */
export const name = 'python-snapshot-workflow-order'

/**
 * @param {import('@liwa/cordis').Context} ctx - Scenario-local host context.
 * @param {{ parentSessionId: string, prompt: string, direct?: { prompt: string, callId: string } }} config - Exact advanced scenario identities.
 */
export function apply(ctx, config) {
  const started = new Set()
  const pending = new Map()
  let disposed = false
  let directResultRecorded = false
  let parentRequestFrozen = false

  ctx.effect(() => async () => {
    disposed = true
    const waits = [...pending.values()]
    for (const wait of waits) wait.reject(new Error('workflow snapshot barrier disposed'))
    await Promise.allSettled(waits.map(wait => wait.done))
    started.clear()
  })
  ctx.on('session/event', (session, event) => {
    if (disposed || session.id !== config.parentSessionId) return
    if (event.type === 'tool-workflow/agent-start') {
      started.add(event.data.childId)
      pending.get(event.data.childId)?.resolve()
    }
    if (config.direct === undefined) return
    if (event.type === 'tool/result' && event.data.message.source.callId === config.direct.callId) directResultRecorded = true
  })
  // The loop emits a stream `start` frame only after `buildRequest` has logged and frozen the step's request,
  // and it claimed that step's inbox before `step/start`; releasing the direct child here keeps its completion
  // notice after every parent record of the request that follows the handoff and inside the step after it.
  ctx.on('agent/assistant-stream', ({ agent, frame }) => {
    if (disposed || parentRequestFrozen || !directResultRecorded) return
    if (agent.session.id !== config.parentSessionId || frame.type !== 'start') return
    parentRequestFrozen = true
    for (const wait of pending.values()) if (wait.direct) wait.resolve()
  })
  ctx.on('agent/pre-step', async ({ agent, messages, turn, step, signal }, next) => {
    const hasPrompt = prompt => messages.some(message => message.content.some(block => block.type === 'text' && block.text === prompt))
    const direct = config.direct !== undefined && hasPrompt(config.direct.prompt)
    if (agent.session.header.parentSession !== config.parentSessionId || turn !== 1 || step !== 1
      || !direct && !hasPrompt(config.prompt)) {
      return next()
    }
    signal.throwIfAborted()
    if (disposed) throw new Error('workflow snapshot barrier disposed')
    if (direct ? !parentRequestFrozen : !started.has(agent.id)) {
      const wait = { ...Promise.withResolvers(), direct }
      const abort = () => { wait.reject(signal.reason) }
      signal.addEventListener('abort', abort, { once: true })
      wait.done = wait.promise.finally(() => {
        signal.removeEventListener('abort', abort)
        pending.delete(agent.id)
      })
      pending.set(agent.id, wait)
      await wait.done
    }
    signal.throwIfAborted()
    if (disposed) throw new Error('workflow snapshot barrier disposed')
    return next()
  })
}
