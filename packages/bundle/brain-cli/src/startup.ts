/**
 * `liwa brain` 的命令行提供方：解析 `list`、`probe <impl>`、`run --provider <impl> "<提示词>"` 三个子命令与
 * 各自的选项，发布 {@link BRAIN_STARTUP_SERVICE}。命令的执行在 `@liwa/brain-cli` 里，它等这个服务出现。
 * @module @liwa/brain-cli/startup
 */

import { Command, Option } from 'commander'
import type { Context } from '@liwa/cordis'
import { parseCmdline } from '@liwa/cmdline'
import type { PluginManagementRequest } from '@liwa/brain'
import { internals } from './startup-internals.ts'

/** 稳定的 cordis 插件名。 */
export const name = 'brain-cli-startup'

/** 解析命令行之前要有的服务。 */
export const inject = ['cmdlineArgs']

/** 本插件发布、命令执行方注入的服务名。 */
export const BRAIN_STARTUP_SERVICE = 'brainStartup'

/** 回合里的权限请求（含问答）怎么答：在终端问，或按固定选择自动答（`--permit`）。 */
export const PERMIT_POLICIES = ['ask', 'allow-once', 'allow-session', 'deny'] as const
/** 回合里的权限请求怎么答。 */
export type PermitPolicy = (typeof PERMIT_POLICIES)[number]

/** `run` 可选的会话种类。 */
export const RUN_MIND_KINDS = ['instance', 'work', 'think', 'own', 'tidy'] as const

/** 解析出的一条 `liwa brain` 命令。 */
export type BrainCommand =
  | { command: 'list'; json: boolean }
  | { command: 'plugin'; provider: string; request: PluginManagementRequest; json: boolean }
  | { command: 'probe'; impl: string; json: boolean; checkAuth?: boolean }
  | {
    command: 'run'
    provider: string
    prompt: string
    model?: string
    cwd?: string
    /** 提供方的会话模式（Paseo `--mode`，例如 deepseek 的 `plan`）；省略即提供方默认模式。 */
    mode?: string
    thinking?: string
    /** 权限请求与问答的应答策略。 */
    permit: PermitPolicy
    /** 附在提示词后的图片文件。 */
    images: string[]
    member?: string
    mindKind?: (typeof RUN_MIND_KINDS)[number]
    json: boolean
  }

/** 命令执行方从 {@link BRAIN_STARTUP_SERVICE} 读到的东西。 */
export interface BrainStartupValues {
  /** 这次调用的命令。 */
  command: BrainCommand
}

declare module '@liwa/cordis' {
  interface Context {
    /** `liwa brain` 这次调用解析出的命令。 */
    brainStartup: BrainStartupValues
  }
}

/**
 * 本应用的命令：三个子命令、选项与帮助。
 * @param publish - 子命令的 action 解析成功后调用。
 * @returns 新的 commander 程序（测试里一个进程会解析多次）。
 */
function brainCommand(publish: (command: BrainCommand) => void): Command {
  const program = new Command()
    .name('liwa brain')
    .description('Inspect and try the agent CLI providers mounted in this profile.')
    .helpOption('-h, --help', 'show this help')
    .addHelpText('after', `
Examples:
  liwa brain list                                   list providers and probe them
  liwa brain probe claude                           check one provider in detail
  liwa brain run --provider deepseek "hello"        open a session, run one turn, close it
  liwa brain run --provider deepseek --mode plan --permit deny --cwd ./repo "plan the fix"
  liwa brain run --provider deepseek --image ./shot.png "what is in this picture?"
`)
  program.command('list')
    .description('list the registered providers and probe each of them')
    .helpOption('-h, --help', 'show this help')
    .option('--json', 'print one JSON document instead of a table')
    .action((options: { json?: boolean }) => {
      publish({ command: 'list', json: options.json === true })
    })
  program.command('probe')
    .description('probe one provider: availability, version, and problems')
    .helpOption('-h, --help', 'show this help')
    .argument('<impl>', 'provider implementation name')
    .option('--check-auth', 'check authentication with auth status in an isolated temporary home')
    .option('--json', 'print one JSON document instead of text')
    .action((impl: string, options: { json?: boolean; checkAuth?: boolean }) => {
      publish({ command: 'probe', impl, json: options.json === true, ...(options.checkAuth ? { checkAuth: true } : {}) })
    })
  const plugins = program.command('plugin').description('manage the Liwa-owned provider plugin library')
  plugins.command('list').requiredOption('--provider <impl>', 'provider instance').option('--json', 'print JSON')
    .action((options: { provider: string; json?: boolean }) => { publish({ command: 'plugin', provider: options.provider, request: { action: 'list' }, json: options.json === true }) })
  plugins.command('install').argument('<plugin>', '<plugin>@<marketplace>').argument('<source>', 'marketplace source passed to the provider CLI')
    .requiredOption('--provider <impl>', 'provider instance').option('--json', 'print JSON')
    .action((plugin: string, source: string, options: { provider: string; json?: boolean }) => { publish({ command: 'plugin', provider: options.provider, request: { action: 'install', plugin, source }, json: options.json === true }) })
  for (const action of ['update', 'remove'] as const) {
    plugins.command(action).argument('<plugin>', '<plugin>@<marketplace>').requiredOption('--provider <impl>', 'provider instance').option('--json', 'print JSON')
      .action((plugin: string, options: { provider: string; json?: boolean }) => { publish({ command: 'plugin', provider: options.provider, request: { action, plugin }, json: options.json === true }) })
  }
  const run = program.command('run')
    .description('open one session in this process, stream its events, run one turn, and close it')
    .helpOption('-h, --help', 'show this help')
    .requiredOption('--provider <impl>', 'provider implementation name')
    .option('--model <model>', 'model id handed to the provider (default: the provider CLI\'s own default model)')
    .option('--cwd <dir>', 'working directory of the session (default: the current directory)')
    .option('--mode <mode>', 'provider-specific session mode, e.g. plan or default (default: the provider\'s default mode)')
    .option('--thinking <option>', 'thinking option of the chosen model, e.g. high or off (default: the model\'s default)')
    .addOption(new Option('--permit <policy>', 'how permission requests and questions are answered (default: ask on a terminal, deny otherwise)')
      .choices([...PERMIT_POLICIES]))
    .option('--image <file>', 'attach an image (png, jpeg, webp, gif) to the prompt; repeatable', (file: string, files: string[]) => [...files, file], [] as string[])
    .option('--member <name>', 'member that owns the session (default: cli)')
    .addOption(new Option('--mind <kind>', 'session kind (default: work)').choices([...RUN_MIND_KINDS]))
    .option('--json', 'print each event as one JSON line')
    .argument('<prompt...>', 'the prompt; multiple words are joined by spaces')
  run.action((words: string[], options: {
    provider: string
    model?: string
    cwd?: string
    mode?: string
    thinking?: string
    permit?: PermitPolicy
    image: string[]
    member?: string
    mind?: (typeof RUN_MIND_KINDS)[number]
    json?: boolean
  }) => {
    const prompt = words.join(' ')
    if (prompt.trim() === '') run.error('error: a prompt is required, for example: liwa brain run --provider deepseek "hello"')
    const interactive = internals.stdinIsTty()
    if (options.permit === 'ask' && !interactive) {
      run.error('error: --permit ask needs an interactive terminal; choose allow-once, allow-session, or deny')
    }
    publish({
      command: 'run',
      provider: options.provider,
      prompt,
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.mode === undefined ? {} : { mode: options.mode }),
      ...(options.thinking === undefined ? {} : { thinking: options.thinking }),
      permit: options.permit ?? (interactive ? 'ask' : 'deny'),
      images: options.image,
      ...(options.member === undefined ? {} : { member: options.member }),
      ...(options.mind === undefined ? {} : { mindKind: options.mind }),
      json: options.json === true,
    })
  })
  return program
}

/**
 * 解析命令行并把命令发布成普通的 cordis 服务；`--help` 或用法错误时什么也不发布。
 * @param ctx - 带命令行的插件上下文。
 */
export function apply(ctx: Context): void {
  parseCmdline(ctx, brainCommand((command) => {
    ctx.provide(BRAIN_STARTUP_SERVICE, { command } satisfies BrainStartupValues)
  }))
}
