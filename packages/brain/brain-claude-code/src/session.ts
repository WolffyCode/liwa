/**
 * Claude 私有语义经共享事件映射接入公共契约。
 * @module @liwa/brain-claude-code/session
 */
import { BrainError, ChildId, PermissionRequestId, type ResumeHandle, type BrainEvent, type CancelOptions, type TurnId, type PermissionAnswer, type PermissionOption, type PermissionQuestion } from '@liwa/brain'
import { PaseoBrainSession, type PaseoBrainSessionInit } from '@liwa/brain-shared'
import type { AgentMetadata, AgentPermissionRequest, AgentPermissionResponse } from '@liwa/brain-shared/paseo/agent/agent-sdk-types'
import { claudeAnswerInput, sessionPermissionOptions } from './permissions.ts'
import type { ClaudeDiagnostics } from './diagnostics.ts'
import type { ClaudeTurnPolicy } from './budget.ts'
import { baselineMetadata, type ClaudeUsage } from './usage.ts'
import type { ClaudeAgentSession } from './paseo/agent/providers/claude/agent.ts'
import { applyThinking, resolveModel, resolveThinking, type ClaudeSessionPolicy, type Config, type ThinkingChoice } from './config.ts'

/** Claude 会话：结构化问答、会话审批、实例模型目录与 thinking 档位。 */
export class ClaudeBrainSession extends PaseoBrainSession {
  private readonly sessionGrantRequests = new Map<PermissionRequestId, Map<string, string[]>>()
  private applied: ThinkingChoice
  /**
   *
   * @param init - 共享会话参数。
   * @param config - 本实例模型与部署项。
   * @param policy - 本代的 SDK 选项、最终 MCP 表与快照释放。
   * @param usage - 回合用量账本（assistant 帧归属 + result 累计对账）。
   * @param budget - 回合预算与主人会话许可。
   * @param home - 成员 impl 根；续接必须沿用。
   * @param model - 开会话时解析出的模型 id。
   * @param thinking - 会话明确选的 thinking 档位；省略即跟随模型默认档。
   */
  constructor(
    init: PaseoBrainSessionInit, private readonly config: Config, private readonly policy: ClaudeSessionPolicy,
    private readonly usage: ClaudeUsage, private readonly budget: ClaudeTurnPolicy, private readonly home: string,
    private model: string, private thinking: string | undefined, private readonly diagnostics: ClaudeDiagnostics,
  ) {
    super(init)
    this.applied = policy.thinking
    if (policy.projectContext !== undefined) policy.projectContext.publish = (event) => { this.emit(event) }
  }

  /**
   * 回合之间换 thinking 档位：改 SDK 选项并让下一回合用新 Query（Paseo 也靠重启 Query）。
   * @param thinking - 当前模型目录里的一个档位号。
   */
  async setThinking(thinking: string): Promise<void> {
    if (this.currentTurn !== undefined || (this.paseo as ClaudeAgentSession).isBusy()) {
      throw new BrainError('conflict', 'brain.turn_active', 'change the thinking option between turns; a turn is running or stopping')
    }
    const choice = resolveThinking(resolveModel(this.config, this.model), thinking)
    this.applyChoice(choice)
    this.thinking = thinking
    this.emit({ kind: 'session.thinking_changed', thinking })
    return Promise.resolve()
  }

  private applyChoice(choice: ThinkingChoice): void {
    const isSame = choice.effort === this.applied.effort && choice.ultracode === this.applied.ultracode
      && choice.thinking?.type === this.applied.thinking?.type
    if (isSame) return
    applyThinking(this.policy.options, choice)
    this.applied = choice
    ;(this.paseo as ClaudeAgentSession).requestQueryRestart()
  }

  /** @inheritdoc */
  override persistence(): ResumeHandle | null {
    const handle = super.persistence()
    if (handle === null) return null
    const metadata = baselineMetadata(this.usage.baseline())
    // 累计基线随句柄走：CLI 续接时从转录恢复累计值，下一代要靠它才能只记自己的消费。
    return { ...handle, home: this.home, ...(Object.keys(metadata).length === 0 ? {} : { metadata }) }
  }

  /**
   * @inheritdoc
   */
  protected override decorate(event: BrainEvent): BrainEvent {
    if (event.kind === 'item.tool_call.completed') return { ...event, result: this.diagnostics.redactValue(event.result) }
    if (event.kind === 'permission.resolved') {
      const tools = this.sessionGrantRequests.get(event.requestId)?.get(event.optionId)
      this.sessionGrantRequests.delete(event.requestId)
      // allow_session 只由下方登记过的窄规则生成；共享层不会发布未知请求的 resolved。
      if (event.effect === 'allow_session' && tools !== undefined) {
        for (const tool of tools) {
          if (tool.startsWith('mcp__')) this.budget.allowSession(tool)
          else this.budget.delegateSession(tool)
        }
      }
    }
    if (event.kind === 'turn.completed') {
      const usage = this.usage.take(event.turnId)
      // context 是瞬时占用，消费来自账本的对账结果。
      return {
        ...event, ...(this.budget.concludedBy === undefined ? {} : { concludedBy: this.budget.concludedBy }),
        usage: { ...(event.usage.context === undefined ? {} : { context: event.usage.context }), ...usage },
      }
    }
    if (event.kind === 'turn.interrupted' || event.kind === 'turn.failed') {
      const usage = this.usage.take(event.turnId)
      return { ...event, ...(usage === undefined ? {} : { usage }) }
    }
    return event
  }

  /**
   * @inheritdoc
   */
  protected override permissionAnswerInput(
    request: AgentPermissionRequest, questions: readonly PermissionQuestion[], answers: Readonly<Record<string, PermissionAnswer>>,
  ): AgentMetadata {
    return claudeAnswerInput(request, questions, answers)
  }

  /**
   * @inheritdoc
   */
  protected override permissionChildId(request: AgentPermissionRequest): ChildId | undefined {
    const id = request.metadata?.['childId']
    return typeof id === 'string' ? ChildId(id) : undefined
  }

  /**
   * @inheritdoc
   */
  protected override permissionOptions(request: AgentPermissionRequest): { option: PermissionOption; response: AgentPermissionResponse }[] {
    const options = super.permissionOptions(request)
    const grants = sessionPermissionOptions(request)
    if (grants.length > 0) {
      const rulesByOption = new Map(grants.map(grant => [grant.option.id, grant.tools]))
      this.sessionGrantRequests.set(PermissionRequestId(request.id), rulesByOption)
    }
    options.push(...grants)
    return options
  }

  /**
   * @inheritdoc
   */
  protected override nativeModel(model: string): Promise<string> {
    const entry = resolveModel(this.config, model)
    // 明确选过的档位新模型必须也有，否则拒绝换模型；跟随默认的就换成新模型的默认档。
    this.applyChoice(resolveThinking(entry, this.thinking))
    this.model = entry.id
    return Promise.resolve(entry.id)
  }

  /**
   * @inheritdoc
   */
  protected override async interruptTurn(options: CancelOptions, captured: TurnId | undefined): Promise<void> {
    if (['pause', 'drain', 'owner', 'hard_limit'].includes(options.reason)) await (this.paseo as ClaudeAgentSession).stopTasks()
    await super.interruptTurn(options, captured)
  }

  /**
   * @inheritdoc
   */
  override async close(): Promise<void> {
    try {
      await super.close()
    } finally {
      this.sessionGrantRequests.clear()
      if (this.policy.projectContext !== undefined) this.policy.projectContext.publish = undefined
      await this.policy.dispose()
    }
  }
}
