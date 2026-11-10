/**
 * 主回合预算与成功 MCP 工具收尾；不冒充子 agent 全局预算。
 * @module @liwa/brain-claude-code/budget
 */
import type { HookInput, SyncHookJSONOutput } from '@anthropic-ai/claude-agent-sdk'
import { KERNEL_MCP_SERVER_NAME, memberMcpServers, type SessionConfig } from '@liwa/brain'

/** 每回合拥有独立成功账本，PostToolBatch 才有权阻止下一步。 */
export class ClaudeTurnPolicy {
  private readonly sessionGrants = new Set<string>()
  private readonly successes = new Map<string, string>()
  private conclusion: string | undefined

  /**
   *
   * @param config - 这一代的工具、权限与收尾约定。
   */
  /**
   * @param config - 会话配置。
   * @param mcpServerNames - 最终生效的 MCP 服务器名（内核 + 实例 + 会话）；省略时只认会话配置里的。
   */
  constructor(
    private readonly config: SessionConfig,
    private readonly mcpServerNames: readonly string[] = Object.keys(memberMcpServers(config)),
  ) {}

  /** 记录主人明确选择的会话许可；工具名已经过窄规则编码器核对。
   * @param tool - 精确原生工具名。
   */
  allowSession(tool: string): void { this.sessionGrants.add(tool) }

  /** 当前回合由哪个规范工具结束；没有则省略。 */
  get concludedBy(): string | undefined { return this.conclusion }

  /** 新父回合开始，清除上一回合的批次事实。 */
  begin(): void { this.successes.clear(); this.conclusion = undefined }

  /**
   * SDK 自有钩子，只按可观测的成功事实收尾。
   * @param input - SDK 钩子输入。
   * @returns 钩子决策。
   */
  hook(input: HookInput): Promise<SyncHookJSONOutput> {
    if (input.hook_event_name === 'PreToolUse') {
      const allowed = this.sessionGrants.has(input.tool_name) || this.config.permission.autoAllow.some(
        name => name === input.tool_name || `mcp__${KERNEL_MCP_SERVER_NAME}__${name}` === input.tool_name,
      )
      if (allowed) return Promise.resolve({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } })
      if (this.config.permission.mode === 'kernel') {
        return Promise.resolve({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: 'Liwa owner approval' } })
      }
    }
    if (input.agent_id !== undefined) return Promise.resolve({})
    switch (input.hook_event_name) {
      case 'PostToolUse': {
        const response = input.tool_response
        const failed = typeof response === 'object' && response !== null && (('isError' in response && response.isError === true) || ('is_error' in response && response.is_error === true))
        if (!failed) this.successes.set(input.tool_use_id, input.tool_name)
        else this.successes.delete(input.tool_use_id)
        break
      }
      case 'PostToolUseFailure':
        this.successes.delete(input.tool_use_id)
        break
      case 'PostToolBatch':
        for (const call of input.tool_calls) {
          const succeeded = this.successes.get(call.tool_use_id) === call.tool_name
          this.successes.delete(call.tool_use_id)
          if (!succeeded) continue
          const name = this.conclusionName(call.tool_name)
          if (name === undefined) continue
          this.conclusion = name
          return Promise.resolve({ continue: false, stopReason: `Completed by ${name}` })
        }
        break
      default:
        // 其他原生钩子不改变预算或成功账本。
        break
    }
    return Promise.resolve({})
  }

  private conclusionName(tool: string): string | undefined {
    for (const server of this.mcpServerNames) {
      const prefix = `mcp__${server}__`
      if (!tool.startsWith(prefix)) continue
      const name = tool.slice(prefix.length)
      if (this.config.concludeOn.includes(tool)) return tool
      if (server === KERNEL_MCP_SERVER_NAME && this.config.concludeOn.includes(name)) {
        const kernel = this.config.kernelTools
        if (kernel !== undefined && 'endpoint' in kernel && !kernel.tools.some(entry => entry.id === name)) return undefined
        return name
      }
    }
    return undefined
  }
}
