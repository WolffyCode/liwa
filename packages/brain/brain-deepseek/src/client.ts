/**
 * `deepseek` 的 ACP 客户端：Paseo 的 shim 写法——`GenericACPAgentClient` 的子类，命令固定为同一安装里的
 * `liwa --profile deepseek`，每个会话配一条 `_liwa` 通道（`_meta.liwa` 的出站字段与入站观察）。
 * @module @liwa/brain-deepseek/client
 */

import { GenericACPAgentClient, type ACPMetaExtension, type ACPMetaRequestMethod, type ACPObservedMessage } from '@liwa/brain-acp'
import type { PaseoLogger } from '@liwa/brain-shared'
import type { AgentLaunchContext, AgentSessionConfig } from '@liwa/brain-shared/paseo/agent/agent-sdk-types'
import { liwaMeta, type LiwaSessionMeta } from '@liwa/deepseek-app'
import type { ProviderProcessHost } from '@liwa/brain'

/**
 * 一个会话的 `_liwa` 通道：`session/new` / `session/resume` 带上 `_meta.liwa`，一次取消可以带上保留队列的
 * 选择；入站的原始消息在接上观察者之前先缓存。
 */
export class LiwaChannel implements ACPMetaExtension {
  private readonly buffered: ACPObservedMessage[] = []
  private listener: ((message: ACPObservedMessage) => void) | undefined
  private cancelMeta: Record<string, unknown> | undefined

  /**
   * @param sessionMeta - 这一代会话的 `_meta.liwa`。
   */
  constructor(private readonly sessionMeta: LiwaSessionMeta) {}

  /** @inheritdoc */
  requestMeta(method: ACPMetaRequestMethod): Record<string, unknown> | undefined {
    switch (method) {
      case 'session/new':
      case 'session/resume':
      case 'session/load':
        return liwaMeta(this.sessionMeta)
      case 'session/cancel': {
        const meta = this.cancelMeta
        this.cancelMeta = undefined
        return meta
      }
      case 'session/prompt':
        return undefined
    }
  }

  /**
   * 下一次取消：要不要保留没读走的输入、要不要连同在跑的子会话一起停。
   * @param keepQueue - 是否保留。
   * @param stopChildren - 是否连子会话一起停。
   */
  armCancel(keepQueue: boolean, stopChildren: boolean): void {
    this.cancelMeta = liwaMeta({ keepQueue, stopChildren })
  }

  /** @inheritdoc */
  observe(message: ACPObservedMessage): void {
    if (this.listener === undefined) this.buffered.push(message)
    else this.listener(message)
  }

  /**
   * 接上观察者，先交出缓存的消息。
   * @param listener - 收每条入站消息。
   */
  attach(listener: (message: ACPObservedMessage) => void): void {
    this.listener = listener
    for (const message of this.buffered.splice(0)) listener(message)
  }
}

/** {@link DeepseekACPAgentClient} 的构造项。 */
export interface DeepseekACPAgentClientOptions {
  /** pino 形状的日志器。 */
  logger: PaseoLogger
  /** 拉起 `liwa --profile deepseek` 的完整 argv。 */
  command: [string, ...string[]]
  /** 每个会话都要的环境项（例如源码入口的 tsx 配置）。 */
  env: Record<string, string>
  /** 探测与诊断拉进程用的入口（`ctx.subprocess`）。 */
  processHost: ProviderProcessHost
}

/** `deepseek` 的 ACP 客户端（Paseo shim）。 */
export class DeepseekACPAgentClient extends GenericACPAgentClient {
  private readonly channels = new Map<string, LiwaChannel>()

  /**
   * @param options - 日志器、命令、环境、进程入口。
   */
  constructor(options: DeepseekACPAgentClientOptions) {
    super({
      logger: options.logger,
      command: options.command,
      env: options.env,
      providerId: 'deepseek',
      label: 'deepseek',
      // liwa 不发命令清单，不等 available_commands_update。
      waitForInitialCommands: false,
      processHost: options.processHost,
    })
  }

  /**
   * 为一个即将开或续接的会话备好通道（按 agent id 即 brains 的会话号取用）。
   * @param agentId - brains 分配的会话号。
   * @param channel - 通道。
   * @returns 撤掉登记的函数（会话开好或失败后调用）。
   */
  prepareChannel(agentId: string, channel: LiwaChannel): () => void {
    this.channels.set(agentId, channel)
    return () => { if (this.channels.get(agentId) === channel) this.channels.delete(agentId) }
  }

  /** @inheritdoc */
  protected override sessionExtension(_config: AgentSessionConfig, launchContext?: AgentLaunchContext): ACPMetaExtension | undefined {
    return launchContext?.agentId === undefined ? undefined : this.channels.get(launchContext.agentId)
  }
}
