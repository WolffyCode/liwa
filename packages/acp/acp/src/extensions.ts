/**
 * ACP 服务器的扩展口：别的插件经 `ctx.acpExtensions.register()` 给标准 ACP 加 `_` 前缀的扩展方法，并在
 * 会话组装、提示词返回、权限请求、取消这几处读写 `_meta`。服务器自己不认识任何扩展；没有扩展时它仍是
 * 标准 ACP v1。扩展必须在传输连上之前登记（服务器在 loader 装好整棵树之后才连 stdio）。
 * @module @liwa/acp/extensions
 */

import type { Context } from '@liwa/cordis'
import type { ContentBlock as AcpContentBlock, PromptResponse, RequestPermissionRequest, SessionUpdate } from '@agentclientprotocol/sdk'
import type { ContentBlock } from '@liwa/llm'
import type { Agent, CancelOptions } from '@liwa/agent'
import type { SessionId } from '@liwa/session'
import type { ApprovalRequestEvent } from '@liwa/user-approval/types'

/** 扩展看到的一个 ACP 会话。 */
export interface AcpSessionView {
  /** ACP 会话号（也是灵鲸会话号）。 */
  readonly sessionId: SessionId
  /** 这个会话的根 Agent。 */
  readonly agent: Agent
  /** 是否有进行中的 `session/prompt`。 */
  readonly prompting: boolean
  /**
   * 按本会话的输出顺序发一条 `session/update`。
   * @param update - 标准的会话更新。
   * @param meta - 附在通知上的 `_meta`。
   * @returns 交给传输后完成。
   */
  notify(update: SessionUpdate, meta?: Record<string, unknown>): Promise<void>
  /**
   * 把 ACP 内容块按 `session/prompt` 的同一规则收成会话内容（图片校验后存进附件存储，只在连接声明了图片输入时收）。
   * @param prompt - ACP 内容块。
   * @param signal - 取消。
   * @returns 会话内容块。
   * @throws 内容不合规（图片格式、未声明图片输入等）。
   */
  admit(prompt: readonly AcpContentBlock[], signal: AbortSignal): Promise<ContentBlock[]>
}

/** 扩展方法拿到的上下文。 */
export interface AcpExtensionMethodContext {
  /** 请求的取消信号。 */
  readonly signal: AbortSignal
  /**
   * 按会话号找一个开着的会话。
   * @param sessionId - 会话号。
   * @returns 会话；没有时为 `undefined`。
   */
  session(sessionId: string): AcpSessionView | undefined
}

/**
 * 一个扩展方法（`_` 前缀的 JSON-RPC 请求）。
 * @param params - 请求参数（JSON 对象）。
 * @param context - 取消信号与会话查找。
 * @returns 结果（JSON 对象）。
 */
export type AcpExtensionMethod = (params: Record<string, unknown>, context: AcpExtensionMethodContext) => Promise<Record<string, unknown>>

/** 会话组装时交给扩展的东西（发布之前，在 Agent 作用域里）。 */
export interface AcpSessionSetup {
  /** 还没发布的 Agent 作用域。 */
  readonly agentCtx: Context
  /** ACP 会话号。 */
  readonly sessionId: SessionId
  /** `session/new` 或 `session/resume` 带来的 `_meta`。 */
  readonly meta: Record<string, unknown> | undefined
  /** 是不是续接。 */
  readonly resumed: boolean
}

/** 一个 ACP 扩展。每个钩子都可选；装饰类钩子按登记顺序依次作用。 */
export interface AcpExtension {
  /** 扩展名（诊断用）。 */
  readonly name: string
  /** 扩展方法，名字必须以 `_` 开头。 */
  readonly methods?: Readonly<Record<string, AcpExtensionMethod>>
  /**
   * 会话组装（MCP 挂好之后、Agent 发布之前）；抛错则 `session/new` 或 `session/resume` 失败。
   * @param setup - Agent 作用域、会话号、`_meta`、是否续接。
   */
  setupSession?(setup: AcpSessionSetup): Promise<void> | void
  /**
   * 改写一次 `session/prompt` 的返回（例如加 `_meta`）。
   * @param session - 会话。
   * @param response - 当前的返回。
   * @returns 改写后的返回。
   */
  promptResponse?(session: AcpSessionView, response: PromptResponse): PromptResponse
  /**
   * 改写一次 `session/request_permission`（例如加 `_meta`、补工具名）。`agent` 可以是根 Agent 的后代。
   * @param session - 请求经它上报的会话。
   * @param agent - 发起请求的 Agent。
   * @param approval - 原始的批准请求。
   * @param request - 当前的权限请求。
   * @returns 改写后的权限请求。
   */
  permissionRequest?(
    session: AcpSessionView, agent: Agent, approval: ApprovalRequestEvent, request: RequestPermissionRequest,
  ): RequestPermissionRequest
  /**
   * `session/cancel` 用的取消选项（例如保留没读走的输入）。
   * @param session - 会话。
   * @param meta - 取消通知带来的 `_meta`。
   * @returns 取消选项；不管时返回 `undefined`。
   */
  cancelOptions?(session: AcpSessionView, meta: Record<string, unknown> | undefined): CancelOptions | undefined
}

/** 服务器给登记表的会话查找。 */
export interface AcpSessionLookup {
  /**
   * 按会话号找会话。
   * @param sessionId - 会话号。
   * @returns 会话；没有时为 `undefined`。
   */
  session(sessionId: string): AcpSessionView | undefined
  /**
   * 一个 Agent 归哪个会话上报：它自己是根，或沿 `parentSession` 往上找到的根。
   * @param agent - Agent（可以是后代）。
   * @returns 会话；不属于任何开着的会话时为 `undefined`。
   */
  sessionOf(agent: Agent): AcpSessionView | undefined
}

/** `ctx.acpExtensions`：ACP 扩展的登记表（扩展插件看到的那一面）。 */
export class AcpExtensionRegistry {
  /**
   * @param host - 服务器持有的扩展宿主。
   */
  constructor(private readonly host: AcpExtensionHost) {}

  /**
   * 登记一个扩展，直到返回的函数被调用。
   * @param extension - 扩展。
   * @returns 释放函数。
   * @throws 传输已连上（扩展方法只能在连上之前加），或方法名不以 `_` 开头、与已登记的重名。
   */
  register(extension: AcpExtension): () => void {
    return this.host.register(extension)
  }

  /**
   * 按会话号找会话（给扩展方法用）。
   * @param sessionId - 会话号。
   * @returns 会话；没有时为 `undefined`。
   */
  session(sessionId: string): AcpSessionView | undefined {
    return this.host.lookup.session(sessionId)
  }

  /**
   * 一个 Agent 归哪个会话上报。
   * @param agent - Agent（可以是后代）。
   * @returns 会话；不属于任何开着的会话时为 `undefined`。
   */
  sessionOf(agent: Agent): AcpSessionView | undefined {
    return this.host.lookup.sessionOf(agent)
  }
}

/** 服务器一侧的扩展宿主：持有登记的扩展，在连接、会话组装、返回、权限、取消这几处调用它们。 */
export class AcpExtensionHost {
  private readonly extensions: AcpExtension[] = []
  private connected = false

  /**
   * @param lookup - 服务器的会话查找。
   */
  constructor(readonly lookup: AcpSessionLookup) {}

  /**
   * 登记一个扩展，直到返回的函数被调用。
   * @param extension - 扩展。
   * @returns 释放函数。
   * @throws 传输已连上，或方法名不以 `_` 开头、与已登记的重名。
   */
  register(extension: AcpExtension): () => void {
    if (this.connected) {
      throw new Error(`acp: extension ${extension.name} registered after the transport connected; register ACP extensions while the profile loads`)
    }
    for (const method of Object.keys(extension.methods ?? {})) {
      if (!method.startsWith('_')) throw new Error(`acp: extension method ${method} of ${extension.name} must start with "_"`)
      if (this.extensions.some(other => other.methods?.[method] !== undefined)) {
        throw new Error(`acp: extension method ${method} is already registered`)
      }
    }
    this.extensions.push(extension)
    return () => {
      const index = this.extensions.indexOf(extension)
      if (index >= 0) this.extensions.splice(index, 1)
    }
  }

  /**
   * 连上传输之前取出全部扩展方法，此后不再接受登记。
   * @returns 方法名到处理器。
   */
  seal(): ReadonlyMap<string, AcpExtensionMethod> {
    this.connected = true
    const methods = new Map<string, AcpExtensionMethod>()
    for (const extension of this.extensions) {
      for (const [method, handler] of Object.entries(extension.methods ?? {})) methods.set(method, handler)
    }
    return methods
  }

  /**
   * 依次运行会话组装钩子。
   * @param setup - 组装上下文。
   */
  async setupSession(setup: AcpSessionSetup): Promise<void> {
    for (const extension of [...this.extensions]) await extension.setupSession?.(setup)
  }

  /**
   * 依次改写提示词返回。
   * @param session - 会话。
   * @param response - 原始返回。
   * @returns 改写后的返回。
   */
  promptResponse(session: AcpSessionView, response: PromptResponse): PromptResponse {
    return this.extensions.reduce((current, extension) => extension.promptResponse?.(session, current) ?? current, response)
  }

  /**
   * 依次改写权限请求。
   * @param session - 会话。
   * @param agent - 发起请求的 Agent。
   * @param approval - 原始的批准请求。
   * @param request - 原始权限请求。
   * @returns 改写后的权限请求。
   */
  permissionRequest(
    session: AcpSessionView, agent: Agent, approval: ApprovalRequestEvent, request: RequestPermissionRequest,
  ): RequestPermissionRequest {
    return this.extensions.reduce(
      (current, extension) => extension.permissionRequest?.(session, agent, approval, current) ?? current,
      request,
    )
  }

  /**
   * 取消选项：第一个给出选项的扩展说了算。
   * @param session - 会话。
   * @param meta - 取消通知的 `_meta`。
   * @returns 取消选项；没有扩展管时为 `undefined`。
   */
  cancelOptions(session: AcpSessionView, meta: Record<string, unknown> | undefined): CancelOptions | undefined {
    for (const extension of this.extensions) {
      const options = extension.cancelOptions?.(session, meta)
      if (options !== undefined) return options
    }
    return undefined
  }
}
