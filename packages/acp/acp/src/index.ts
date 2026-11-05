/**
 * Automation-only Agent Client Protocol server over JSON-RPC stdio.
 *
 * The bridge exposes persistent harness sessions to trusted programmatic
 * clients. It carries standard configuration, MCP mounts, prompt content,
 * committed semantic updates, cancellation, and one-shot permission decisions;
 * presentation and human-interaction features stay with Liwa's UI modules.
 *
 * @module @liwa/acp
 */

import type { Context } from '@liwa/cordis'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { Readable, Writable } from 'node:stream'
import Schema from '@liwa/schemastery'
import { brandString } from '@liwa/brand'
import { errorChain } from '@liwa/llm'
import {
  agent as createAcpAgentApp,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
  type AgentContext,
  type AuthenticateRequest,
  type CancelNotification,
  type CloseSessionRequest,
  type CloseSessionResponse,
  type InitializeRequest,
  type InitializeResponse,
  type ListSessionsRequest,
  type ListSessionsResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
  type RequestPermissionRequest,
  type ResumeSessionRequest,
  type ResumeSessionResponse,
  type SetSessionConfigOptionRequest,
  type SetSessionConfigOptionResponse,
  type SetSessionModeRequest,
  type SetSessionModeResponse,
  type SessionNotification,
  type Stream,
} from '@agentclientprotocol/sdk'
import type { Agent } from '@liwa/agent'
import type { Session, SessionEvent, SessionId } from '@liwa/session'
import type {} from '@liwa/session-persistence'
// Side-effect type import: declaration-merges the approval waterfall answered below.
import type {} from '@liwa/user-approval'
// Side-effect type import: declaration-merges the launcher's startup signal read below.
import type {} from '@liwa/cmdline'
import { supportsAcpImagePrompts } from './content.ts'
import { AcpExtensionHost, AcpExtensionRegistry, type AcpSessionView } from './extensions.ts'
import { AcpMcpConfigError } from './mcp.ts'
import { AcpModelConfigError } from './model-control.ts'
import { AcpModeError, sessionModeState, setSessionMode } from './modes.ts'
import { answerFromContent, questionSchema } from './questions.ts'
import { AcpSession } from './session.ts'
import { approvalToolCall } from './updates.ts'
import { UserQuestionError } from '@liwa/user-questions'

export {
  AcpExtensionRegistry,
  type AcpExtension, type AcpExtensionMethod, type AcpExtensionMethodContext, type AcpSessionSetup, type AcpSessionView,
} from './extensions.ts'

declare module '@liwa/cordis' {
  interface Context {
    /** Registry of ACP extensions (`_`-prefixed methods and `_meta` hooks); published by the ACP server. */
    acpExtensions: AcpExtensionRegistry
  }
}

/** Longest parent chain followed when routing a descendant's permission request to its root session. */
const MAX_DELEGATION_WALK = 64

/** Read a protocol `_meta` object, or nothing when absent or not an object. */
function metaOf(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

const DEFAULT_SESSION_LIST_PAGE_SIZE = 100

export const name = 'acp'
/** Core services required by the standard automation controls. */
export const inject = ['agents', 'llm', 'sessionPersistence', 'sessions']

/** Preserve invalid-parameter detail in the SDK wire error message. */
function invalidParams(detail: string): RequestError {
  return RequestError.invalidParams(undefined, detail)
}

/** Preserve failed-turn detail; plain handler errors become a generic wire internal error. */
function internalError(detail: string): RequestError {
  return RequestError.internalError(undefined, detail)
}

/** Plugin config: the provider/model selection used for each ACP-created agent. */
export interface AcpConfig {
  /** Provider route for created agents. */
  provider?: string
  /** Model name for created agents. */
  model?: string
  /** Maximum summaries returned by one session/list page. */
  sessionListPageSize?: number
  /** Runtime-only transport override; production uses stdio. */
  stream?: Stream
}

export const Config: Schema<AcpConfig> = Schema.object({
  provider: Schema.string(),
  model: Schema.string(),
  sessionListPageSize: Schema.natural().min(1).default(DEFAULT_SESSION_LIST_PAGE_SIZE),
})

/**
 * Mount the automation-only ACP server.
 * @param ctx - Cordis context carrying the agent factory and session events.
 * @param config - Initial provider/model selection and optional test transport.
 */
export function apply(ctx: Context, config: AcpConfig): void {
  // ACP handlers execute outside this plugin's injection scope, so capture the
  // injected service during apply rather than reading it lazily in a callback.
  const persistence = ctx.sessionPersistence
  const logger = ctx.logger
  const sessionListPageSize = resolveSessionListPageSize(config.sessionListPageSize)
  const sessions = new Map<SessionId, AcpSession>()
  const activating = new Set<SessionId>()
  let closed = false
  let imagePromptEnabled = false
  // Whether the client advertised form elicitation at initialization; only then do user questions reach it.
  let clientAnswersQuestions = false

  /** Return the bridge-owned record for an agent, rejecting same-id impostors. */
  const ownedRecord = (agent: Parameters<AcpSession['owns']>[0]): AcpSession | undefined => {
    const record = sessions.get(agent.session.id)
    return record?.owns(agent) === true ? record : undefined
  }

  /** The owned root record an agent reports through: itself, or the first owned ancestor along `parentSession`. */
  const reportingRecord = (agent: Agent): AcpSession | undefined => {
    let current: Agent | undefined = agent
    for (let hops = 0; current !== undefined && hops < MAX_DELEGATION_WALK; hops += 1) {
      const owned = ownedRecord(current)
      if (owned !== undefined) return owned
      const parent: SessionId | undefined = current.session.header.parentSession
      current = parent === undefined ? undefined : ctx.agents.get(parent)
    }
    return undefined
  }

  const views = new WeakMap<AcpSession, AcpSessionView>()
  /** The extension-facing view of one session record. */
  const viewOf = (record: AcpSession): AcpSessionView => {
    let view = views.get(record)
    if (view === undefined) {
      view = {
        sessionId: record.agent.session.id,
        agent: record.agent,
        get prompting() { return record.prompting },
        notify: (update, meta) => record.notifyExtension(update, meta),
        admit: (prompt, signal) => record.admitContent(prompt, imagePromptEnabled, signal),
      }
      views.set(record, view)
    }
    return view
  }

  const extensions = new AcpExtensionHost({
    session: (sessionId) => {
      const record = sessions.get(brandString<SessionId>(sessionId))
      return record === undefined ? undefined : viewOf(record)
    },
    sessionOf: (agent) => {
      const record = reportingRecord(agent)
      return record === undefined ? undefined : viewOf(record)
    },
  })
  ctx.provide('acpExtensions', new AcpExtensionRegistry(extensions))

  const assertOpen = (): void => {
    if (closed) throw internalError('the ACP bridge has been disposed')
  }

  const requireSession = (sessionId: SessionId): AcpSession => {
    const record = sessions.get(sessionId)
    if (record === undefined) throw invalidParams(`unknown session: ${sessionId}`)
    return record
  }

  /** Send one ordered protocol update while containing transport-only failure. */
  const notify = async (notification: SessionNotification): Promise<void> => {
    /* v8 ignore next -- sessions exist only after the transport connected. */
    if (conn === undefined) return
    try {
      await conn.notify(methods.client.session.update, notification)
    /* v8 ignore start -- the ACP SDK contains notification-handler failures; only a transport write failure reaches this guard. */
    } catch (error: unknown) {
      logger.warn(`acp: session/update failed: ${String(error)}`)
    }
    /* v8 ignore stop */
  }

  /**
   * Committed facts of the calls still waiting for their result, per session, for the sessions that report through an
   * owned root (the root itself and its descendants): a permission request then describes the exact call it asks
   * about. A descendant's calls never reach the client as updates, so the request is the only place they can.
   */
  const openCalls = new WeakMap<Session, Map<string, SessionEvent<'tool/call'>>>()
  const trackCall = (session: Session, event: SessionEvent): void => {
    if (event.type === 'tool/result') {
      openCalls.get(session)?.delete(event.data.message.toolCallId)
      return
    }
    if (event.type !== 'tool/call') return
    const agent = ctx.agents.get(session.header.id)
    if (agent === undefined || reportingRecord(agent) === undefined) return
    let calls = openCalls.get(session)
    if (calls === undefined) {
      calls = new Map()
      openCalls.set(session, calls)
    }
    calls.set(event.data.callId, event)
  }

  ctx.on('session/event', (session, event) => {
    trackCall(session, event)
    const record = sessions.get(session.header.id)
    if (record?.ownsSession(session) === true) record.onSessionEvent(session, event)
  })

  ctx.on('agent/inbox/claimed', ({ agent, message, turn }) => {
    ownedRecord(agent)?.onInboxClaimed(message, turn)
  })

  ctx.on('agent/error', ({ agent, error }) => {
    ownedRecord(agent)?.onAgentError(error)
  })

  ctx.on('agent/status', ({ agent, status }) => {
    ownedRecord(agent)?.onAgentStatus(status)
  })

  ctx.on('llm/adapters-updated', () => {
    for (const record of sessions.values()) record.topologyChanged()
  })

  // Permission requests are a machine policy channel for ACP clients such as
  // liwa-subagent-acp. The bridge offers one-shot choices only and never infers a
  // durable grant from an unknown client response.
  // A descendant's request (a subagent of the session's root) reports through the root's
  // session, the only one the client knows; extensions may annotate where it came from.
  // The request describes the call it asks about (tool, raw input, the asker's reason), so
  // a client can decide a descendant's call it never saw as an update.
  ctx.on('approval/request', (request, next) => {
    const record = reportingRecord(request.agent)
    const client = conn
    if (record === undefined || request.callId === undefined || client === undefined) return next()
    const callId = request.callId
    return record.drainUpdates().then(() => {
      const params: RequestPermissionRequest = {
        sessionId: record.agent.session.id,
        toolCall: approvalToolCall(callId, request.toolName, request.reason, openCalls.get(request.agent.session)?.get(callId)),
        options: [
          { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
        ],
      }
      return client.request(
        methods.client.session.requestPermission,
        extensions.permissionRequest(viewOf(record), request.agent, request, params),
      )
    }).then(({ outcome }) => {
      if (outcome.outcome === 'cancelled') return 'cancelled'
      return outcome.optionId === 'allow-once' ? 'allowed-once' : 'rejected'
    })
  })

  // The agent's questions (`ask_user_question`, plan review) reach a client that advertised form
  // elicitation as `elicitation/create`; without one they go to the next answerer. Only a session's
  // root agent may ask (the user-questions service enforces it), so only owned roots are answered here.
  ctx.on('user-questions/request', async (request, next) => {
    const agent = request.agent
    const record = agent === undefined ? undefined : ownedRecord(agent)
    const client = conn
    if (!clientAnswersQuestions || record === undefined || client === undefined) return next()
    await record.drainUpdates()
    request.signal?.throwIfAborted()
    const asked = client.request(methods.client.elicitation.create, {
      sessionId: record.agent.session.id,
      ...(request.wait === undefined ? {} : { toolCallId: request.wait.callId }),
      mode: 'form',
      message: request.questions.map(item => item.question).join('\n'),
      requestedSchema: questionSchema(request.questions),
    })
    const signal = request.signal
    const response = signal === undefined ? await asked : await new Promise<Awaited<typeof asked>>((resolve, reject) => {
      const onAbort = (): void => { reject(new UserQuestionError('the question was withdrawn before the client answered', 'ASK_ABORTED')) }
      signal.addEventListener('abort', onAbort, { once: true })
      asked.then(resolve, reject).finally(() => { signal.removeEventListener('abort', onAbort) })
    })
    if (response.action !== 'accept') throw new UserQuestionError(`the client ${response.action === 'decline' ? 'declined' : 'dismissed'} the question`, 'ASK_CANCELLED')
    return answerFromContent(request.questions, metaOf('content' in response ? response.content : undefined) ?? {})
  })

  const implementation = {
    async initialize(params: InitializeRequest): Promise<InitializeResponse> {
      const form = params.clientCapabilities?.elicitation?.form
      clientAnswersQuestions = form !== undefined && form !== null
      // Single-version agent: the spec's "same version if supported, else
      // the latest supported" both resolve to this server's one version.
      imagePromptEnabled = await supportsAcpImagePrompts(ctx, config.provider, config.model)
      return {
        protocolVersion: PROTOCOL_VERSION,
        agentInfo: { name: 'liwa-acp', version: '0.0.1' },
        agentCapabilities: {
          mcpCapabilities: { http: true },
          promptCapabilities: { image: imagePromptEnabled, audio: false, embeddedContext: false },
          sessionCapabilities: { close: {}, list: {}, resume: {} },
        },
        authMethods: [],
      }
    },

    authenticate(_params: AuthenticateRequest): Promise<void> {
      return Promise.resolve()
    },

    async newSession(params: NewSessionRequest, signal: AbortSignal): Promise<NewSessionResponse> {
      assertOpen()
      validateWorkspaceParams(params)
      const sessionId = brandString<SessionId>(randomUUID())
      // No preset composition: the ACP bundle keeps the model-facing rows in
      // the host plane, so this agent reads them from the global layer. A
      // deployment that configures a roster has to join one here first
      // (@liwa/agent-preset-registry README, "Composing a child agent").
      let record: AcpSession
      try {
        record = await AcpSession.create(ctx, {
          sessionId,
          cwd: params.cwd,
          mcpServers: params.mcpServers,
          agentOptions: agentOptions(config),
          signal,
          notify,
          extend: agentCtx => extensions.setupSession({ agentCtx, sessionId, meta: metaOf(params._meta), resumed: false }),
        })
      } catch (error: unknown) {
        if (error instanceof AcpMcpConfigError) throw invalidParams(error.message)
        throw error
      }
      /* v8 ignore next 4 -- a real stdio close can race an in-flight create. */
      if (closed) {
        await record.close('connection closed during session/new')
        throw internalError('connection closed during session/new')
      }
      sessions.set(sessionId, record)
      try {
        const configOptions = await record.configOptions(signal)
        assertOpen()
        // The attached log writer's flush materializes an empty session durably.
        await ctx.sessions.flush(record.agent.session)
        assertOpen()
        const modes = sessionModeState(ctx, record.agent)
        return { sessionId, configOptions, ...(modes === undefined ? {} : { modes }) }
      } catch (error: unknown) {
        sessions.delete(sessionId)
        await record.close('session/new activation failed')
        throw error
      }
    },

    async resumeSession(params: ResumeSessionRequest, signal: AbortSignal): Promise<ResumeSessionResponse> {
      assertOpen()
      validateWorkspaceParams(params)
      const sessionId = brandString<SessionId>(params.sessionId)
      if (sessions.has(sessionId) || activating.has(sessionId) || ctx.sessions.get(sessionId) !== undefined) {
        throw invalidParams(`session is already active: ${sessionId}`)
      }
      activating.add(sessionId)
      return (async (): Promise<ResumeSessionResponse> => {
        const persisted = (await persistence.stat(sessionId, { signal }))?.header
        if (persisted === undefined || persisted.origin === 'subagent') {
          throw invalidParams(`session is not resumable: ${sessionId}`)
        }
        if (!await sameDirectory(persisted.cwd, params.cwd)) {
          throw invalidParams(`session cwd does not match: ${params.cwd}`)
        }
        let record: AcpSession
        try {
          record = await AcpSession.resume(ctx, {
            sessionId,
            cwd: params.cwd,
            mcpServers: params.mcpServers ?? [],
            agentOptions: agentOptions(config),
            signal,
            notify,
            extend: agentCtx => extensions.setupSession({ agentCtx, sessionId, meta: metaOf(params._meta), resumed: true }),
          })
        } catch (error: unknown) {
          if (error instanceof AcpMcpConfigError) throw invalidParams(error.message)
          throw error
        }
        /* v8 ignore start -- the persisted header was checked before resume; the factory restores that exact header. */
        if (!await sameDirectory(record.agent.session.header.cwd, params.cwd)) {
          await record.close('session/resume cwd mismatch')
          throw invalidParams(`session cwd does not match: ${params.cwd}`)
        }
        /* v8 ignore stop */
        /* v8 ignore next 4 -- a real stdio close can race an in-flight resume. */
        if (closed) {
          await record.close('connection closed during session/resume')
          throw internalError('connection closed during session/resume')
        }
        sessions.set(sessionId, record)
        try {
          const configOptions = await record.configOptions(signal)
          const modes = sessionModeState(ctx, record.agent)
          return { configOptions, ...(modes === undefined ? {} : { modes }) }
        } catch (error: unknown) {
          sessions.delete(sessionId)
          await record.close('session/resume option discovery failed')
          throw error
        }
      })().finally(() => { activating.delete(sessionId) })
    },

    async listSessions(params: ListSessionsRequest, signal: AbortSignal): Promise<ListSessionsResponse> {
      assertOpen()
      if (params.cwd !== undefined && params.cwd !== null && !isAbsolute(params.cwd)) {
        throw invalidParams(`cwd must be an absolute path: ${params.cwd}`)
      }
      let cursor: SessionListCursor | undefined
      try {
        cursor = decodeSessionListCursor(params.cursor)
      } catch (error: unknown) {
        throw invalidParams((error as Error).message)
      }
      const listed = await persistence.list({ signal })
      const filtered = await Promise.all(listed.map(async ({ header }) => {
        if (
          sessions.has(header.id)
            || activating.has(header.id)
            || ctx.sessions.get(header.id) !== undefined
            || header.origin === 'subagent'
            || header.cwd === undefined
            || !isAbsolute(header.cwd)
        ) return undefined
        if (params.cwd !== undefined && params.cwd !== null && !await sameDirectory(header.cwd, params.cwd)) {
          return undefined
        }
        return { sessionId: header.id, cwd: header.cwd, createdAt: header.createdAt }
      }))
      const entries = filtered
        .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
        .sort((left, right) => right.createdAt - left.createdAt || compareSessionIds(left.sessionId, right.sessionId))
      const remaining = cursor === undefined
        ? entries
        : entries.filter(entry => isAfterSessionListCursor(entry, cursor))
      const page = remaining.slice(0, sessionListPageSize)
      const next = remaining.length > page.length ? page.at(-1) : undefined
      return {
        sessions: page.map(({ sessionId, cwd }) => ({ sessionId, cwd })),
        ...next === undefined ? {} : { nextCursor: encodeSessionListCursor(next) },
      }
    },

    async setSessionConfigOption(
      params: SetSessionConfigOptionRequest,
      signal: AbortSignal,
    ): Promise<SetSessionConfigOptionResponse> {
      assertOpen()
      const record = requireSession(brandString<SessionId>(params.sessionId))
      try {
        return { configOptions: await record.setConfig(params.configId, params.value, signal) }
      } catch (error: unknown) {
        if (error instanceof AcpModelConfigError) throw invalidParams(error.message)
        throw error
      }
    },

    setSessionMode(params: SetSessionModeRequest): Promise<SetSessionModeResponse> {
      assertOpen()
      const record = requireSession(brandString<SessionId>(params.sessionId))
      try {
        // Between turns the switch is logged now; during a turn it applies at the next step, and the
        // session sends current_mode_update once the selection is logged.
        setSessionMode(ctx, record.agent, params.modeId)
      } catch (error: unknown) {
        if (error instanceof AcpModeError) return Promise.reject(invalidParams(error.message))
        throw error
      }
      return Promise.resolve({})
    },

    async closeSession(params: CloseSessionRequest): Promise<CloseSessionResponse> {
      assertOpen()
      const sessionId = brandString<SessionId>(params.sessionId)
      const record = requireSession(sessionId)
      try {
        await record.close('ACP session closed')
      } catch (error: unknown) {
        throw internalError(`session close failed: ${errorChain(error)}`)
      } finally {
        if (sessions.get(sessionId) === record) sessions.delete(sessionId)
      }
      return {}
    },

    async prompt(params: PromptRequest, requestSignal: AbortSignal): Promise<PromptResponse> {
      assertOpen()
      const record = requireSession(brandString<SessionId>(params.sessionId))
      const response = await record.prompt(params, imagePromptEnabled, requestSignal)
      return extensions.promptResponse(viewOf(record), response)
    },

    cancel(params: CancelNotification): Promise<void> {
      const record = sessions.get(brandString<SessionId>(params.sessionId))
      record?.cancel(extensions.cancelOptions(viewOf(record), metaOf(params._meta)))
      return Promise.resolve()
    },
  }

  /* v8 ignore next 4 -- production stdio wiring; tests inject config.stream. */
  const stream: Stream = config.stream ?? ndJsonStream(
    Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
    Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>,
  )
  const app = createAcpAgentApp({ name: 'liwa-acp' })
    .onRequest(methods.agent.initialize, ({ params }) => implementation.initialize(params))
    .onRequest(methods.agent.authenticate, async ({ params }) => {
      await implementation.authenticate(params)
      return {}
    })
    .onRequest(methods.agent.session.new, ({ params, signal }) => implementation.newSession(params, signal))
    .onRequest(methods.agent.session.list, ({ params, signal }) => implementation.listSessions(params, signal))
    .onRequest(methods.agent.session.resume, ({ params, signal }) => implementation.resumeSession(params, signal))
    .onRequest(methods.agent.session.close, ({ params }) => implementation.closeSession(params))
    .onRequest(methods.agent.session.setConfigOption, ({ params, signal }) => implementation.setSessionConfigOption(params, signal))
    .onRequest(methods.agent.session.setMode, ({ params }) => implementation.setSessionMode(params))
    .onRequest(methods.agent.session.prompt, ({ params, signal }) => implementation.prompt(params, signal))
    .onNotification(methods.agent.session.cancel, ({ params }) => implementation.cancel(params))

  // Extension methods must be on the app before it connects, so the transport connects once
  // the launcher reports the whole profile mounted (every extension plugin has registered).
  // Without a launcher (direct mounting in tests) it connects immediately.
  let connection: ReturnType<typeof app.connect> | undefined
  let conn: AgentContext | undefined
  const connect = (): void => {
    if (closed || connection !== undefined) return
    for (const [method, handler] of extensions.seal()) {
      app.onRequest(method, (raw: unknown) => metaOf(raw) ?? {}, ({ params, signal }) => {
        assertOpen()
        return handler(params, { signal, session: sessionId => extensions.lookup.session(sessionId) })
      })
    }
    connection = app.connect(stream)
    conn = connection.client
    /* v8 ignore start -- production transport rejection and teardown failure. */
    void connection.closed
      .catch((error: unknown) => {
        logger.warn(`acp: connection closed with an error: ${String(error)}`)
      })
      .then(quiesce)
      .catch((error: unknown) => {
        logger.warn(`acp: connection-close teardown failed: ${String(error)}`)
      })
    /* v8 ignore stop */
  }

  let quiescing: Promise<void> | undefined
  const quiesce = (): Promise<void> => {
    if (quiescing !== undefined) return quiescing
    closed = true
    const records = [...sessions.values()]
    // AcpSession.close cancels synchronously before its first await, so every owned
    // prompt stops before any descendant or persistence drain can block.
    quiescing = (async () => {
      const disposals = await Promise.allSettled(records.map(record => record.close('ACP bridge disposed')))
      for (const record of records) {
        /* v8 ignore next -- closed blocks concurrent handlers; each captured record remains mapped until this loop. */
        if (sessions.get(record.agent.session.id) === record) sessions.delete(record.agent.session.id)
      }
      const failures: unknown[] = []
      for (const result of disposals) {
        if (result.status === 'rejected') failures.push(result.reason as unknown)
      }
      if (failures.length > 0) {
        // The production consumer logs this AggregateError through `String`,
        // which renders only its message. Embed every per-session diagnostic,
        // including nested causes and aggregate members, in that message.
        const detail = failures.map(failure => errorChain(failure)).join('; ')
        throw new AggregateError(
          failures,
          `ACP agent teardown failed for ${failures.length} session(s): ${detail}`,
        )
      }
    })()
    return quiescing
  }

  ctx.effect(() => quiesce, 'acp.connection')

  const ready = ctx.get('appReady')
  if (ready === undefined) connect()
  else ctx.effect(() => ready.onReady(connect), 'acp.connect-when-ready')
}

/**
 * Build per-agent options from plugin config without assigning absent optional fields.
 * @param config - ACP provider/model configuration.
 * @returns the configured fields only.
 */
function agentOptions(config: AcpConfig): { provider?: string; model?: string } {
  return {
    ...config.provider !== undefined ? { provider: config.provider } : {},
    ...config.model !== undefined ? { model: config.model } : {},
  }
}

interface SessionListCursor {
  createdAt: number
  sessionId: string
}

/** Resolve and validate the deployment-owned session page limit. */
function resolveSessionListPageSize(value: number | undefined): number {
  const resolved = value ?? DEFAULT_SESSION_LIST_PAGE_SIZE
  /* v8 ignore start -- Cordis applies the positive-integer Config schema; this protects direct apply callers. */
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new Error('acp: sessionListPageSize must be a positive safe integer')
  }
  /* v8 ignore stop */
  return resolved
}

/** Decode an opaque keyset cursor without assigning meaning to client metadata. */
function decodeSessionListCursor(value: string | null | undefined): SessionListCursor | undefined {
  if (value === undefined || value === null) return undefined
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('session/list cursor is invalid')
  try {
    const decoded: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    const createdAt: unknown = Array.isArray(decoded) ? decoded[0] : undefined
    const sessionId: unknown = Array.isArray(decoded) ? decoded[1] : undefined
    if (
      !Array.isArray(decoded)
      || decoded.length !== 2
      || typeof createdAt !== 'number'
      || !Number.isSafeInteger(createdAt)
      || createdAt < 0
      || typeof sessionId !== 'string'
      || sessionId.length === 0
    ) throw new Error('invalid cursor fields')
    const canonical = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url')
    if (canonical !== value) throw new Error('non-canonical cursor')
    return { createdAt, sessionId }
  } catch (_invalidCursor) {
    throw new Error('session/list cursor is invalid')
  }
}

/** Encode the last returned ordering key as an opaque continuation token. */
function encodeSessionListCursor(entry: SessionListCursor): string {
  return Buffer.from(JSON.stringify([entry.createdAt, entry.sessionId]), 'utf8').toString('base64url')
}

/** Test whether an entry follows the cursor in newest-first list order. */
function isAfterSessionListCursor(entry: SessionListCursor, cursor: SessionListCursor): boolean {
  return entry.createdAt < cursor.createdAt
    || (entry.createdAt === cursor.createdAt && compareSessionIds(entry.sessionId, cursor.sessionId) > 0)
}

/** Compare opaque session ids by stable UTF-8 bytes, independent of process locale. */
function compareSessionIds(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

/** Reject workspace features outside the automation contract. */
function validateWorkspaceParams(params: { cwd: string; additionalDirectories?: string[] | null }): void {
  if (!isAbsolute(params.cwd)) throw invalidParams(`cwd must be an absolute path: ${params.cwd}`)
  if (
    params.additionalDirectories !== undefined
    && params.additionalDirectories !== null
    && params.additionalDirectories.length > 0
  ) {
    throw invalidParams('additionalDirectories is not supported')
  }
}

/** Compare existing directories by physical identity and missing paths lexically. */
async function sameDirectory(left: string | undefined, right: string): Promise<boolean> {
  if (left === undefined) return false
  try {
    const [realLeft, realRight] = await Promise.all([realpath(left), realpath(right)])
    return realLeft === realRight
  } catch (_unresolvablePath) {
    return resolve(left) === resolve(right)
  }
}
