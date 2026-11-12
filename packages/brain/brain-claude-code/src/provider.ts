/**
 * 本机 Claude Code SDK 提供方，每会话一个受管 CLI。
 * @module @liwa/brain-claude-code/provider
 */
import type { HookInput } from '@anthropic-ai/claude-agent-sdk'
import {
  BrainError, ImplId, TurnId,
  type BrainLaunchContext, type BrainProbeContext, type BrainProbeResult, type BrainProvider, type BrainProviderSession,
  type Meta, type ResumeHandle, type SessionConfig, type PluginManagementRequest, type PluginLibraryRecord,
} from '@liwa/brain'
import { StringDecoder } from 'node:string_decoder'
import { ClaudeDiagnostics } from './diagnostics.ts'
import { CLAUDE_SESSION_UUID, validateResume } from './resume.ts'
import { ClaudeAgentSession } from './paseo/agent/providers/claude/agent.ts'
import { Config, claudeEnvironment, instanceSecrets, resolveModel, resolveSessionPolicy, sessionSecrets, validateConfig, writeMemberConfig } from './config.ts'
import { claudeSpawnSpec, ManagedClaudeCodeProcess } from './process.ts'
import { MIN_CLAUDE_VERSION, probeClaude, resolveClaudeExecutable } from './probe.ts'
import { ClaudeTurnPolicy } from './budget.ts'
import { ClaudeUsage, restoredBaseline } from './usage.ts'
import { manageClaudePlugins } from './plugin-library.ts'
import { ClaudeBrainSession } from './session.ts'

/** 能力声明；实例仍由准入显式拒绝，真实 CLI 组合另经 A2 验收。 */
export const CLAUDE_META: Meta = {
  streaming: true, resume: true, nativeTools: false, permissionHook: true, rollback: false,
  modelSwitch: true, thinkingSwitch: true, modeSwitch: true,
  delivery: { nextStep: true, nextTurn: false, cancelKeepsQueue: false },
  compaction: 'switchable', budget: { inferences: true, toolCalls: false, concludeOn: true }, usage: 'tokens',
  personaInjection: { instance: 'system_prompt', work: 'preset_append' },
  agentConfig: { plugins: true, hooks: true, instructions: true },
  runtime: 'subprocess', transport: 'claude-sdk', kernelTools: ['mcp-http', 'mcp-stdio'],
  binary: { command: 'claude', minVersion: MIN_CLAUDE_VERSION }, children: { native: 'observe', crossCli: true },
}

/** 一行 Config 一个提供方实例，成员配置根由 brains 按 impl 分配。 */
export class ClaudeBrainProvider implements BrainProvider {
  readonly impl
  readonly meta: Meta
  readonly sessionHome = 'per-member' as const
  readonly writeMemberConfig = writeMemberConfig

  /**
   *
   * @param config - 经 schema 解析的实例；认证与地址已在 env 里。
   */
  constructor(private readonly config: Config) {
    validateConfig(config)
    this.impl = ImplId(config.impl)
    this.meta = { ...CLAUDE_META, binary: { command: config.binary, minVersion: MIN_CLAUDE_VERSION } }
  }

  /**
   * @inheritdoc
   */
  async probe(context: BrainProbeContext): Promise<BrainProbeResult> {
    return probeClaude(context, this.config)
  }

  /** @inheritdoc */
  managePlugins(context: BrainProbeContext, root: string, request: PluginManagementRequest): Promise<PluginLibraryRecord[]> {
    return manageClaudePlugins(context, this.config, root, request)
  }

  /**
   * @inheritdoc
   */
  createSession(config: SessionConfig, launch: BrainLaunchContext): Promise<BrainProviderSession> {
    return this.open(config, launch)
  }

  /**
   * @inheritdoc
   */
  resumeSession(handle: ResumeHandle, config: SessionConfig, launch: BrainLaunchContext): Promise<BrainProviderSession> {
    if (handle.provider !== this.impl || !CLAUDE_SESSION_UUID.test(handle.sessionRef)) throw new BrainError('invalid_input', 'brain.claude_resume', 'Resume handle must identify this provider and a Claude session UUID')
    return this.open(config, launch, handle)
  }

  private async open(config: SessionConfig, launch: BrainLaunchContext, handle?: ResumeHandle): Promise<BrainProviderSession> {
    const historySnapshot = handle === undefined ? undefined : await validateResume(handle, launch.homeDir, config.cwd)
    const policy = await resolveSessionPolicy(this.config, config, launch.homeDir)
    const diagnostics = new ClaudeDiagnostics([...instanceSecrets(this.config), ...sessionSecrets(policy.mcpServers, config.kernelTools)])
    const freshBaseline = { costUsd: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
    const usage = new ClaudeUsage(handle === undefined ? freshBaseline : restoredBaseline(handle.metadata))
    const budget = new ClaudeTurnPolicy(config, Object.keys(policy.mcpServers))
    const hookEvents = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch']
    policy.options.hooks = Object.fromEntries(hookEvents.map(name => [name, [{ hooks: [async (input: HookInput) => {
      const decision = await budget.hook(input)
      const context = await policy.projectContext?.hook(input)
      if (context?.hookSpecificOutput === undefined) return decision
      return { ...decision, hookSpecificOutput: { ...decision.hookSpecificOutput, ...context.hookSpecificOutput } }
    }] }]]))
    let session: ClaudeAgentSession | undefined
    const start = async (): Promise<BrainProviderSession> => {
      const binary = await resolveClaudeExecutable(launch, this.config)
      const env = claudeEnvironment(launch.homeDir, this.config, config)
      await writeMemberConfig(launch.homeDir, config)
      session = new ClaudeAgentSession({
        provider: 'claude', cwd: config.cwd, model: resolveModel(this.config, config.model).id,
        ...(config.modeId === undefined ? {} : { modeId: config.modeId }), providerOptions: {},
      }, {
        sdkOptions: policy.options,
        ...(historySnapshot === undefined ? {} : { historySnapshot }),
        controlTimeoutMs: this.config.controlTimeoutMs,
        onQuery: () => { usage.reset() },
        onTurn: () => { budget.begin() },
        onMessage: (message, turnId) => { usage.observe(message, turnId === undefined ? undefined : TurnId(turnId)) },
        diagnostics, logger: diagnostics.logger(launch.logger), agentId: launch.sessionId,
        launchEnv: env, persistSession: true, resolveBinary: () => Promise.resolve(binary.path),
        ...(handle === undefined ? {} : { handle: { provider: 'claude', sessionId: handle.sessionRef, nativeHandle: handle.sessionRef } }),
        spawn: (options, stderr) => {
          const child = launch.spawn(claudeSpawnSpec(options, this.config.graceMs, this.config.binaryArgs))
          const decoder = new StringDecoder('utf8')
          const output = diagnostics.stream(text => stderr?.(text))
          child.stderr?.on('data', (chunk: Buffer) =>{  output.write(decoder.write(chunk)) })
          child.stderr?.on('end', () => { output.write(decoder.end()); output.end() })
          return new ManagedClaudeCodeProcess(child)
        },
        disposeProcess: child => (child as ManagedClaudeCodeProcess).dispose(),
      })
      await session.ensureHistoryReady()
      return new ClaudeBrainSession(
        { impl: this.impl, meta: this.meta, session, blobs: launch }, this.config, policy, usage, budget, launch.homeDir,
        resolveModel(this.config, config.model).id, config.thinking, diagnostics,
      )
    }
    try {
      return await start()
    } catch (error) {
      try {
        await session?.close()
      } finally {
        await policy.dispose()
      }
      throw error
    }
  }
}
