/**
 * `liwa brain` 的命令执行方：`list` 列出并探测已登记的提供方；`probe <impl>` 详细探测一家；
 * `run` 在本进程里开一个会话（`--mode` 是提供方的会话模式，`--image` 附图片），把事件流按行打到 stdout，跑完
 * 一个回合后关会话退出，期间的权限请求与问答按 `--permit` 自动答或在终端问。常驻、多会话管理、断开再连属于
 * 以后的前后端网关，这里不做。
 * @module @liwa/brain-cli
 */

import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import type { Context } from '@liwa/cordis'
import z from '@liwa/schemastery'
import {
  BrainError, ImplId, MemberId, loadAgentsConfig, loadDirectoryConfig, materializeSkills, resolveAgentConfig,
  type BrainEvent, type BrainEventOf, type BrainProbeResult, type BrainSession, type Hooks, type McpServer, type MindKind,
  type PermissionAnswer, type PermissionOption, type PermissionResponse, type SessionConfigInput, type TurnInput,
} from '@liwa/brain'
// 空的类型导入带来 loader 与 cmdline 的 Context 合并（等装配完成、读退出请求）。
import type {} from '@liwa/cordis-plugin-loader'
import type {} from '@liwa/cmdline'
import type { BrainCommand, PermitPolicy } from './startup.ts'
import { internals } from './runner-internals.ts'

/** 稳定的 cordis 插件名。 */
export const name = 'brain-cli'

/** 开始执行之前要有的服务。 */
export const inject = ['brains', 'brainStartup']

/** `run` 开会话时用的回合预算与会话缺省值（以后由 minds 与 roster 给）。 */
export interface Config {
  /** 每回合推理次数上限。 */
  maxInferencesPerTurn: number
  /** 每回合工具调用次数上限。 */
  maxToolCallsPerTurn: number
  /** 回合看门狗（毫秒）。 */
  watchdogMs: number
  /** 成功调用即结束回合的工具。 */
  concludeOn: string[]
  /** 全局 agent 配置集的根目录（`$LIWA_HOME/agents`）；空串表示不读。 */
  agentsRoot: string
}

export const Config: z<Config> = z.object({
  maxInferencesPerTurn: z.natural().min(1).default(32),
  maxToolCallsPerTurn: z.natural().min(1).default(64),
  watchdogMs: z.natural().min(1).default(600_000),
  concludeOn: z.array(z.string()).default(['report']),
  agentsRoot: z.string().default(''),
})

/** 进程侧的效果：输出流与启动器的退出请求。 */
interface BrainCliIo {
  stdout: { write(chunk: string): unknown }
  stderr: { write(chunk: string): unknown }
  ask: (question: string) => Promise<string>
  exit(code: number): void
}

type RunCommand = Extract<BrainCommand, { command: 'run' }>

/** `run` 从全局 agent 配置集为这家实例选出并物化的东西。 */
export interface RunAgents {
  /** 物化好的本事目录；空串表示没有本事。 */
  skillsDir: string
  mcpServers: Record<string, McpServer>
  plugins: string[]
  agents?: string[]
  commands?: string[]
  hooks: Hooks
  instructions: string
}

/**
 * `run` 的请求解析成完整的会话配置：命令行没给的项在这里显式取缺省值。
 * @param command - `run` 命令。
 * @param config - 插件配置里的回合预算。
 * @param configDir - `prepareConfigDir` 给的成员配置目录。
 * @param agents - 全局 agent 配置集为这家实例选出的配置；没有根目录时省略。
 * @returns 会话配置输入。
 */
export function resolveRunSession(command: RunCommand, config: Config, configDir: string, agents?: RunAgents): SessionConfigInput {
  const mindKind: MindKind = command.mindKind ?? 'work'
  return {
    member: command.member ?? 'cli',
    mindKind,
    owner: { taskId: `cli-run-${randomUUID()}`, gen: 1 },
    persona: { stable: '', notes: '', version: 'cli' },
    cwd: resolve(command.cwd ?? process.cwd()),
    dataDir: resolve(configDir, 'cli-runs'),
    nativeToolPolicy: 'worktree',
    // 不给 --model 就不传模型，所用 CLI 用它自己的默认模型（不传占位值）。
    ...(command.model === undefined ? {} : { model: command.model }),
    ...(command.mode === undefined ? {} : { modeId: command.mode }),
    ...(command.thinking === undefined ? {} : { thinking: command.thinking }),
    limits: {
      maxInferencesPerTurn: config.maxInferencesPerTurn,
      maxToolCallsPerTurn: config.maxToolCallsPerTurn,
      watchdogMs: config.watchdogMs,
    },
    concludeOn: config.concludeOn,
    permission: { mode: 'provider', autoAllow: [] },
    compaction: 'provider',
    configDir,
    rules: '',
    skillsDir: agents?.skillsDir ?? '',
    ...(agents === undefined || Object.keys(agents.mcpServers).length === 0 ? {} : { mcpServers: agents.mcpServers }),
    ...(agents === undefined || agents.plugins.length === 0 ? {} : { plugins: agents.plugins }),
    ...(agents === undefined || Object.keys(agents.hooks).length === 0 ? {} : { hooks: agents.hooks }),
    ...(agents === undefined || agents.instructions === '' ? {} : { instructions: agents.instructions }),
    ...(agents?.agents === undefined || agents.agents.length === 0 ? {} : { agents: agents.agents }),
    ...(agents?.commands === undefined || agents.commands.length === 0 ? {} : { commands: agents.commands }),
    projectDocs: true,
    childPolicy: { native: mindKind === 'work', maxDepth: 1, maxConcurrent: 4, crossCli: [] },
  }
}

/**
 * 读全局 agent 配置集，为这家实例选出配置并把本事物化到临时目录；根为空串时不读。
 * @param root - 全局集根目录。
 * @param impl - 提供方实例名。
 * @param cwd - 会话工作目录（决定目录级配置）。
 * @param io - 打一行"选出了什么"到 stderr。
 * @returns 选出的配置与释放临时目录的函数；没有根目录时 `undefined`。
 */
async function resolveRunAgents(
  root: string, impl: string, cwd: string, io: Pick<BrainCliIo, 'stderr'>,
): Promise<{ agents: RunAgents; dispose: () => Promise<void> } | undefined> {
  if (root === '') return undefined
  const config = await loadAgentsConfig(root)
  const directory = await loadDirectoryConfig(root, cwd)
  const resolved = await resolveAgentConfig(config, { impl, ...(directory === undefined ? {} : { directory }) })
  let skillsDir = ''
  if (resolved.skills.length > 0) {
    skillsDir = await mkdtemp(join(tmpdir(), 'liwa-brain-skills-'))
    try {
      await materializeSkills(resolved.skills, skillsDir)
    } catch (error) {
      await rm(skillsDir, { recursive: true, force: true })
      throw error
    }
  }
  const summary = [
    `skills=[${resolved.skills.map(skill => skill.name).join(',')}]`,
    `mcp=[${Object.keys(resolved.mcpServers).join(',')}]`,
    `plugins=[${resolved.plugins.join(',')}]`,
    `hooks=[${Object.keys(resolved.hooks).join(',')}]`,
    `instructions=${Buffer.byteLength(resolved.instructions)} bytes`,
  ]
  io.stderr.write(`liwa: agent config for ${impl}: ${summary.join(' ')}\n`)
  return {
    agents: {
      skillsDir, agents: resolved.agents, commands: resolved.commands, mcpServers: resolved.mcpServers,
      plugins: resolved.plugins, hooks: resolved.hooks, instructions: resolved.instructions,
    },
    dispose: async () => {
      if (skillsDir !== '') await rm(skillsDir, { recursive: true, force: true })
    },
  }
}

/**
 * 一条事件的一行人读文本。
 * @param event - 事件。
 * @returns 种类在前、要点在后的一行。
 */
export function formatEvent(event: BrainEvent): string {
  const child = 'childId' in event && event.childId !== undefined && event.kind !== 'child.started' && event.kind !== 'child.ended'
    ? ` [child ${event.childId}]`
    : ''
  const label = `${event.kind}${child}`.padEnd(26)
  switch (event.kind) {
    case 'turn.started':
      return `${label} turn=${event.turnId}`
    case 'turn.completed':
      return `${label} turn=${event.turnId} usage=${JSON.stringify(event.usage)}${event.concludedBy === undefined ? '' : ` concludedBy=${event.concludedBy}`}`
    case 'turn.interrupted':
      return `${label} turn=${event.turnId}${event.reason === undefined ? '' : ` reason=${event.reason}`}`
    case 'turn.failed':
      return `${label} turn=${event.turnId} ${event.category}: ${event.message}`
    case 'session.exited':
      return `${label} ${event.category}: ${event.message}`
    case 'session.project_document':
      return `${label} ${event.path} ${JSON.stringify(event.reason)}`
    case 'session.project_document_failed':
      return `${label} ${event.path}: ${event.message}`
    case 'session.compacted':
      return `${label} ${JSON.stringify({ trigger: event.trigger, preTokens: event.preTokens, postTokens: event.postTokens })}`
    case 'process.exited':
      return `${label} code=${String(event.code)} signal=${String(event.signal)}`
    case 'item.message':
      return `${label} ${JSON.stringify(event.delta)}${event.final ? ' (final)' : ''}`
    case 'item.reasoning':
      return `${label} ${JSON.stringify(event.summary)}`
    case 'item.tool_call.started':
      return `${label} ${event.tool} ${JSON.stringify(event.args)}`
    case 'item.tool_call.completed':
      return `${label} ${event.ok ? 'ok' : 'failed'} ${JSON.stringify(event.result)}`
    case 'permission.request':
      return `${label} ${event.category} ${event.tool} ${event.questions === undefined ? JSON.stringify(event.args) : JSON.stringify(event.questions.map(question => question.question))} options=${event.options.map(option => `${option.id}(${option.effect})`).join(',')}`
    case 'permission.resolved':
      return `${label} ${event.optionId} -> ${event.effect}`
    case 'usage.update':
      return `${label} ${JSON.stringify(event.usage)}`
    case 'child.started':
      return `${label} ${event.childId} ${JSON.stringify(event.label)}${event.parentChildId === undefined ? '' : ` parent=${event.parentChildId}`}`
    case 'child.ended':
      return `${label} ${event.childId} ${event.stopReason} usage=${JSON.stringify(event.usage)}`
    case 'session.mode_changed':
      return `${label} ${String(event.modeId)}`
    case 'session.model_changed':
      return `${label} ${event.model}`
    case 'session.thinking_changed':
      return `${label} ${event.thinking}`
  }
}

/**
 * 按 `--permit` 答一个问答请求：`ask` 在终端逐个问；允许类策略给每个问题选第一个选项（有只收自由文本的问题就谢绝）；
 * `deny` 谢绝。
 * @param permit - 应答策略。
 * @param request - 问答请求。
 * @param io - 终端提问。
 * @returns 答复。
 */
async function answerQuestions(permit: PermitPolicy, request: BrainEventOf<'permission.request'>, io: Pick<BrainCliIo, 'ask'>): Promise<PermissionResponse> {
  const questions = request.questions ?? []
  const answerOption = request.options.find(option => option.effect === 'allow_once') ?? request.options.find(option => option.effect.startsWith('allow'))
  const decline = request.options.find(option => option.effect === 'deny_once') ?? request.options[0]
  const declined: PermissionResponse = { optionId: decline?.id ?? '' }
  if (answerOption === undefined || permit === 'deny') return declined
  const answers: Record<string, PermissionAnswer> = {}
  for (const question of questions) {
    if (permit !== 'ask') {
      const first = question.options[0]
      if (first === undefined) return declined
      answers[question.id] = { selected: [first.label] }
      continue
    }
    const menu = question.options.map((option, index) => `  ${String(index + 1)}) ${option.label}${option.description === undefined ? '' : ` — ${option.description}`}`).join('\n')
    const hint = question.options.length === 0 ? 'Answer' : question.multiSelect ? 'Choose numbers separated by commas, or type an answer' : 'Choose a number, or type an answer'
    const reply = (await io.ask(`${question.header === undefined ? '' : `[${question.header}] `}${question.question}${question.detail === undefined ? '' : `\n${question.detail}`}\n${menu}${menu === '' ? '' : '\n'}${hint}: `)).trim()
    if (reply === '') return declined
    const picked = reply.split(',').map(part => question.options[Number(part.trim()) - 1]?.label)
    answers[question.id] = picked.every(label => label !== undefined) && question.options.length > 0
      ? { selected: question.multiSelect ? picked : picked.slice(0, 1) }
      : { selected: [], custom: reply }
  }
  return { optionId: answerOption.id, answers }
}

/**
 * 按 `--permit` 答一个权限请求（问答请求带上答案）；`ask` 在终端问。
 * @param permit - 应答策略。
 * @param request - 权限请求。
 * @param io - 终端提问。
 * @returns 答复。
 */
export async function choosePermission(permit: PermitPolicy, request: BrainEventOf<'permission.request'>, io: Pick<BrainCliIo, 'ask'>): Promise<PermissionResponse> {
  if (request.questions !== undefined) return answerQuestions(permit, request, io)
  const byEffect = (...effects: PermissionOption['effect'][]): PermissionOption | undefined =>
    effects.map(effect => request.options.find(option => option.effect === effect)).find(option => option !== undefined)
  switch (permit) {
    case 'allow-once':
      return { optionId: (byEffect('allow_once', 'allow_session', 'allow_always') ?? request.options[0])?.id ?? '' }
    case 'allow-session':
      return { optionId: (byEffect('allow_session', 'allow_once', 'allow_always') ?? request.options[0])?.id ?? '' }
    case 'deny':
      return { optionId: (byEffect('deny_once', 'deny_always', 'cancel') ?? request.options[0])?.id ?? '' }
    case 'ask': {
      const menu = request.options.map((option, index) => `  ${String(index + 1)}) ${option.label} [${option.effect}]`).join('\n')
      const answer = (await io.ask(`Permission requested for ${request.tool} ${JSON.stringify(request.args)}\n${menu}\nChoose 1-${String(request.options.length)}: `)).trim()
      const picked = request.options[Number(answer) - 1] ?? request.options.find(option => option.id === answer)
      // 答不上来的输入原样交给提供方，按契约以 deny_once 处理。
      return { optionId: picked?.id ?? answer }
    }
  }
}

/** `--image` 认的图片扩展名。 */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/**
 * `run` 的回合输入：提示词，再加 `--image` 给的图片（存进 brains 的 blob 存储，引用放进输入）。
 * @param ctx - 带 `brains` 的上下文。
 * @param command - `run` 命令。
 * @returns 回合输入。
 * @throws {BrainError} `invalid_input`：图片扩展名不认识。
 */
export async function runInput(ctx: Context, command: RunCommand): Promise<TurnInput> {
  const images = await Promise.all(command.images.map(async (file) => {
    const mime = IMAGE_TYPES[extname(file).toLowerCase()]
    if (mime === undefined) throw new BrainError('invalid_input', 'brain.image_type', `--image ${file}: use a .png, .jpg, .jpeg, .webp, or .gif file`)
    return { kind: 'image' as const, blob: await ctx.brains.blobs.put(await readFile(resolve(file)), mime) }
  }))
  return { blocks: [{ kind: 'text', text: command.prompt }, ...images] }
}

/**
 * 打印探测结果。
 * @param impl - 提供方。
 * @param result - 探测结果。
 * @returns 多行文本。
 */
function formatProbe(impl: string, result: BrainProbeResult): string {
  const lines = [
    `provider:  ${impl}`,
    `available: ${result.available ? 'yes' : 'no'}`,
    `version:   ${result.version ?? 'unknown'}`,
    ...(result.auth === undefined ? [] : [`auth:      ${JSON.stringify(result.auth)}`]),
    ...result.problems.map(problem => `problem:   ${problem}`),
  ]
  return `${lines.join('\n')}\n`
}

/**
 * 执行 `list`。
 * @param ctx - 带 `brains` 的上下文。
 * @param json - 输出 JSON。
 * @param io - 输出。
 * @returns 退出码。
 */
async function runList(ctx: Context, json: boolean, io: BrainCliIo): Promise<number> {
  const providers = ctx.brains.list()
  const probes = await Promise.all(providers.map(view => ctx.brains.probe(view.impl)))
  if (json) {
    const rows = ctx.brains.list().map(view => ({
      impl: view.impl,
      plugin: view.plugin,
      available: view.available,
      probe: view.probeResult,
      meta: view.meta,
    }))
    io.stdout.write(`${JSON.stringify(rows)}\n`)
    return 0
  }
  if (providers.length === 0) {
    io.stdout.write('no brain providers are mounted in this profile\n')
    return 0
  }
  const rows = providers.map((view, index) => [
    view.impl,
    view.meta.transport,
    probes[index]?.available === true ? 'yes' : 'no',
    probes[index]?.version ?? '-',
    view.plugin,
  ])
  const header = ['IMPL', 'TRANSPORT', 'AVAILABLE', 'VERSION', 'PLUGIN']
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map(row => row[column]?.length ?? 0)))
  for (const row of [header, ...rows]) io.stdout.write(`${row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join('  ').trimEnd()}\n`)
  return 0
}

/**
 * 执行 `probe`。
 * @param ctx - 带 `brains` 的上下文。
 * @param command - `probe` 命令。
 * @param io - 输出。
 * @returns 可用时 0，否则 1。
 */
async function runProbe(ctx: Context, command: Extract<BrainCommand, { command: 'probe' }>, io: BrainCliIo): Promise<number> {
  const result = await ctx.brains.probe(ImplId(command.impl), undefined, { checkAuth: command.checkAuth === true })
  io.stdout.write(command.json ? `${JSON.stringify({ impl: command.impl, ...result })}\n` : formatProbe(command.impl, result))
  return result.available ? 0 : 1
}

/**
 * 执行 `run`：开会话、打事件、跑一个回合、关会话。
 * @param ctx - 带 `brains` 的上下文。
 * @param command - `run` 命令。
 * @param config - 回合预算。
 * @param io - 输出与终端提问。
 * @returns 回合正常结束时 0，否则 1。
 */
async function runSession(ctx: Context, command: RunCommand, config: Config, io: BrainCliIo): Promise<number> {
  const impl = ImplId(command.provider)
  const resolvedAgents = await resolveRunAgents(config.agentsRoot, impl, resolve(command.cwd ?? process.cwd()), io)
  try {
    return await runSessionWith(ctx, command, config, io, resolvedAgents?.agents)
  } finally {
    await resolvedAgents?.dispose()
  }
}

async function runSessionWith(
  ctx: Context, command: RunCommand, config: Config, io: BrainCliIo, agents: RunAgents | undefined,
): Promise<number> {
  const impl = ImplId(command.provider)
  const configDir = await ctx.brains.prepareConfigDir(MemberId(command.member ?? 'cli'), impl, {
    rules: '',
    skillsDir: agents?.skillsDir ?? '',
    projectDocs: true,
    ...(command.model === undefined ? {} : { model: command.model }),
    ...(agents === undefined || Object.keys(agents.mcpServers).length === 0 ? {} : { mcpServers: agents.mcpServers }),
  })
  const session: BrainSession = await ctx.brains.createSession(ctx, { impl, cfg: resolveRunSession(command, config, configDir, agents) })
  io.stderr.write(`liwa: brain session ${session.id} opened on ${impl} (home ${session.view().homeDir})\n`)
  let answering = Promise.resolve()
  // 回合的终止事件可能早于 startTurn 返回，先按回合号记下。
  const outcomes = new Map<string, number>()
  // 用对象记会话是否已退出：它在订阅回调里被改，读成属性免得类型收窄误判。
  const state = { exited: false }
  let target: string | undefined
  let wake: ((code: number) => void) | undefined
  const unsubscribe = session.subscribe((event) => {
    io.stdout.write(command.json ? `${JSON.stringify(event)}\n` : `${formatEvent(event)}\n`)
    if (event.kind === 'permission.request') {
      answering = answering.then(async () => {
        await session.respondToPermission(event.requestId, await choosePermission(command.permit, event, io))
      }).catch((error: unknown) => {
        io.stderr.write(`liwa: answering permission ${event.requestId} failed: ${error instanceof Error ? error.message : String(error)}\n`)
      })
    }
    if (event.kind === 'turn.completed' || event.kind === 'turn.interrupted' || event.kind === 'turn.failed') {
      const code = event.kind === 'turn.completed' ? 0 : 1
      outcomes.set(event.turnId, code)
      if (event.turnId === target) wake?.(code)
    }
    if (event.kind === 'session.exited') {
      state.exited = true
      wake?.(1)
    }
  })
  try {
    const { turnId } = await session.startTurn(await runInput(ctx, command))
    target = turnId
    const known = outcomes.get(turnId) ?? (state.exited ? 1 : undefined)
    return known ?? await new Promise<number>((resolve) => { wake = resolve })
  } finally {
    await answering
    await session.close()
    unsubscribe()
    io.stderr.write(`liwa: brain session ${session.id} closed (usage ${JSON.stringify(session.usage())})\n`)
  }
}

/**
 * 按解析出的命令执行，结束后请求退出。
 * @param ctx - 插件上下文。
 * @param config - 回合预算。
 * @param io - 进程侧效果。
 */
async function run(ctx: Context, config: Config, io: BrainCliIo): Promise<void> {
  // loader 的兄弟行并发挂载；等整棵树装好，提供方都已登记。
  await ctx.get('loader')?.await()
  const command = ctx.get('brainStartup')?.command
  if (command === undefined || ctx.get('brains') === undefined) return
  let code: number
  switch (command.command) {
    case 'list':
      code = await runList(ctx, command.json, io)
      break
    case 'plugin': {
      if (config.agentsRoot === '') throw new BrainError('invalid_input', 'brain.plugin_root', 'agentsRoot is required for plugin management')
      const records = await ctx.brains.managePlugins(ImplId(command.provider), config.agentsRoot, command.request)
      io.stdout.write(command.json ? `${JSON.stringify(records)}\n` : records.map(record => `${record.key}  ${record.version}  ${record.dir}`).join('\n') + '\n')
      code = 0
      break
    }
    case 'probe':
      code = await runProbe(ctx, command, io)
      break
    case 'run':
      code = await runSession(ctx, command, config, io)
      break
  }
  io.exit(code)
}

/**
 * 挂载命令执行方。
 * @param ctx - 带 `brains`、`brainStartup` 与启动器退出请求的插件上下文。
 * @param config - 回合预算。
 */
export function apply(ctx: Context, config: Config): void {
  const exit = ctx.get('appExit')
  if (exit === undefined) throw new Error('brain-cli: the launcher must provide ctx.appExit before the tree mounts')
  const io: BrainCliIo = { stdout: internals.stdout, stderr: internals.stderr, ask: internals.ask, exit }
  void run(ctx, config, io).catch((error: unknown) => {
    io.stderr.write(`liwa: ${error instanceof Error ? error.message : String(error)}\n`)
    io.exit(1)
  })
}
