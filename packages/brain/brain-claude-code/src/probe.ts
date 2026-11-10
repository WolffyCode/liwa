/**
 * 探测与运行共用外部可执行路径，绝不使用 SDK 捆绑 CLI。
 * @module @liwa/brain-claude-code/probe
 */
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrainError, execProviderCommand, type BrainProcessHost } from '@liwa/brain'
import { sdkEnvironmentOverlay } from './process.ts'
import { parseClaudeCodeVersion } from './paseo/agent/providers/claude/model-manifest.ts'
import { claudeParentEnvironment, type Config } from './config.ts'

/** 任务协议、PostToolBatch 与隔离参数的第一版基线。 */
export const MIN_CLAUDE_VERSION = '2.1.318'

/**
 * 解析并探测同一个外部二进制；只运行 --version。
 * @param host - 受管进程入口。
 * @param config - 命令与探测预算。
 * @param signal - 可选取消。
 * @returns 路径及实际版本。
 */
export async function resolveClaudeExecutable(
  host: BrainProcessHost, config: Config, signal?: AbortSignal,
): Promise<{ path: string; version: string }> {
  const executable = await host.resolveExecutable(config.binary, undefined, signal)
  const dir = await mkdtemp(join(tmpdir(), 'liwa-claude-probe-'))
  const probe = async (): Promise<{ path: string; version: string }> => {
    await mkdir(join(dir, 'home'))
    const env = claudeParentEnvironment()
    Object.assign(env, { HOME: join(dir, 'home'), USERPROFILE: join(dir, 'home'), CLAUDE_CONFIG_DIR: dir })
    const result = await execProviderCommand(host, executable, [...config.binaryArgs, '--version'], { timeout: config.probeTimeoutMs, graceMs: config.graceMs, envOverlay: sdkEnvironmentOverlay(env), ...(signal === undefined ? {} : { signal }) })
    const text = result.stdout.trim()
    const parsed = /\d+\.\d+\.\d+\s+\(Claude Code\)/i.test(text) ? parseClaudeCodeVersion(text) : null
    if (parsed === null) throw new BrainError('unavailable', 'brain.claude_version', 'The selected binary did not report a Claude Code version')
    const version = parsed.join('.')
    const minimum = [2, 1, 318]
    const difference = parsed.map((part, index) => part - (minimum[index] as number)).find(part => part !== 0)
    if (difference !== undefined && difference < 0) throw new BrainError('unavailable', 'brain.claude_version', `Claude Code ${version} is older than required ${MIN_CLAUDE_VERSION}`)
    return { path: executable, version }
  }
  try {
    return await probe()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
