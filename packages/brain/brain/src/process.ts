/**
 * 提供方拉 CLI 用的进程帮助：找可执行文件、跑完一条短命令、以原始管道拉起常驻 CLI。提供方只经
 * `ctx.subprocess` 碰进程，大脑会话还要先登记归属再交给 seam，所以这里的函数都只收一个
 * {@link ProviderProcessHost}（会话里就是 `BrainLaunchContext`，探测时就是 `BrainProbeContext`）。
 * 函数名与失败形状照 Paseo 的 `findExecutable` / `execCommand` / `spawnProcess`，迁来的 Paseo 代码在调用点
 * 原地换成这里的同名能力即可。
 * @module @liwa/brain/process
 */

import { SubprocessExecutableNotFoundError } from '@liwa/subprocess'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@liwa/subprocess'
import { BrainError } from './errors.ts'

/**
 * 提供方代码要用的两项子进程操作。大脑会话经启动上下文给出登记归属的实现；会话之外做可用性探测的
 * 提供方插件直接传 `ctx.subprocess`。
 */
export type ProviderProcessHost = Pick<SubprocessRuntime, 'resolveExecutable' | 'spawn'>

/**
 * 按 Paseo `findExecutable` / `executableExists` 的口径找可执行文件：找到给路径，subprocess 证明不存在给
 * `null`；其他失败（传输、取消）照常抛出。
 * @param host - 提供方执行环境里的子进程操作。
 * @param command - 绝对路径或 PATH 上的名字。
 * @param env - 查找时考虑的显式环境项。
 * @param signal - 取消查找。
 * @returns 规范化路径，或找不到时的 `null`。
 */
export async function findProviderExecutable(
  host: ProviderProcessHost,
  command: string,
  env?: Readonly<Record<string, string | undefined>>,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    return await host.resolveExecutable(command, definedEntries(env), signal)
  } catch (error) {
    if (error instanceof SubprocessExecutableNotFoundError) return null
    throw error
  }
}

/** {@link execProviderCommand} 的选项：Paseo `execCommand` 选项里调用方实际用到的那部分。 */
export interface ProviderCommandOptions {
  /** 工作目录；省略时取当前进程目录，与 Paseo 相同。 */
  cwd?: string
  /** 垫在 {@link envOverlay} 下面的环境项；两者都在 seam 剥净父环境之后合并。 */
  baseEnv?: Readonly<Record<string, string | undefined>>
  /** 显式环境项；`undefined` 去掉一个继承来的名字。 */
  envOverlay?: Readonly<Record<string, string | undefined>>
  /** 超过这么多毫秒就终止命令，并以 `killed: true` 拒绝。 */
  timeout?: number
  /** 每条输出流的内存上限；超出保留尾部，不报错。 */
  maxBuffer?: number
  /** 取消命令。 */
  signal?: AbortSignal
  /** 交给 subprocess 终止阶梯的宽限期。 */
  graceMs?: number
}

/** 以 0 退出的命令收集到的输出。 */
export interface ProviderCommandResult {
  /** 收集到的标准输出。 */
  stdout: string
  /** 收集到的标准错误。 */
  stderr: string
}

/** 与 Node `execFile` 错误同形的失败，Paseo 的诊断按这个形状格式化。 */
export class ProviderCommandError extends Error {
  /** 跑了但失败的退出码；被信号杀死时为 `null`。 */
  readonly code: number | null
  /** 是否被超时或调用方的信号终止。 */
  readonly killed: boolean
  /** 退出时收集到的标准输出。 */
  readonly stdout: string
  /** 退出时收集到的标准错误。 */
  readonly stderr: string

  /**
   * @param message - 给人看的失败说明。
   * @param facts - 退出事实与收集到的输出。
   * @param facts.code - 退出码；被信号杀死时为 `null`。
   * @param facts.killed - 是否被超时或取消终止。
   * @param facts.stdout - 收集到的标准输出。
   * @param facts.stderr - 收集到的标准错误。
   */
  constructor(message: string, facts: { code: number | null; killed: boolean; stdout: string; stderr: string }) {
    super(message)
    this.name = 'ProviderCommandError'
    this.code = facts.code
    this.killed = facts.killed
    this.stdout = facts.stdout
    this.stderr = facts.stderr
  }
}

/** 调用方没给 `maxBuffer` 时的输出上限（Paseo `execCommand` 的默认是 1 MiB）。 */
const DEFAULT_MAX_BUFFER = 1024 * 1024
/** 调用方没给宽限期时，短命探测命令的终止宽限期。 */
const PROBE_GRACE_MS = 1_000

/**
 * 经 subprocess seam 把一条短命令跑完，替代 Paseo `utils/spawn` 的 `execCommand`。以 0 退出时给出
 * 收集到的输出；否则以 {@link ProviderCommandError} 拒绝。拉起本身失败（例如可执行文件不存在）时
 * 以 seam 自己的错误拒绝。
 * @param host - 提供方执行环境里的子进程操作。
 * @param command - 可执行路径或 PATH 上的名字。
 * @param args - 参数，从不经 shell 解释。
 * @param options - 目录、环境、超时、输出上限与取消。
 * @returns 收集到的标准输出与标准错误。
 */
export async function execProviderCommand(
  host: ProviderProcessHost,
  command: string,
  args: readonly string[],
  options: ProviderCommandOptions = {},
): Promise<ProviderCommandResult> {
  const maxBytes = options.maxBuffer ?? DEFAULT_MAX_BUFFER
  if (options.signal?.aborted === true) {
    throw new ProviderCommandError(`Command failed: ${[command, ...args].join(' ')} (cancelled before start)`, {
      code: null,
      killed: true,
      stdout: '',
      stderr: '',
    })
  }
  const stop = new AbortController()
  // 用对象记"已终止"：它在回调里被改，读成属性免得类型收窄误判。
  const state = { killed: false }
  const kill = (): void => {
    state.killed = true
    stop.abort()
  }
  const timer = options.timeout === undefined ? undefined : setTimeout(kill, options.timeout)
  options.signal?.addEventListener('abort', kill, { once: true })
  try {
    const spec: SubprocessSpawnSpec = {
      argv: [command, ...args],
      cwd: options.cwd ?? process.cwd(),
      stdio: { stdin: 'ignore', stdout: { maxBytes }, stderr: { maxBytes } },
      graceMs: options.graceMs ?? PROBE_GRACE_MS,
      signal: stop.signal,
      env: { ...options.baseEnv, ...options.envOverlay },
    }
    const handle = host.spawn(spec)
    const outcome = await handle.done
    const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    if (outcome.exitCode === 0 && !state.killed) return { stdout, stderr }
    const reason = state.killed
      ? `terminated after ${options.timeout === undefined ? 'cancellation' : `${String(options.timeout)}ms`}`
      : outcome.exitCode === null ? `killed by ${String(outcome.signal)}` : `exited with code ${String(outcome.exitCode)}`
    throw new ProviderCommandError(`Command failed: ${[command, ...args].join(' ')} (${reason})`, {
      code: outcome.exitCode,
      killed: state.killed,
      stdout,
      stderr,
    })
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    options.signal?.removeEventListener('abort', kill)
  }
}

/**
 * 以原始管道拉起一个常驻的提供方 CLI，替代 Paseo `utils/spawn` 的 `spawnProcess`。返回流上的协议分帧
 * 归调用方；停进程用 {@link SubprocessHandle.terminate}（Paseo 用 `tree-kill`，seam 本来就终止整个受管范围）。
 * @param host - 子进程操作；大脑会话的启动上下文会先登记归属。
 * @param command - 可执行路径或 PATH 上的名字。
 * @param args - 参数，从不经 shell 解释。
 * @param options - 目录、环境、宽限期与取消。
 * @param options.cwd - CLI 的工作目录。
 * @param options.env - 在 seam 剥净父环境之后合并的显式环境项；`undefined` 去掉一个名字。
 * @param options.graceMs - 受管范围的终止宽限期。
 * @param options.signal - 中止时开始终止。
 * @param options.stderr - `'pipe'` 读 stderr，或给一个有界收集器留诊断尾巴。
 * @returns 活着的句柄，带 `stdin`、`stdout` 与所选的 stderr 处置。
 */
export function spawnProviderProcess(
  host: ProviderProcessHost,
  command: string,
  args: readonly string[],
  options: {
    cwd: string
    env?: Readonly<Record<string, string | undefined>>
    graceMs: number
    signal?: AbortSignal
    stderr?: 'pipe' | { maxBytes: number }
  },
): SubprocessHandle {
  return host.spawn({
    argv: [command, ...args],
    cwd: options.cwd,
    stdio: { stdin: 'pipe', stdout: 'pipe', stderr: options.stderr ?? 'pipe' },
    graceMs: options.graceMs,
    signal: options.signal,
    env: { ...options.env },
  })
}

/**
 * 去掉 `undefined` 项（按名字查找表达不了墓碑）。
 * @param env - 可能有空洞的环境表。
 * @returns 只含字符串值的环境项；没给时为 `undefined`。
 */
function definedEntries(env: Readonly<Record<string, string | undefined>> | undefined): Record<string, string> | undefined {
  if (env === undefined) return undefined
  const entries: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) if (value !== undefined) entries[key] = value
  return entries
}

/**
 * 一个会话的 CLI 进程环境：提供方自己要注入的变量（密钥、home、端点）加调用方经 `SessionConfig.env` 给的额外项。
 * 两边重名时大声失败，不让调用方的值悄悄盖掉提供方的隔离与凭据，也不让提供方悄悄吞掉调用方的值。
 * @param impl - 提供方（写进错误）。
 * @param owned - 提供方注入的变量。
 * @param extra - `SessionConfig.env`。
 * @returns 合并后的环境项。
 * @throws {BrainError} `invalid_input`：`SessionConfig.env` 与提供方注入的变量重名。
 */
export function mergeLaunchEnv(
  impl: string,
  owned: Readonly<Record<string, string>>,
  extra: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const clashes = Object.keys(extra ?? {}).filter(name => Object.hasOwn(owned, name))
  if (clashes.length > 0) {
    throw new BrainError('invalid_input', 'brain.env_clash', `SessionConfig.env sets ${clashes.join(', ')}, which brain provider ${impl} injects itself; drop them from env`)
  }
  return { ...extra, ...owned }
}
