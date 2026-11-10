/**
 * 提供方 `deepseek`（01 §4.1）：灵鲸自建的默认 agent，作为独立进程的 CLI 接进 `ctx.brains`。每个会话一个
 * `liwa --profile deepseek` 进程，`LIWA_HOME` 指到成员配置目录下该会话自己的 `deepseek/<会话号>/`（转录、
 * profile、会话 patch 都在里面）；续接 = 同一目录重拉进程 + `session/resume`；关会话时进程一起关。
 * @module @liwa/brain-deepseek/provider
 */

import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  BrainError, mergeLaunchEnv,
  type BrainLaunchContext, type BrainProbeContext, type BrainProbeResult, type BrainProviderSession, type ImplId, type Meta,
  type ResumeHandle, type SessionConfig,
} from '@liwa/brain'
import { AcpBrainProvider, toPaseoLaunchContext, toPaseoSessionConfig } from '@liwa/brain-acp'
import type { AgentLaunchContext, AgentSession, AgentSessionConfig } from '@liwa/brain-shared/paseo/agent/agent-sdk-types'
import { LIWA_METHODS, type LiwaSessionMeta } from '@liwa/deepseek-app'
import { LiwaChannel, type DeepseekACPAgentClient } from './client.ts'
import { DeepseekBrainSession } from './session.ts'
import { sessionInstructions, writeRules, writeSessionPatch, type SessionPatchSettings } from './session-patch.ts'

/** 会话 home 下给 `LIWA_AGENTS_HOME` 的空目录：子进程不读主人的 `~/.agents`（01 §4.6 只读灵鲸管理的配置）。 */
export const AGENTS_HOME_DIR = 'agents'

/** 拉起时要的凭据与环境。 */
export interface DeepseekLaunchEnv {
  /**
   * 这一次拉起给进程的环境项：密钥（按名字注入）、转发的端点等。
   * @returns 环境项。
   * @throws {BrainError} `auth`：密钥没配。
   */
  resolve(): Promise<Record<string, string>>
}

/** {@link DeepseekBrainProvider} 的构造项。 */
export interface DeepseekBrainProviderInit {
  /** 实现名（默认 `deepseek`）。 */
  impl: ImplId
  /** 客户端。 */
  client: DeepseekACPAgentClient
  /** 会话 patch 的部署项。 */
  patch: SessionPatchSettings
  /** 拉起时的凭据与环境。 */
  env: DeepseekLaunchEnv
  /** 安装的版本（报给 `probe`）。 */
  version: string | undefined
  /** 这个安装起不了 `liwa` 的原因；给了就 `probe` 报不可用、开会话回 `unavailable`。 */
  launcherProblem?: string
}

/**
 * `deepseek` 的能力声明：插话（`_liwa/steer`）、保留队列的取消、续接、子会话观察、服务端落实的回合预算与收尾、
 * 按会话配置的原生工具 / 压缩 / 仓库指令 / 规矩 / 本事、换模型（标准 `session/set_config_option`）、模式（干活预设里
 * 的计划模式，标准 ACP 会话模式）都是真的；没有原生的下一回合队列，`next_turn` 由投递器在回合边界补。
 */
export const DEEPSEEK_META: Meta = {
  streaming: true,
  resume: true,
  nativeTools: false,
  permissionHook: true,
  rollback: false,
  modelSwitch: true,
  modeSwitch: true,
  delivery: { nextStep: true, nextTurn: false, cancelKeepsQueue: true },
  compaction: 'switchable',
  budget: { inferences: true, toolCalls: true, concludeOn: true },
  usage: 'tokens',
  personaInjection: { instance: 'system_prompt' },
  agentConfig: { plugins: false, hooks: false, instructions: true },
  thinkingSwitch: false,
  runtime: 'subprocess',
  transport: 'acp',
  kernelTools: ['mcp-http', 'mcp-stdio'],
  binary: { command: 'liwa' },
  children: { native: 'observe', crossCli: true },
  extensions: [LIWA_METHODS.steer, LIWA_METHODS.usage, LIWA_METHODS.children],
}

/**
 * 契约会话配置 → `session/new` 的 `_meta.liwa`。
 * @param config - 这一代的会话配置。
 * @returns `_meta.liwa`。
 */
export function liwaSessionMeta(config: SessionConfig): LiwaSessionMeta {
  return {
    mindKind: config.mindKind,
    owner: config.owner,
    notes: config.persona.notes,
    version: config.persona.version,
    limits: {
      maxInferencesPerTurn: config.limits.maxInferencesPerTurn,
      maxToolCallsPerTurn: config.limits.maxToolCallsPerTurn,
      watchdogMs: config.limits.watchdogMs,
    },
    concludeOn: [...config.concludeOn],
    ...(config.model === undefined ? {} : { model: config.model }),
    nativeToolPolicy: config.nativeToolPolicy,
    childPolicy: {
      native: config.childPolicy.native,
      maxDepth: config.childPolicy.maxDepth,
      maxConcurrent: config.childPolicy.maxConcurrent,
    },
  }
}

/** 提供方 `deepseek`。 */
export class DeepseekBrainProvider extends AcpBrainProvider {
  private readonly deepseek: DeepseekACPAgentClient
  private readonly patch: SessionPatchSettings
  private readonly env: DeepseekLaunchEnv
  private readonly version: string | undefined
  private readonly launcherProblem: string | undefined

  /**
   * @param init - 实现名、客户端、会话 patch 部署项、凭据与环境、安装版本。
   */
  constructor(init: DeepseekBrainProviderInit) {
    // liwa 把会话的 MCP 工具全部直接挂上（没有工具搜索后的延迟加载），`alwaysLoad` 天然满足。
    super({ impl: init.impl, meta: DEEPSEEK_META, client: init.client, sessionHome: 'per-session', defersMcpTools: false })
    this.deepseek = init.client
    this.patch = init.patch
    this.env = init.env
    this.version = init.version
    this.launcherProblem = init.launcherProblem
  }

  /** @inheritdoc */
  override async probe(_context: BrainProbeContext): Promise<BrainProbeResult> {
    const problems: string[] = []
    if (this.launcherProblem !== undefined) problems.push(this.launcherProblem)
    else if (!await this.client.isAvailable()) problems.push('the liwa launcher of this installation is not executable')
    try {
      await this.env.resolve()
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error))
    }
    return { available: problems.length === 0, ...(this.version === undefined ? {} : { version: this.version }), problems }
  }

  /** @inheritdoc */
  protected override sessionConfig(config: SessionConfig): AgentSessionConfig {
    // 模型经 `_meta.liwa.model` 给服务端选，不经标准的配置项切换。
    return toPaseoSessionConfig(this.client.provider, config, false)
  }

  /**
   * 开会话前核对 deepseek 落实不了的组合，免得模型拿到的与配置不一致：原生工具全关时本事读不了（`skill` 是原生
   * 工具）、子会话开不了（`subagent` 是原生工具）；只读时子会话开不了（子会话的工具不受父会话的只读约束）；本事目录
   * 必须是目录。
   * @param config - 这一代的会话配置。
   * @throws {BrainError} `invalid_input`。
   */
  private async admitPolicy(config: SessionConfig): Promise<void> {
    if (config.nativeToolPolicy === 'none' && config.skillsDir !== '') {
      throw new BrainError('invalid_input', 'brain.deepseek_policy_conflict', `${this.impl}: skills are loaded through the native skill tool, which nativeToolPolicy "none" removes; give no skillsDir or allow native tools`)
    }
    if (config.nativeToolPolicy !== 'worktree' && config.childPolicy.native) {
      throw new BrainError('invalid_input', 'brain.deepseek_policy_conflict', `${this.impl}: native child agents need nativeToolPolicy "worktree" (they would not inherit the ${config.nativeToolPolicy} limit); set childPolicy.native to false`)
    }
    if (config.skillsDir !== '') {
      const info = await stat(config.skillsDir).catch(() => undefined)
      if (info?.isDirectory() !== true) {
        throw new BrainError('invalid_input', 'brain.skills_dir_missing', `${this.impl}: skillsDir ${config.skillsDir} is not a readable directory`)
      }
    }
  }

  /**
   * 一次拉起的 Paseo 启动上下文：写好这一代的会话 patch 与规矩文件，`LIWA_HOME` 指到会话 home，`LIWA_AGENTS_HOME`
   * 指到会话 home 里的空目录，密钥按名字注入，`SessionConfig.env` 一并给（与这些重名时拒绝）。
   * @param launch - 契约启动上下文（home 已建好）。
   * @param config - 这一代的会话配置。
   * @returns Paseo 启动上下文。
   */
  protected override async launchContext(launch: BrainLaunchContext, config: SessionConfig): Promise<AgentLaunchContext> {
    const agentsHome = join(launch.homeDir, AGENTS_HOME_DIR)
    await mkdir(agentsHome, { recursive: true })
    await writeSessionPatch(launch.homeDir, config, this.patch)
    await writeRules(launch.homeDir, sessionInstructions(config))
    const owned = { ...await this.env.resolve(), LIWA_HOME: launch.homeDir, LIWA_AGENTS_HOME: agentsHome }
    return toPaseoLaunchContext(launch, mergeLaunchEnv(this.impl, owned, config.env))
  }

  /** @inheritdoc */
  override async createSession(config: SessionConfig, launch: BrainLaunchContext): Promise<BrainProviderSession> {
    return this.open(config, launch, async (paseoConfig, paseoLaunch) => this.client.createSession(paseoConfig, paseoLaunch))
  }

  /** @inheritdoc */
  override async resumeSession(
    handle: ResumeHandle,
    config: SessionConfig,
    launch: BrainLaunchContext,
  ): Promise<BrainProviderSession> {
    const persisted = {
      provider: this.client.provider,
      sessionId: handle.sessionRef,
      ...(handle.nativeHandle === undefined ? {} : { nativeHandle: handle.nativeHandle }),
    }
    return this.open(config, launch, async (paseoConfig, paseoLaunch) => this.client.resumeSession(persisted, paseoConfig, paseoLaunch))
  }

  private async open(
    config: SessionConfig,
    launch: BrainLaunchContext,
    start: (paseoConfig: AgentSessionConfig, paseoLaunch: AgentLaunchContext) => Promise<AgentSession>,
  ): Promise<BrainProviderSession> {
    if (this.launcherProblem !== undefined) throw new BrainError('unavailable', 'brain.liwa_launcher_missing', this.launcherProblem)
    this.admit(config)
    await this.admitPolicy(config)
    // 通道在拉起前备好：握手期间的入站消息先缓存，会话包好后交给它。
    const channel = new LiwaChannel(liwaSessionMeta(config))
    const release = this.deepseek.prepareChannel(launch.sessionId, channel)
    let session: AgentSession
    try {
      session = await start(this.sessionConfig(config), await this.launchContext(launch, config))
    } finally {
      release()
    }
    const wrapped = new DeepseekBrainSession({ impl: this.impl, meta: this.meta, session, blobs: launch }, channel)
    await this.ensureMode(session, wrapped, config)
    return wrapped
  }
}
