/**
 * 探测与运行共用外部可执行路径，绝不使用 SDK 捆绑 CLI。
 * @module @liwa/brain-claude-code/probe
 */
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrainError, JsonValueSchema, execProviderCommand, type JsonValue, type BrainProbeContext, type BrainProbeResult, type BrainProcessHost } from '@liwa/brain'
import { ClaudeDiagnostics } from './diagnostics.ts'
import { sdkEnvironmentOverlay } from './process.ts'
import { parseClaudeCodeVersion } from './paseo/agent/providers/claude/model-manifest.ts'
import { claudeParentEnvironment, instanceSecrets, type Config } from './config.ts'

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

/**
 * 静态探测不启动进程；只有显式要求时在临时空壳里查 auth status。
 * @param host - 受管探测上下文。
 * @param config - 提供方实例。
 * @returns 脱敏后的认证事实与可用性。
 */
export async function probeClaude(host: BrainProbeContext, config: Config): Promise<BrainProbeResult> {
  const diagnostics = new ClaudeDiagnostics(instanceSecrets(config))
  const variable = config.env['ANTHROPIC_API_KEY'] ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN'
  const baseUrl = config.env['ANTHROPIC_BASE_URL']
  const auth: NonNullable<BrainProbeResult['auth']> = { variable, ...(baseUrl === undefined ? {} : { baseUrl }) }
  const problems: string[] = []
  let executable: string
  try {
    executable = await diagnostics.protect(() => host.resolveExecutable(config.binary, undefined, host.signal))
  } catch (error) {
    return { available: false, auth, problems: [diagnostics.redact(String(error))] }
  }
  if (!host.checkAuth) return { available: true, auth, problems }
  const dir = await mkdtemp(join(tmpdir(), 'liwa-claude-auth-'))
  const check = async (): Promise<void> => {
    await mkdir(join(dir, 'home'), { mode: 0o700 })
    const env = { ...claudeParentEnvironment(), ...config.env, HOME: join(dir, 'home'), USERPROFILE: join(dir, 'home'), CLAUDE_CONFIG_DIR: dir, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }
    const output = await diagnostics.protect(() => execProviderCommand(host, executable, [...config.binaryArgs, 'auth', 'status'], {
      cwd: dir, timeout: config.probeTimeoutMs, graceMs: config.graceMs, envOverlay: sdkEnvironmentOverlay(env),
      ...(host.signal === undefined ? {} : { signal: host.signal }),
    }))
    const text = diagnostics.redact(output.stdout)
    let status: JsonValue
    try {
      status = JsonValueSchema.parse(JSON.parse(text))
    } catch (_invalidAuthJson) {
      throw new BrainError('unavailable', 'brain.claude_auth_json', 'claude auth status did not return valid JSON')
    }
    const loggedOut = typeof status === 'object' && status !== null && !Array.isArray(status) && status['loggedIn'] === false
    auth.check = { ok: !loggedOut, status }
    if (loggedOut) problems.push('claude auth status reports not authenticated; check the instance env')
  }
  try {
    await check()
  } catch (error) {
    const message = diagnostics.redact(String(error))
    auth.check = { ok: false, problem: message }
    problems.push(message)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  return { available: problems.length === 0, auth, problems }
}
