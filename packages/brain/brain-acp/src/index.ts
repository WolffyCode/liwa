/**
 * 通用 ACP 提供方（01 §4.4）：把任何说 ACP 的 agent CLI（Gemini CLI、OpenCode、Copilot、Cursor…）接进
 * `ctx.brains`。客户端是从 Paseo 迁来、升到 SDK 1.4 的 `ACPAgentClient`（`src/paseo/`），厂商差异按 Paseo 的
 * shim 选（`vendor`）。一行配置一个实例：同一个插件以不同的行 id、`impl` 与命令挂多次，就接多家 CLI。
 * @module @liwa/brain-acp
 */

import type { Context } from '@liwa/cordis'
import z from '@liwa/schemastery'
import { ImplId, type Meta } from '@liwa/brain'
import { paseoLogger, type PaseoLogger } from '@liwa/brain-shared'
import type { ProviderProcessHost } from '@liwa/brain'
import { AcpBrainProvider } from './adapter.ts'
import type { ACPAgentClient } from './paseo/agent/providers/acp-agent.ts'
import { CopilotACPAgentClient } from './paseo/agent/providers/copilot-acp-agent.ts'
import { CursorACPAgentClient } from './paseo/agent/providers/cursor-acp-agent.ts'
import { GenericACPAgentClient, buildVersionProbeCommand } from './paseo/agent/providers/generic-acp-agent.ts'
import { KimiACPAgentClient } from './paseo/agent/providers/kimi-acp-agent.ts'
import { KiroACPAgentClient } from './paseo/agent/providers/kiro-acp-agent.ts'
import { TraeACPAgentClient } from './paseo/agent/providers/trae-acp-agent.ts'

export {
  AcpBrainProvider, AcpBrainSession, toPaseoLaunchContext, toPaseoMcpServers, toPaseoSessionConfig, type AcpBrainProviderInit,
} from './adapter.ts'
export {
  ACPAgentClient, ACPAgentSession, type ACPMetaExtension, type ACPMetaRequestMethod, type ACPObservedMessage,
} from './paseo/agent/providers/acp-agent.ts'
export { GenericACPAgentClient } from './paseo/agent/providers/generic-acp-agent.ts'

/** 稳定的 cordis 插件名。 */
export const name = 'brain-acp'

/** 登记进 `ctx.brains`，进程经 `ctx.subprocess`。 */
export const inject = ['brains', 'subprocess']

/** Paseo 迁来的厂商 shim；`generic` 是任意 ACP CLI。 */
export const ACP_VENDORS = ['generic', 'copilot', 'cursor', 'kimi', 'kiro', 'trae'] as const
/** 厂商 shim。 */
export type AcpVendor = (typeof ACP_VENDORS)[number]

/** 一个通用 ACP 提供方实例的配置。 */
export interface Config {
  /** 在 `ctx.brains` 里的实现名（多实例时各取一个）。 */
  impl: string
  /** 拉起 CLI 的 argv（第一项是可执行文件，从不经 shell）；`copilot` 留空用它的默认 `copilot --acp`。 */
  command: string[]
  /** 显式给 CLI 的环境项（越过 subprocess 对父环境的剥离）。 */
  env: Record<string, string>
  /** 厂商 shim。 */
  vendor: AcpVendor
  /** 给人看的名字（诊断里用）。 */
  label?: string
}

export const Config: z<Config> = z.object({
  impl: z.string().default('acp'),
  command: z.array(z.string()).default([]),
  env: z.dict(z.string()).default({}),
  vendor: z.union([...ACP_VENDORS]).default('generic'),
  label: z.string(),
})

/**
 * 通用 ACP CLI 的能力声明。别家 CLI 的原生工具关不掉、压缩开关不明，按最保守的声明；没有插话通道，
 * `next_step` 恒 `unsupported`。
 * @param command - CLI 的可执行文件。
 * @returns 能力声明。
 */
export function genericAcpMeta(command: string): Meta {
  return {
    streaming: true,
    resume: true,
    nativeTools: true,
    permissionHook: true,
    rollback: false,
    modelSwitch: true,
    modeSwitch: true,
    delivery: { nextStep: false, nextTurn: false, cancelKeepsQueue: false },
    compaction: 'always_on',
    budget: { inferences: false, toolCalls: false, concludeOn: false },
    usage: 'tokens',
    personaInjection: { instance: 'file' },
    runtime: 'subprocess',
    transport: 'acp',
    kernelTools: ['mcp-stdio', 'mcp-http'],
    binary: { command },
    children: { native: 'none', crossCli: true },
  }
}

/**
 * 按厂商造 Paseo 客户端。
 * @param config - 插件配置。
 * @param logger - pino 形状的日志器。
 * @param processHost - 探测与诊断拉进程用的入口。
 * @returns 客户端与它拉起的 argv。
 */
function createClient(
  config: Config,
  logger: PaseoLogger,
  processHost: ProviderProcessHost,
): { client: ACPAgentClient; argv: [string, ...string[]] } {
  const label = config.label
  if (config.vendor === 'copilot') {
    const argv: [string, ...string[]] = config.command.length > 0 ? [config.command[0] as string, ...config.command.slice(1)] : ['copilot', '--acp']
    const client = new CopilotACPAgentClient({
      logger,
      processHost,
      runtimeSettings: {
        env: config.env,
        ...(config.command.length > 0 ? { command: { mode: 'replace' as const, argv } } : {}),
      },
    })
    return { client, argv }
  }
  const [executable, ...args] = config.command
  if (executable === undefined) {
    throw new Error(`brain-acp ${config.impl}: command is required for the ${config.vendor} vendor`)
  }
  const argv: [string, ...string[]] = [executable, ...args]
  const options = {
    logger,
    command: argv,
    env: config.env,
    providerId: config.impl,
    ...(label === undefined ? {} : { label }),
    processHost,
  }
  switch (config.vendor) {
    case 'generic':
      return { client: new GenericACPAgentClient(options), argv }
    case 'cursor':
      return { client: new CursorACPAgentClient(options), argv }
    case 'kimi':
      return { client: new KimiACPAgentClient(options), argv }
    case 'kiro':
      return { client: new KiroACPAgentClient(options), argv }
    case 'trae':
      return { client: new TraeACPAgentClient(options), argv }
  }
}

/**
 * 登记一个通用 ACP 提供方；插件卸载时登记与它开着的会话一起释放。
 * @param ctx - 插件上下文。
 * @param config - 校验过的配置。
 */
export function apply(ctx: Context, config: Config): void {
  const { client, argv } = createClient(config, paseoLogger(ctx.logger('brain-acp'), { impl: config.impl }), ctx.subprocess)
  const probe = buildVersionProbeCommand(argv)
  ctx.brains.register(new AcpBrainProvider({
    impl: ImplId(config.impl),
    meta: genericAcpMeta(argv[0]),
    client,
    versionCommand: [probe.command, ...probe.args],
  }))
}
