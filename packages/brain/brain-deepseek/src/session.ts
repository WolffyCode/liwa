/**
 * `deepseek` 的契约会话：在通用 ACP 会话之上读写 `_liwa`——插话走 `_liwa/steer`，取消可带保留队列，
 * 回合用量与收尾工具取自 `session/prompt` 返回的 `_meta.liwa`，子会话的开始与结束取自 `session/update`
 * 的 `_meta.liwa.child`，子会话的权限请求标明 `childId`，工具名取服务端在标题里给的真名；模型名与标准
 * `session/set_config_option` 的选项值（`["<路由>","<模型>"]`）互转；计划模式在回合进行中切换时下一步生效。
 * @module @liwa/brain-deepseek/session
 */

import { AcpBrainSession, ACPAgentSession, type ACPObservedMessage } from '@liwa/brain-acp'
import {
  BrainError, ChildId, TurnId,
  type BrainEvent, type CancelOptions, type CancelReason, type DeliverResult, type ModeChange, type Usage,
} from '@liwa/brain'
import { mapPaseoUsage, type PaseoBrainSessionInit } from '@liwa/brain-shared'
import type {
  AgentPermissionRequest, AgentPromptContentBlock, AgentUsage, ToolCallTimelineItem,
} from '@liwa/brain-shared/paseo/agent/agent-sdk-types'
import {
  LIWA_METHODS, LiwaChildrenResultSchema, LiwaPermissionMetaSchema, LiwaPromptMetaSchema, LiwaSteerResultSchema,
  LiwaUpdateMetaSchema, LiwaUsageResultSchema, liwaMetaOf,
  type LiwaChildView, type LiwaPromptMeta, type LiwaUsage,
} from '@liwa/deepseek-app'
import type { LiwaChannel } from './client.ts'

/**
 * 线上用量 → 契约用量。
 * @param usage - `_meta.liwa` 里的用量。
 * @returns 契约用量。
 */
export function fromLiwaUsage(usage: LiwaUsage): Usage {
  return {
    ...(usage.tokens === undefined ? {} : { tokens: { ...usage.tokens } }),
    ...(usage.inferences === undefined ? {} : { inferences: usage.inferences }),
  }
}

/** 连同在跑的子会话一起停的取消原因（01 §4.5）；其余（抢占、看门狗、硬上限）只停根会话的回合。 */
const STOP_CHILDREN: ReadonlySet<CancelReason> = new Set(['pause', 'drain', 'owner'])

/** `deepseek` 的契约会话。 */
export class DeepseekBrainSession extends AcpBrainSession {
  private readonly promptMeta = new Map<string, LiwaPromptMeta>()
  private readonly permissionChildren = new Map<string, string>()
  /** 服务端报的、根会话自己跑起来的回合（没有 `session/prompt`）。 */
  private readonly providerTurns = new Set<string>()

  /**
   * @param init - 提供方、能力声明与 Paseo 会话。
   * @param channel - 这个会话的 `_liwa` 通道。
   */
  constructor(init: PaseoBrainSessionInit, private readonly channel: LiwaChannel) {
    super(init)
    channel.attach((message) => { this.onLiwaMessage(message) })
  }

  private get acp(): ACPAgentSession {
    if (!(this.paseo instanceof ACPAgentSession)) throw new Error('deepseek sessions run over the ACP client')
    return this.paseo
  }

  private onLiwaMessage(message: ACPObservedMessage): void {
    switch (message.kind) {
      case 'prompt-response': {
        const parsed = LiwaPromptMetaSchema.safeParse(liwaMetaOf(message.response))
        if (parsed.success) this.promptMeta.set(message.turnId, parsed.data)
        return
      }
      case 'permission-request': {
        const parsed = LiwaPermissionMetaSchema.safeParse(liwaMetaOf(message.request) ?? {})
        if (parsed.success && parsed.data.childId !== undefined) this.permissionChildren.set(message.requestId, parsed.data.childId)
        return
      }
      case 'session-update': {
        const parsed = LiwaUpdateMetaSchema.safeParse(liwaMetaOf(message.notification) ?? {})
        const turn = parsed.success ? parsed.data.turn : undefined
        if (turn !== undefined) {
          const turnId = TurnId(turn.turnId)
          if (turn.event === 'started') {
            this.providerTurns.add(turn.turnId)
            this.beginProviderTurn(turnId)
          } else {
            this.providerTurns.delete(turn.turnId)
            this.finishTurn(turn.stopReason === 'cancelled'
              ? { kind: 'turn.interrupted', turnId, reason: 'cancelled' }
              : { kind: 'turn.completed', turnId, usage: fromLiwaUsage(turn.usage), ...(turn.concludedBy === undefined ? {} : { concludedBy: turn.concludedBy }) })
          }
        }
        const child = parsed.success ? parsed.data.child : undefined
        if (child === undefined) return
        if (child.event === 'started') {
          const turnId = this.currentTurn
          this.emit({
            kind: 'child.started',
            childId: ChildId(child.childId),
            childKind: 'native-child',
            label: child.label,
            provider: this.impl,
            ...(child.parentChildId === undefined ? {} : { parentChildId: ChildId(child.parentChildId) }),
            ...(turnId === undefined ? {} : { turnId }),
          })
        } else {
          this.emit({ kind: 'child.ended', childId: ChildId(child.childId), stopReason: child.stopReason, usage: fromLiwaUsage(child.usage) })
        }
      }
    }
  }

  /** @inheritdoc */
  protected override decorate(event: BrainEvent): BrainEvent {
    switch (event.kind) {
      case 'turn.completed': {
        const concludedBy = this.promptMeta.get(event.turnId)?.concludedBy
        this.promptMeta.delete(event.turnId)
        return concludedBy === undefined ? event : { ...event, concludedBy }
      }
      case 'turn.interrupted':
      case 'turn.failed':
        this.promptMeta.delete(event.turnId)
        return event
      default:
        return event
    }
  }

  /** @inheritdoc */
  protected override permissionChildId(request: AgentPermissionRequest): ChildId | undefined {
    const childId = this.permissionChildren.get(request.id)
    this.permissionChildren.delete(request.id)
    return childId === undefined ? undefined : ChildId(childId)
  }

  /**
   * 选项值 `["<路由>","<模型>"]`（liwa ACP 服务器的模型选项）→ 模型名。
   * @param native - 运行时信息里的模型选项值。
   * @returns 模型名；不是这个形状时原样。
   */
  protected override modelName(native: string): string {
    return routeOf(native)?.[1] ?? native
  }

  /**
   * 模型名 → 当前路由下的选项值（换模型不换路由）。
   * @param model - 模型名。
   * @returns 选项值。
   */
  protected override async nativeModel(model: string): Promise<string> {
    const current = (await this.paseo.getRuntimeInfo()).model
    const route = typeof current === 'string' ? routeOf(current) : undefined
    if (route === undefined) {
      throw new BrainError('unavailable', 'brain.model_switch_unsupported', `${this.impl} session reports no model route to switch within`)
    }
    return JSON.stringify([route[0], model])
  }

  /**
   * 计划模式在回合之间切换立刻生效，回合进行中挂到下一步开始时（底座 plan-mode 的规则）。
   * @param _modeId - 所选模式。
   * @returns 生效时机。
   */
  protected override modeAppliesAt(_modeId: string): ModeChange['appliesAt'] {
    return this.currentTurn === undefined ? 'now' : 'next_step'
  }

  /** @inheritdoc */
  protected override turnUsage(turnId: TurnId, usage: AgentUsage | undefined): Usage {
    const meta = this.promptMeta.get(turnId)
    // 服务端的用量含子会话的 token 与根会话的推理次数；标准 ACP 用量只是它的一部分。
    return meta === undefined ? mapPaseoUsage(usage) : { ...mapPaseoUsage(usage), ...fromLiwaUsage(meta.usage) }
  }

  /** @inheritdoc */
  protected override toolName(item: ToolCallTimelineItem): string {
    const title = item.metadata?.['title']
    return typeof title === 'string' && title !== '' ? title : item.name
  }

  /** @inheritdoc */
  protected override permissionTool(request: AgentPermissionRequest): string {
    return request.title ?? request.name
  }

  /** @inheritdoc */
  protected override async steer(prompt: AgentPromptContentBlock[], _turnId: TurnId): Promise<DeliverResult> {
    const blocks = prompt.flatMap((block): ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] => {
      switch (block.type) {
        case 'text':
          return [{ type: 'text', text: block.text }]
        case 'image':
          return [{ type: 'image', data: block.data, mimeType: block.mimeType }]
        default:
          return []
      }
    })
    const result = LiwaSteerResultSchema.parse(await this.acp.requestExtension(LIWA_METHODS.steer, { prompt: blocks }))
    return result.outcome
  }

  /**
   * 取消：在途提示词走标准的 `session/cancel` 并等它带着 `cancelled` 返回；服务端自己跑起来的回合、或空闲时要停
   * 后台子会话，也发 `session/cancel`（Paseo 的 `interrupt()` 只在有前台提示词时发），并等那个回合的结束通知。
   * `_meta.liwa` 带上保不保留队列、停不停子会话。
   * @param options - 取消原因与是否保留队列。
   * @param captured - 调用时在跑的回合。
   */
  protected override async interruptTurn(options: CancelOptions, captured: TurnId | undefined): Promise<void> {
    const stopChildren = STOP_CHILDREN.has(options.reason)
    const providerTurn = captured !== undefined && this.providerTurns.has(captured)
    if (providerTurn || (captured === undefined && stopChildren)) {
      const ended = captured === undefined ? undefined : this.whenTurnEnds(captured)
      this.channel.armCancel(options.keepQueue, stopChildren)
      await this.acp.interruptSession()
      if (ended !== undefined) await ended
      return
    }
    if (captured !== undefined) this.channel.armCancel(options.keepQueue, stopChildren)
    await super.interruptTurn(options, captured)
  }

  /**
   * 服务端的累计用量（续接后对账用）。
   * @returns 用量与会话种类、人设版本。
   */
  async serverUsage(): Promise<{ usage: Usage; mindKind?: string; version?: string }> {
    const result = LiwaUsageResultSchema.parse(await this.acp.requestExtension(LIWA_METHODS.usage, {}))
    return {
      usage: fromLiwaUsage(result.usage),
      ...(result.mindKind === undefined ? {} : { mindKind: result.mindKind }),
      ...(result.version === undefined ? {} : { version: result.version }),
    }
  }

  /**
   * 服务端记的子会话。
   * @returns 子会话列表。
   */
  async serverChildren(): Promise<LiwaChildView[]> {
    return LiwaChildrenResultSchema.parse(await this.acp.requestExtension(LIWA_METHODS.children, {})).children
  }
}

/**
 * 读 liwa ACP 服务器的模型选项值 `["<路由>","<模型>"]`。
 * @param value - 选项值。
 * @returns 路由与模型；不是这个形状时为 `undefined`。
 */
function routeOf(value: string): [string, string] | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === 'string' && typeof parsed[1] === 'string'
      ? [parsed[0], parsed[1]]
      : undefined
  } catch (_notJson) {
    // 别的形状的模型号原样当模型名。
    return undefined
  }
}
