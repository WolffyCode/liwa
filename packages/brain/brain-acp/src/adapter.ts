/**
 * 迁来的 Paseo ACP 客户端（`src/paseo/`）到 `brain.provider` 契约的类型映射：契约会话配置 → Paseo 会话配置、
 * 启动上下文 → Paseo 启动上下文、Paseo 会话 → 契约会话（ACP 的权限选项按原生种类翻），以及把任何
 * `ACPAgentClient` 包成一个提供方的 {@link AcpBrainProvider}。事件翻译本身在 `@liwa/brain-shared` 的
 * `PaseoBrainSession`，三家共用。
 * @module @liwa/brain-acp/adapter
 */

import type { PermissionOption as AcpPermissionOption } from '@agentclientprotocol/sdk'
import {
  BrainError, execProviderCommand, memberMcpServers, mergeLaunchEnv,
  type BrainLaunchContext, type BrainProbeContext, type BrainProbeResult, type BrainProvider, type BrainProviderSession,
  type BrainSessionHome, type CancelOptions, type ImplId, type McpServer, type Meta, type PermissionAnswer, type PermissionOption,
  type PermissionQuestion, type ResumeHandle, type SessionConfig, type TurnId,
} from '@liwa/brain'
import { PaseoBrainSession, type PaseoBrainSessionInit } from '@liwa/brain-shared'
import type {
  AgentLaunchContext, AgentMetadata, AgentPermissionRequest, AgentPermissionResponse, AgentSession, AgentSessionConfig,
  McpServerConfig,
} from '@liwa/brain-shared/paseo/agent/agent-sdk-types'
import { elicitationAnswerInput, elicitationQuestions, isElicitationRequest } from './elicitation.ts'
import type { ACPAgentClient } from './paseo/agent/providers/acp-agent.ts'

/**
 * 契约会话配置 → Paseo 会话配置。MCP 服务器是 toolport 端点（有的话）加调用方直接给的；模型只在给了且
 * 允许经标准 ACP 切换时带上（省略即 CLI 自己的默认模型）；起始模式交给 Paseo 在会话开好后经标准 ACP 切换。
 * @param provider - Paseo 的提供方名（客户端会核对）。
 * @param config - 契约会话配置。
 * @param passModel - 是否经 Paseo（`session/set_config_option`）设模型。
 * @returns Paseo 会话配置。
 */
export function toPaseoSessionConfig(provider: string, config: SessionConfig, passModel: boolean): AgentSessionConfig {
  return {
    provider,
    cwd: config.cwd,
    ...(passModel && config.model !== undefined ? { model: config.model } : {}),
    ...(config.modeId === undefined ? {} : { modeId: config.modeId }),
    mcpServers: toPaseoMcpServers(memberMcpServers(config)),
  }
}

/**
 * 契约的 MCP 服务器表 → Paseo 形状（省略未给的可选项）。
 * @param servers - 契约 MCP 服务器表。
 * @returns Paseo 的 MCP 服务器表。
 */
export function toPaseoMcpServers(servers: Record<string, McpServer>): Record<string, McpServerConfig> {
  const result: Record<string, McpServerConfig> = {}
  for (const [name, server] of Object.entries(servers)) {
    switch (server.type) {
      case 'stdio':
        result[name] = {
          type: 'stdio',
          command: server.command,
          ...(server.args === undefined ? {} : { args: server.args }),
          ...(server.env === undefined ? {} : { env: server.env }),
          ...(server.alwaysLoad === undefined ? {} : { alwaysLoad: server.alwaysLoad }),
        }
        break
      case 'http':
      case 'sse':
        result[name] = {
          type: server.type,
          url: server.url,
          ...(server.headers === undefined ? {} : { headers: server.headers }),
          ...(server.alwaysLoad === undefined ? {} : { alwaysLoad: server.alwaysLoad }),
        }
        break
    }
  }
  return result
}

/**
 * 契约启动上下文 → Paseo 启动上下文：会话号作 agent id，进程一律经启动上下文（brains 先登记归属）。
 * @param launch - 契约启动上下文。
 * @param env - 这个会话的 CLI 额外要的环境项（显式注入，越过 subprocess 的剥离）。
 * @returns Paseo 启动上下文。
 */
export function toPaseoLaunchContext(launch: BrainLaunchContext, env?: Record<string, string>): AgentLaunchContext {
  return {
    agentId: launch.sessionId,
    processHost: launch,
    ...(env === undefined || Object.keys(env).length === 0 ? {} : { env }),
  }
}

/** ACP 权限选项种类 → 契约效果；永久类（`*_always`）不进第一版可见选项，除非原生请求只给了永久类。 */
const ONCE_EFFECT: Readonly<Record<AcpPermissionOption['kind'], PermissionOption['effect'] | undefined>> = {
  allow_once: 'allow_once',
  reject_once: 'deny_once',
  allow_always: undefined,
  reject_always: undefined,
}

/**
 * 原生权限请求里的 ACP 选项（Paseo 放在 `metadata.options`）。
 * @param request - Paseo 权限请求。
 * @returns ACP 选项；不是 ACP 请求时为空。
 */
function acpOptions(request: AgentPermissionRequest): AcpPermissionOption[] {
  const options = request.metadata?.['options']
  return Array.isArray(options) ? options.filter((option): option is AcpPermissionOption =>
    typeof option === 'object' && option !== null && 'optionId' in option && 'kind' in option) : []
}

/** ACP CLI 的契约会话：权限选项按 ACP 原生种类翻；问答是表单式 elicitation；取消等回合真正收尾。 */
export class AcpBrainSession extends PaseoBrainSession {
  /**
   * 表单式 elicitation 的问题从表单读（{@link elicitationQuestions}）。
   * @param request - Paseo 问答请求。
   * @returns 契约问题。
   */
  protected override permissionQuestions(request: AgentPermissionRequest): PermissionQuestion[] {
    return isElicitationRequest(request) ? elicitationQuestions(request) : super.permissionQuestions(request)
  }

  /**
   * 表单式 elicitation 的答案按结构填成表单内容（{@link elicitationAnswerInput}）：选项进问题字段，补充文字进它的
   * "其他"字段，装不下的以 `invalid_input` 拒绝。
   * @param request - Paseo 问答请求。
   * @param questions - 契约问题。
   * @param answers - 已核对的契约答案。
   * @returns 交给 Paseo 的 `updatedInput`。
   */
  protected override permissionAnswerInput(
    request: AgentPermissionRequest,
    questions: readonly PermissionQuestion[],
    answers: Readonly<Record<string, PermissionAnswer>>,
  ): AgentMetadata {
    if (isElicitationRequest(request)) return elicitationAnswerInput(request, answers)
    return super.permissionAnswerInput(request, questions, answers)
  }

  /**
   * ACP 的 `session/cancel` 是通知，Paseo 的 `interrupt()` 发出即返回，并不说明回合已停；等调用时在跑的那个回合的
   * `session/prompt` 带着 `cancelled` 返回（或 CLI 退出、会话关闭），"此前的回合不会再跑"才成立。
   * @param options - 取消原因与是否保留队列。
   * @param captured - 调用时在跑的回合。
   */
  protected override async interruptTurn(options: CancelOptions, captured: TurnId | undefined): Promise<void> {
    const ended = captured === undefined ? undefined : this.whenTurnEnds(captured)
    await super.interruptTurn(options, captured)
    if (ended !== undefined) await ended
  }

  /** @inheritdoc */
  protected override permissionOptions(request: AgentPermissionRequest): { option: PermissionOption; response: AgentPermissionResponse }[] {
    const native = acpOptions(request)
    if (native.length === 0) return super.permissionOptions(request)
    const pick = (effect: (option: AcpPermissionOption) => PermissionOption['effect'] | undefined): { option: PermissionOption; response: AgentPermissionResponse }[] =>
      native.flatMap((option) => {
        const mapped = effect(option)
        if (mapped === undefined) return []
        const response: AgentPermissionResponse = option.kind.startsWith('allow')
          ? { behavior: 'allow', selectedActionId: option.optionId }
          : { behavior: 'deny', selectedActionId: option.optionId }
        return [{ option: { id: option.optionId, label: option.name, effect: mapped }, response }]
      })
    const once = pick(option => ONCE_EFFECT[option.kind])
    const hasAllow = once.some(entry => entry.option.effect === 'allow_once')
    // 原生请求只给了永久允许时照实给出 allow_always，不编造一次性允许。
    const always = hasAllow ? [] : pick(option => (option.kind === 'allow_always' ? 'allow_always' : undefined))
    return [...once, ...always]
  }
}

/** {@link AcpBrainProvider} 的构造项。 */
export interface AcpBrainProviderInit {
  /** 实现名。 */
  impl: ImplId
  /** 能力声明。 */
  meta: Meta
  /** 迁来的 Paseo ACP 客户端（通用或某个厂商 shim）。 */
  client: ACPAgentClient
  /** 读版本的命令（argv）；省略时不报版本。 */
  versionCommand?: readonly [string, ...string[]]
  /** 会话 home 的布局，默认 `per-member`。 */
  sessionHome?: BrainSessionHome
  /**
   * 这家 CLI 会不会把 MCP 工具放到工具搜索之后延迟加载。不知道（通用 ACP 的默认）就按会，`alwaysLoad: true` 的
   * 服务器在开会话时被拒；确知不延迟的给 `false`。
   */
  defersMcpTools?: boolean
}

/**
 * 把一个 Paseo `ACPAgentClient` 包成 `brain.provider`。子类覆写 {@link sessionConfig}、{@link launchContext}、
 * {@link wrap} 改变它交给客户端的配置或包会话的方式（例如 `_meta` 扩展）。
 */
export class AcpBrainProvider implements BrainProvider {
  /** 实现名。 */
  readonly impl: ImplId
  /** 能力声明。 */
  readonly meta: Meta
  /** 会话 home 的布局。 */
  readonly sessionHome: BrainSessionHome
  /** 迁来的 Paseo 客户端。 */
  protected readonly client: ACPAgentClient
  private readonly versionCommand: readonly [string, ...string[]] | undefined
  private readonly defersMcpTools: boolean

  /**
   * @param init - 实现名、能力声明、Paseo 客户端、读版本的命令。
   */
  constructor(init: AcpBrainProviderInit) {
    this.impl = init.impl
    this.meta = init.meta
    this.client = init.client
    this.versionCommand = init.versionCommand
    this.sessionHome = init.sessionHome ?? 'per-member'
    this.defersMcpTools = init.defersMcpTools ?? true
  }

  /**
   * 开会话前核对这家 CLI 落实不了的会话配置项：`alwaysLoad: true` 的 MCP 服务器（ACP 的线格式表达不了，CLI 可能
   * 把它的工具延迟加载）。
   * @param config - 会话配置。
   * @throws {BrainError} `invalid_input`。
   */
  protected admit(config: SessionConfig): void {
    if (!this.defersMcpTools) return
    const always = Object.entries(memberMcpServers(config)).filter(([, server]) => server.alwaysLoad === true).map(([name]) => name)
    if (always.length > 0) {
      throw new BrainError('invalid_input', 'brain.mcp_always_load_unsupported', `brain provider ${this.impl} cannot promise that MCP servers ${always.join(', ')} stay loaded (ACP has no alwaysLoad); drop alwaysLoad or use another provider`)
    }
  }

  /** @inheritdoc */
  async probe(context: BrainProbeContext): Promise<BrainProbeResult> {
    if (!await this.client.isAvailable()) {
      return { available: false, problems: [`${this.meta.binary.command} is not on PATH or not executable`] }
    }
    const version = await this.readVersion(context)
    return { available: true, ...(version === undefined ? {} : { version }), problems: [] }
  }

  /**
   * 读 CLI 版本（尽力而为，读不到不算不可用）。
   * @param context - 探测上下文。
   * @returns 版本行，或读不到时的 `undefined`。
   */
  protected async readVersion(context: BrainProbeContext): Promise<string | undefined> {
    if (this.versionCommand === undefined) return undefined
    const [command, ...args] = this.versionCommand
    try {
      const { stdout, stderr } = await execProviderCommand(context, command, args, {
        timeout: 10_000,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      })
      return (stdout.trim() || stderr.trim()).split('\n')[0]
    } catch (_versionUnreadable) {
      // 版本只是展示；读不到不影响可用性判断。
      return undefined
    }
  }

  /**
   * 契约配置 → Paseo 会话配置；默认经标准 ACP 设模型。
   * @param config - 契约会话配置。
   * @returns Paseo 会话配置。
   */
  protected sessionConfig(config: SessionConfig): AgentSessionConfig {
    return toPaseoSessionConfig(this.client.provider, config, true)
  }

  /**
   * 契约启动上下文 → Paseo 启动上下文：环境项只有调用方经 `SessionConfig.env` 给的（通用 ACP 的命令与环境在插件
   * 配置里，进了客户端）。
   * @param launch - 启动上下文。
   * @param config - 会话配置。
   * @returns Paseo 启动上下文。
   */
  protected launchContext(launch: BrainLaunchContext, config: SessionConfig): Promise<AgentLaunchContext> {
    return Promise.resolve(toPaseoLaunchContext(launch, mergeLaunchEnv(this.impl, {}, config.env)))
  }

  /**
   * 把 Paseo 会话包成契约会话。
   * @param init - 提供方、能力声明与 Paseo 会话。
   * @param _launch - 启动上下文。
   * @returns 契约会话。
   */
  protected wrap(init: PaseoBrainSessionInit, _launch: BrainLaunchContext): BrainProviderSession {
    return new AcpBrainSession(init)
  }

  /**
   * 包一个开好的 Paseo 会话。
   * @param session - Paseo 会话。
   * @param launch - 启动上下文（图片字节从它取）。
   * @returns 契约会话。
   */
  protected session(session: AgentSession, launch: BrainLaunchContext): BrainProviderSession {
    return this.wrap({ impl: this.impl, meta: this.meta, session, blobs: launch }, launch)
  }

  /**
   * 核对起始模式：Paseo 对不认识的模式只记日志不切，所以开好之后读一次当前模式，不是所要的就关掉会话并拒绝。
   * @param session - 开好的 Paseo 会话。
   * @param wrapped - 包好的契约会话（失败时关它）。
   * @param config - 会话配置。
   * @throws {BrainError} `invalid_input`：这个会话没有所要的模式。
   */
  protected async ensureMode(session: AgentSession, wrapped: BrainProviderSession, config: SessionConfig): Promise<void> {
    if (config.modeId === undefined) return
    // Paseo 把配置里的模式号先当作当前模式，所以既要它在模式表里，也要它是当前模式。
    const available = (await session.getAvailableModes()).map(mode => mode.id)
    if (available.includes(config.modeId) && await session.getCurrentMode() === config.modeId) return
    await wrapped.close()
    throw new BrainError('invalid_input', 'brain.mode_unknown', `brain provider ${this.impl} has no mode ${JSON.stringify(config.modeId)} in this session; available: ${available.join(', ') || '(none)'}`)
  }

  /** @inheritdoc */
  async createSession(config: SessionConfig, launch: BrainLaunchContext): Promise<BrainProviderSession> {
    this.admit(config)
    const session = await this.client.createSession(this.sessionConfig(config), await this.launchContext(launch, config))
    const wrapped = this.session(session, launch)
    await this.ensureMode(session, wrapped, config)
    return wrapped
  }

  /** @inheritdoc */
  async resumeSession(handle: ResumeHandle, config: SessionConfig, launch: BrainLaunchContext): Promise<BrainProviderSession> {
    if (!this.meta.resume) {
      throw new BrainError('unavailable', 'brain.resume_unsupported', `brain provider ${this.impl} does not resume sessions`)
    }
    this.admit(config)
    const persisted = {
      provider: this.client.provider,
      sessionId: handle.sessionRef,
      ...(handle.nativeHandle === undefined ? {} : { nativeHandle: handle.nativeHandle }),
    }
    const session = await this.client.resumeSession(persisted, this.sessionConfig(config), await this.launchContext(launch, config))
    const wrapped = this.session(session, launch)
    await this.ensureMode(session, wrapped, config)
    return wrapped
  }
}
