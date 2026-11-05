/**
 * 测试里造 `deepseek` 提供方：从本检出的源码入口起真的 `liwa --profile deepseek`，模型指到脚本化端点。
 * @module @liwa/brain-deepseek/tests/fixtures/provider
 */

import { fileURLToPath } from 'node:url'
import { ImplId } from '@liwa/brain'
import { paseoLogger } from '@liwa/brain-shared'
import type { BrainTestHost } from '@liwa/brain-testkit'
import { DeepseekACPAgentClient, DeepseekBrainProvider, resolveLiwaLauncher } from '../../src/index.ts'

/** 本检出的 `@liwa/cli` 安装位置。 */
export const INSTALL_ANCHOR = fileURLToPath(new URL('../../../../../apps/cli/package.json', import.meta.url))

/**
 * 造一个提供方。
 * @param host - 测试宿主（`ctx.subprocess`）。
 * @param env - 给子进程的环境项（密钥、端点）。
 * @returns 提供方。
 */
export function deepseekProvider(host: BrainTestHost, env: Record<string, string>): DeepseekBrainProvider {
  const launcher = resolveLiwaLauncher(INSTALL_ANCHOR, true, () => import.meta.resolve('tsx/esm'))
  const client = new DeepseekACPAgentClient({
    logger: paseoLogger(host.ctx.logger('brain-deepseek-test')),
    command: [...launcher.argv, '--profile', 'deepseek', ...launcher.patches.flatMap(patch => ['--patch', patch])],
    env: launcher.env,
    processHost: host.ctx.subprocess,
  })
  return new DeepseekBrainProvider({
    impl: ImplId('deepseek'),
    client,
    patch: { provider: 'deepseek-official', apiKeyEnv: 'DEEPSEEK_API_KEY', presetPrefix: 'deepseek-', instructionsMaxBytes: 65_536 },
    env: { resolve: () => Promise.resolve(env) },
    version: launcher.version,
  })
}
