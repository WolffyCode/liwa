/**
 * 提供方 `deepseek` 的 cordis 插件：把同一安装里的 `liwa --profile deepseek`（`@liwa/deepseek-app`）作为
 * 独立进程的 CLI 登记进 `ctx.brains`。客户端是 `@liwa/brain-acp` 的 ACP 客户端子类加 `_liwa` 三个方法；
 * 密钥按名字从凭据服务（或启动环境）读，经环境注入子进程，不落盘。
 * @module @liwa/brain-deepseek
 */

import type { Context } from '@liwa/cordis'
import z from '@liwa/schemastery'
import { BrainError, ImplId } from '@liwa/brain'
import { paseoLogger } from '@liwa/brain-shared'
import { credentialRef } from '@liwa/credentials'
import { launchEnvironmentOf } from '@liwa/launch-environment'
import type {} from '@liwa/app-boot'
import { DeepseekACPAgentClient } from './client.ts'
import { resolveLiwaLauncher, runsFromSource, type LiwaLauncher } from './launcher.ts'
import { DeepseekBrainProvider, type DeepseekLaunchEnv } from './provider.ts'

export { DeepseekACPAgentClient, LiwaChannel } from './client.ts'
export { resolveLiwaLauncher, runsFromSource, type LiwaLauncher } from './launcher.ts'
export { AGENTS_HOME_DIR, DEEPSEEK_META, DeepseekBrainProvider, liwaSessionMeta, type DeepseekLaunchEnv } from './provider.ts'
export { DeepseekBrainSession, fromLiwaUsage } from './session.ts'
export { RULES_FILE, SESSION_PATCH_FILE, sessionPatchRows, writeRules, writeSessionPatch, type SessionPatchSettings } from './session-patch.ts'

/** 稳定的 cordis 插件名。 */
export const name = 'brain-deepseek'

/** 登记进 `ctx.brains`，进程经 `ctx.subprocess`。 */
export const inject = ['brains', 'subprocess']

/** 进程的 profile；命令固定为 `liwa --profile deepseek`。 */
export const DEEPSEEK_PROFILE = 'deepseek'

/** `deepseek` 提供方的配置。 */
export interface Config {
  /** 在 `ctx.brains` 里的实现名。 */
  impl: string
  /**
   * 起 `liwa` 的 argv（不含 `--profile`）；留空用本体所在的安装（构建产物，或从源码跑时的源码入口）。
   * 测试或换安装时显式给。
   */
  launcher: string[]
  /** 显式 `launcher` 要的环境项（例如源码入口的 `TSX_TSCONFIG_PATH`）。 */
  launcherEnv: Record<string, string>
  /** 模型路由读密钥的环境变量名；值从凭据服务或启动环境读，按这个名字注入子进程。 */
  apiKeyEnv: string
  /** 启动环境里有就原样转给子进程的变量名（例如自定端点）。 */
  forwardEnv: string[]
  /** 显式给子进程的其余环境项。 */
  env: Record<string, string>
  /** 会话 patch 里的模型路由（`agent-default-model` 的 provider）。 */
  provider: string
  /** 会话种类对应的预设 id 前缀（与 `deepseek-app` 的预设一致）。 */
  presetPrefix: string
  /** 仓库指令与灵鲸规矩每条链的字节上限（会话 patch 里 `agent-instructions.maxBytes`）。 */
  instructionsMaxBytes: number
}

export const Config: z<Config> = z.object({
  impl: z.string().default('deepseek'),
  launcher: z.array(z.string()).default([]),
  launcherEnv: z.dict(z.string()).default({}),
  apiKeyEnv: z.string().default('DEEPSEEK_API_KEY'),
  forwardEnv: z.array(z.string()).default(['DEEPSEEK_BASE_URL']),
  env: z.dict(z.string()).default({}),
  provider: z.string().default('deepseek-official'),
  presetPrefix: z.string().default('deepseek-'),
  instructionsMaxBytes: z.natural().min(1).default(65_536),
})

/** 本体不是由 liwa 启动器起的时候（没有安装位置可读），用 PATH 上的 `liwa`。 */
const PATH_LAUNCHER: LiwaLauncher = { argv: ['liwa'], patches: [], env: {}, version: undefined }

/** 一次起法的解析结果：起法，或安装里起不了 `liwa` 的原因。 */
type LauncherResolution = { launcher: LiwaLauncher; problem?: undefined } | { launcher?: undefined; problem: string }

/**
 * 这一次的 `liwa` 起法：显式配置优先，其次本体所在的安装，最后 PATH 上的 `liwa`（找不到时 `probe` 报不可用）。
 * 安装里既没有构建产物也没有源码入口（例如浏览器 Worker 里的打包部署）时不抛：提供方照样登记，`probe` 报
 * 不可用，开会话回 `unavailable`，插件树的其余部分不受影响。
 * @param ctx - 插件上下文（读启动器给的安装位置）。
 * @param config - 插件配置。
 * @returns 起法，或起不了的原因。
 */
function launcherFor(ctx: Context, config: Config): LauncherResolution {
  const [executable, ...args] = config.launcher
  if (executable !== undefined) {
    return { launcher: { argv: [executable, ...args], patches: [], env: config.launcherEnv, version: undefined } }
  }
  const installAnchor = ctx.get('profileContext')?.installAnchor
  if (installAnchor === undefined) return { launcher: PATH_LAUNCHER }
  try {
    return { launcher: resolveLiwaLauncher(installAnchor, runsFromSource(installAnchor, process.argv[1]), () => import.meta.resolve('tsx/esm')) }
  } catch (error) {
    if (error instanceof BrainError) return { problem: error.message }
    throw error
  }
}

/**
 * 登记提供方 `deepseek`；插件卸载时登记与它开着的会话（及其进程）一起释放。
 * @param ctx - 插件上下文。
 * @param config - 校验过的配置。
 */
export function apply(ctx: Context, config: Config): void {
  const resolution = launcherFor(ctx, config)
  // 起不了时客户端拿一个永远不会被执行的占位命令：提供方在拉起之前就以 `unavailable` 拒绝。
  const launcher = resolution.launcher ?? PATH_LAUNCHER
  const command: [string, ...string[]] = [
    ...launcher.argv,
    '--profile', DEEPSEEK_PROFILE,
    ...launcher.patches.flatMap(patch => ['--patch', patch]),
  ]
  const client = new DeepseekACPAgentClient({
    logger: paseoLogger(ctx.logger('brain-deepseek')),
    command,
    env: { ...launcher.env },
    processHost: ctx.subprocess,
  })
  const env: DeepseekLaunchEnv = {
    async resolve() {
      const launchEnv = launchEnvironmentOf(ctx)
      const credentials = ctx.get('credentials')
      const key = credentials === undefined
        ? launchEnv.get(config.apiKeyEnv)?.value
        : (await credentials.resolve(credentialRef(config.apiKeyEnv)))?.value
      if (key === undefined || key === '') {
        throw new BrainError('auth', 'brain.deepseek_key_missing', `${config.apiKeyEnv} is not configured; add the DeepSeek API key on the Models page or export ${config.apiKeyEnv}`)
      }
      const forwarded: Record<string, string> = {}
      for (const name of config.forwardEnv) {
        const value = launchEnv.get(name)?.value
        if (value !== undefined && value !== '') forwarded[name] = value
      }
      return { ...forwarded, ...config.env, [config.apiKeyEnv]: key }
    },
  }
  ctx.brains.register(new DeepseekBrainProvider({
    impl: ImplId(config.impl),
    client,
    patch: {
      provider: config.provider,
      apiKeyEnv: config.apiKeyEnv,
      presetPrefix: config.presetPrefix,
      instructionsMaxBytes: config.instructionsMaxBytes,
    },
    env,
    version: launcher.version,
    ...(resolution.problem === undefined ? {} : { launcherProblem: resolution.problem }),
  }))
}
