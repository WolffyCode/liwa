/**
 * `deepseek` 提供方的进程（`liwa --profile deepseek`，01 §4.1）：底座的 ACP v1 服务器 + 本模块的 `_liwa` 扩展 +
 * 按会话种类的五个预设，只走 stdio、不开端口；组合在 `cordis.patch.yml` 与 `presets/`。
 *
 * 本模块是 `_liwa` ACP 扩展插件：按 `session/new` 的 `_meta.liwa` 组装每个会话（按会话种类挂预设、会话说明进
 * Agent 作用域段、回合推理与工具调用预算、收尾工具、模型、原生子会话策略），提供 `_liwa/steer`、`_liwa/usage`、
 * `_liwa/children` 三个方法，并把用量、子会话的开始与结束、子会话权限请求的来源写进 `_meta.liwa`。它只经
 * `ctx.acpExtensions` 接到标准 ACP 服务器上，不挂它时进程仍是标准 ACP。线格式（{@link LIWA_METHODS} 等）一并
 * 从这里导出，本体里的 `@liwa/brain-deepseek` 只从这里取。
 * @module @liwa/deepseek-app
 */

import {
  RequestError,
  type PromptResponse, type RequestPermissionRequest, type Usage as AcpUsage,
} from '@agentclientprotocol/sdk'
import type { Context } from '@liwa/cordis'
import z from '@liwa/schemastery'
import type { Agent } from '@liwa/agent'
import type { AcpExtension, AcpSessionSetup, AcpSessionView } from '@liwa/acp'
import { scopeOf } from '@liwa/scope'
import { createUserMessage, type TokenUsage } from '@liwa/llm'
import type {} from '@liwa/agent-preset-registry'
import type {} from '@liwa/agent-default-model'
import type {} from '@liwa/subagent'
import type {} from '@liwa/session'
import type {} from '@liwa/system-prompt'
import type {} from '@liwa/tools'
import { randomUUID } from 'node:crypto'
import {
  LIWA_METHODS, LiwaCancelMetaSchema, LiwaSessionMetaSchema, LiwaSessionParamsSchema, LiwaSteerParamsSchema,
  addLiwaUsage, liwaMeta, liwaMetaOf,
  type LiwaChildEvent, type LiwaChildView, type LiwaSessionMeta, type LiwaTurnEvent, type LiwaUsage,
} from './protocol.ts'

export * from './protocol.ts'

/** 稳定的 cordis 插件名。 */
export const name = 'deepseek-liwa'

/** 接到 ACP 服务器的扩展口上，会话由 `ctx.agents` 管。 */
export const inject = ['acpExtensions', 'agents']

/** `_liwa` 扩展的配置。 */
export interface Config {
  /** 会话预设的 id 前缀：会话种类 `work` 用 `<前缀>work`；`_meta.liwa` 不给种类时用注册表的默认预设。 */
  presetPrefix: string
  /** 会开原生子会话的工具名；子会话策略只管这些工具。 */
  childTools: string[]
  /** `nativeToolPolicy: 'readonly'` 时留下的只读原生工具（读文件、搜索、联网、本事、待办、提问、交付）。 */
  readonlyTools: string[]
  /** 会话说明在系统提示词里的顺序位置。 */
  notesOrder: number
  /** `_meta.liwa.model` 给了模型、当前又没有提供方路由时用的提供方。 */
  defaultProvider: string
}

export const Config: z<Config> = z.object({
  presetPrefix: z.string().default('deepseek-'),
  childTools: z.array(z.string()).default(['subagent', 'subagent_fork']),
  readonlyTools: z.array(z.string()).default([
    'read', 'read_image', 'glob', 'grep', 'web_search', 'web_fetch', 'skill', 'todo_write', 'ask_user_question', 'get_goal', 'present',
  ]),
  notesOrder: z.number().default(10_150),
  defaultProvider: z.string().default('deepseek-official'),
})

/** 一个子会话的记录。 */
interface ChildRecord {
  view: LiwaChildView
}

/** 一个 ACP 会话的 `_liwa` 状态。 */
interface LiwaSession {
  readonly sessionId: string
  readonly meta: LiwaSessionMeta
  /** 会话开着以来的用量。 */
  readonly total: LiwaUsage
  /** 上一次 `session/prompt` 返回之后的用量。 */
  prompt: LiwaUsage
  concludedBy: string | undefined
  toolCalls: number
  readonly children: Map<string, ChildRecord>
  /** 根会话在没有 `session/prompt` 时自己跑起来的回合（有的话）。 */
  autonomous: string | undefined
  /** 那个回合被 `session/cancel` 停过。 */
  autonomousCancelled: boolean
}

/**
 * 模型一次调用的 token → 线上用量（未命中缓存的输入与缓存读写分开）。
 * @param usage - 一次调用的 token。
 * @returns 线上用量。
 */
function tokensOf(usage: TokenUsage): NonNullable<LiwaUsage['tokens']> {
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    ...(usage.cacheReadTokens === undefined ? {} : { cacheRead: usage.cacheReadTokens }),
    ...(usage.cacheWriteTokens === undefined ? {} : { cacheWrite: usage.cacheWriteTokens }),
  }
}

/**
 * 灵鲸用量 → 标准 ACP 回合用量。
 * @param usage - 灵鲸用量。
 * @returns 标准用量；没有 token 时为 `undefined`。
 */
function standardUsage(usage: LiwaUsage): AcpUsage | undefined {
  const tokens = usage.tokens
  if (tokens === undefined) return undefined
  return {
    inputTokens: tokens.input,
    outputTokens: tokens.output,
    ...(tokens.cacheRead === undefined ? {} : { cachedReadTokens: tokens.cacheRead }),
    ...(tokens.cacheWrite === undefined ? {} : { cachedWriteTokens: tokens.cacheWrite }),
    totalTokens: tokens.input + tokens.output + (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0),
  }
}

/**
 * 子会话结束原因（`subagent/end`）→ 线上结束原因。
 * @param stopReason - 子会话的结束原因。
 * @returns 线上结束原因。
 */
function childStopReason(stopReason: string): 'completed' | 'failed' | 'cancelled' {
  switch (stopReason) {
    case 'completed':
      return 'completed'
    case 'aborted':
      return 'cancelled'
    default:
      return 'failed'
  }
}

/**
 * 挂上 `_liwa` 扩展。
 * @param ctx - 插件上下文。
 * @param config - 校验过的配置。
 */
export function apply(ctx: Context, config: Config): void {
  const registry = ctx.acpExtensions
  const sessions = new Map<string, LiwaSession>()
  const childTools = new Set(config.childTools)

  /** 一个 Agent 所在的 `_liwa` 会话与它上报经过的 ACP 会话。 */
  const resolve = (agent: Agent | undefined): { view: AcpSessionView; state: LiwaSession } | undefined => {
    if (agent === undefined) return undefined
    const view = registry.sessionOf(agent)
    const state = view === undefined ? undefined : sessions.get(view.sessionId)
    return view === undefined || state === undefined ? undefined : { view, state }
  }

  const emitChild = (view: AcpSessionView, child: LiwaChildEvent): void => {
    void view.notify({ sessionUpdate: 'session_info_update' }, liwaMeta({ child })).catch((error: unknown) => {
      ctx.logger.warn(`deepseek-liwa: child update for ${child.childId} failed: ${String(error)}`)
    })
  }

  const emitTurn = (view: AcpSessionView, turn: LiwaTurnEvent): void => {
    void view.notify({ sessionUpdate: 'session_info_update' }, liwaMeta({ turn })).catch((error: unknown) => {
      ctx.logger.warn(`deepseek-liwa: turn update for ${turn.turnId} failed: ${String(error)}`)
    })
  }

  /**
   * 收一个回合的用量与收尾工具（`session/prompt` 返回或根会话自己的回合结束时），并清零回合计数。
   * @param state - 会话状态。
   * @returns 这一回合的用量与收尾工具。
   */
  const settleTurn = (state: LiwaSession): { usage: LiwaUsage; concludedBy: string | undefined } => {
    const settled = { usage: state.prompt, concludedBy: state.concludedBy }
    state.prompt = {}
    state.concludedBy = undefined
    state.toolCalls = 0
    return settled
  }

  // 根会话在没有在途提示词时自己跑起来（后台子会话的结果叫醒它）：照样作为一个回合报给客户端，期间的更新都属于它。
  ctx.on('agent/status', ({ agent, status }) => {
    const found = resolve(agent)
    if (found === undefined || agent !== found.view.agent) return
    const { view, state } = found
    if (status === 'running' && state.autonomous === undefined && !view.prompting) {
      state.autonomous = randomUUID()
      state.autonomousCancelled = false
      emitTurn(view, { event: 'started', turnId: state.autonomous })
    } else if (status === 'idle' && state.autonomous !== undefined) {
      const turnId = state.autonomous
      const stopReason = state.autonomousCancelled ? 'cancelled' : 'completed'
      state.autonomous = undefined
      const { usage, concludedBy } = settleTurn(state)
      emitTurn(view, { event: 'ended', turnId, stopReason, usage, ...(concludedBy === undefined ? {} : { concludedBy }) })
    }
  })

  const setupSession = async (setup: AcpSessionSetup): Promise<void> => {
    const parsed = LiwaSessionMetaSchema.safeParse(liwaMetaOf({ _meta: setup.meta }) ?? {})
    if (!parsed.success) {
      throw RequestError.invalidParams(undefined, `_meta.liwa is invalid: ${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`)
    }
    const meta = parsed.data
    const state: LiwaSession = {
      sessionId: setup.sessionId,
      meta,
      total: {},
      prompt: {},
      concludedBy: undefined,
      toolCalls: 0,
      children: new Map(),
      autonomous: undefined,
      autonomousCancelled: false,
    }
    sessions.set(setup.sessionId, state)
    setup.agentCtx.effect(() => () => {
      if (sessions.get(setup.sessionId) === state) sessions.delete(setup.sessionId)
    }, 'deepseek-liwa.session')

    // 会话种类 → 预设；不给种类的普通 ACP 客户端用注册表的默认预设。
    const presets = ctx.get('agentPresets')
    if (presets !== undefined) {
      await presets.mount(setup.agentCtx, meta.mindKind === undefined ? undefined : `${config.presetPrefix}${meta.mindKind}`)
    }
    if (meta.notes !== undefined && meta.notes.trim() !== '') {
      setup.agentCtx.systemPrompt.section({ name: 'liwa:session-notes', order: config.notesOrder, text: meta.notes, interpolate: false })
    }
    // 原生工具策略：经 MCP 来的内核工具挂在 Agent 自己的作用域里，不受限；预设与宿主层的工具按策略留。
    const policy = meta.nativeToolPolicy ?? 'worktree'
    if (policy !== 'worktree') {
      const known = new Set(setup.agentCtx.tools.definitions(scopeOf(setup.agentCtx)).map(definition => definition.name))
      const allow = policy === 'none' ? [] : config.readonlyTools.filter(name => known.has(name))
      setup.agentCtx.tools.restrict({ allow })
    }
    const model = meta.model
    if (model !== undefined) {
      setup.agentCtx.on('agent/created', ({ agent }) => {
        const provider = agent.model.current()?.provider ?? ctx.get('agentDefaultModel')?.currentSelection().provider ?? config.defaultProvider
        agent.model.select({ provider, model })
        return undefined
      })
    }
    const maxInferences = meta.limits?.maxInferencesPerTurn
    if (maxInferences !== undefined) {
      // 回合推理预算：超出的那一步被拒，回合在此结束（00 §5.1 budget.inferences）。
      setup.agentCtx.on('agent/pre-step', (payload, next) => (payload.step > maxInferences ? Promise.resolve({ kind: 'reject' as const }) : next()))
    }
    const concludeOn = new Set(meta.concludeOn ?? [])
    if (concludeOn.size > 0) {
      // 收尾工具成功即结束回合（00 §5.1 concludeOn，落点是 core/tools 的 concludesTurn）；失败的结果从不收尾。
      setup.agentCtx.on('tools/execute', async (exec, next) => {
        if (!concludeOn.has(exec.name)) return next()
        exec.concludeTurn()
        const result = await next()
        if (!result.isError) state.concludedBy = exec.name
        return result
      })
    }
  }

  // 工具调用预算与原生子会话策略：根会话与它的后代的调用都在这里过。
  ctx.on('tools/pre-execute', async (exec, next) => {
    const found = resolve(exec.agent)
    if (found === undefined || exec.agent === undefined) return next()
    const { view, state } = found
    if (exec.agent === view.agent) {
      const max = state.meta.limits?.maxToolCallsPerTurn
      if (max !== undefined && state.toolCalls >= max) {
        return { kind: 'deny', reason: `the tool-call budget of this turn (${String(max)}) is spent; conclude the turn` }
      }
      state.toolCalls += 1
    }
    const policy = state.meta.childPolicy
    if (childTools.has(exec.name) && policy !== undefined) {
      if (!policy.native) return { kind: 'deny', reason: 'native child agents are disabled for this session' }
      const depth = (exec.agent.session.header.delegationDepth ?? 0) + 1
      if (depth > policy.maxDepth) return { kind: 'deny', reason: `child agents may nest at most ${String(policy.maxDepth)} level(s)` }
      const running = [...state.children.values()].filter(child => child.view.state === 'running').length
      if (running >= policy.maxConcurrent) return { kind: 'deny', reason: `at most ${String(policy.maxConcurrent)} child agent(s) may run at once` }
    }
    return next()
  })

  // 用量：根会话的每次模型调用计一次推理；子会话的 token 也算进根会话的回合（01 §4.5），分项记在子会话上。
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'assistant/message' || event.data.usage === undefined) return
    const agent = ctx.agents.get(session.header.id)
    const found = resolve(agent)
    if (found === undefined) return
    const tokens = tokensOf(event.data.usage)
    if (agent === found.view.agent) {
      addLiwaUsage(found.state.total, { tokens, inferences: 1 })
      addLiwaUsage(found.state.prompt, { tokens, inferences: 1 })
      return
    }
    addLiwaUsage(found.state.total, { tokens })
    addLiwaUsage(found.state.prompt, { tokens })
    const child = found.state.children.get(session.header.id)
    if (child !== undefined) addLiwaUsage(child.view.usage, { tokens, inferences: 1 })
  })

  ctx.on('subagent/start', (info) => {
    const child = ctx.agents.get(info.id)
    const found = resolve(child)
    if (found === undefined || child === undefined) return
    const parent = child.session.header.parentSession
    const parentChildId = parent !== undefined && parent !== found.view.sessionId ? parent : undefined
    const view: LiwaChildView = {
      childId: info.id,
      label: info.provider,
      ...(parentChildId === undefined ? {} : { parentChildId }),
      state: 'running',
      usage: {},
    }
    found.state.children.set(info.id, { view })
    emitChild(found.view, { event: 'started', childId: info.id, label: view.label, ...(parentChildId === undefined ? {} : { parentChildId }) })
  })

  ctx.on('subagent/end', (info) => {
    for (const state of sessions.values()) {
      const child = state.children.get(info.id)
      if (child === undefined || child.view.state === 'ended') continue
      const stopReason = childStopReason(info.stopReason)
      child.view.state = 'ended'
      child.view.stopReason = stopReason
      const view = registry.session(state.sessionId)
      if (view !== undefined) emitChild(view, { event: 'ended', childId: info.id, stopReason, usage: child.view.usage })
    }
  })

  const extension: AcpExtension = {
    name: 'liwa',
    methods: {
      [LIWA_METHODS.steer]: async (params, context) => {
        const parsed = LiwaSteerParamsSchema.safeParse(params)
        if (!parsed.success) throw RequestError.invalidParams(undefined, `${LIWA_METHODS.steer}: ${parsed.error.message}`)
        const view = context.session(parsed.data.sessionId)
        if (view === undefined) throw RequestError.invalidParams(undefined, `unknown session: ${parsed.data.sessionId}`)
        // 只在该会话有在跑的回合（在途提示词或它自己跑起来的回合）时插话；否则本体退化为下一回合。
        if (!running(view)) return { outcome: 'unavailable' }
        let content: Awaited<ReturnType<AcpSessionView['admit']>>
        try {
          content = await view.admit(parsed.data.prompt, context.signal)
        } catch (error) {
          throw RequestError.invalidParams(undefined, `${LIWA_METHODS.steer}: ${error instanceof Error ? error.message : String(error)}`)
        }
        if (!running(view)) return { outcome: 'unavailable' }
        view.agent.steer(createUserMessage({ content, source: { kind: 'user' } }))
        return { outcome: 'accepted' }
      },
      [LIWA_METHODS.usage]: (params) => {
        const parsed = LiwaSessionParamsSchema.safeParse(params)
        const state = parsed.success ? sessions.get(parsed.data.sessionId) : undefined
        if (state === undefined) return Promise.reject(RequestError.invalidParams(undefined, `${LIWA_METHODS.usage}: unknown session`))
        return Promise.resolve({
          usage: structuredClone(state.total),
          ...(state.meta.mindKind === undefined ? {} : { mindKind: state.meta.mindKind }),
          ...(state.meta.version === undefined ? {} : { version: state.meta.version }),
        })
      },
      [LIWA_METHODS.children]: (params) => {
        const parsed = LiwaSessionParamsSchema.safeParse(params)
        const state = parsed.success ? sessions.get(parsed.data.sessionId) : undefined
        if (state === undefined) return Promise.reject(RequestError.invalidParams(undefined, `${LIWA_METHODS.children}: unknown session`))
        return Promise.resolve({ children: [...state.children.values()].map(child => structuredClone(child.view)) })
      },
    },
    setupSession,
    promptResponse(view, response): PromptResponse {
      const state = sessions.get(view.sessionId)
      if (state === undefined) return response
      const { usage, concludedBy } = settleTurn(state)
      const standard = standardUsage(usage)
      return {
        ...response,
        ...(standard === undefined ? {} : { usage: standard }),
        _meta: { ...response._meta, ...liwaMeta({ usage, ...(concludedBy === undefined ? {} : { concludedBy }) }) },
      }
    },
    permissionRequest(view, agent, _approval, request): RequestPermissionRequest {
      // 后代的请求标明来自哪个子会话（01 §4.5：子会话的权限经父会话上报）；所问调用的工具、入参与理由由 ACP 服务端照实带上。
      if (agent === view.agent) return request
      return { ...request, _meta: { ...request._meta, ...liwaMeta({ childId: agent.session.id }) } }
    },
    cancelOptions(view, meta) {
      const state = sessions.get(view.sessionId)
      if (state?.autonomous !== undefined) state.autonomousCancelled = true
      const parsed = LiwaCancelMetaSchema.safeParse(liwaMetaOf({ _meta: meta }) ?? {})
      if (parsed.success && parsed.data.stopChildren === true) {
        // 暂停、排空、归属方结束：在跑的子会话一起停（它们的结束经 subagent/end 照常上报）。
        void ctx.get('subagents')?.drainDescendants([view.agent]).catch((error: unknown) => {
          ctx.logger.warn(`deepseek-liwa: stopping the child agents of ${view.sessionId} failed: ${String(error)}`)
        })
      }
      const keepQueue = (parsed.success ? parsed.data.keepQueue : undefined) ?? state?.meta.keepQueue
      return keepQueue === undefined ? undefined : { keepInbox: keepQueue }
    },
  }
  ctx.effect(() => registry.register(extension), 'deepseek-liwa.register')

  /**
   * 会话有没有在跑的回合：在途提示词，或根会话自己跑起来的回合。
   * @param view - 会话。
   * @returns 是否。
   */
  function running(view: AcpSessionView): boolean {
    return view.prompting || sessions.get(view.sessionId)?.autonomous !== undefined
  }
}
