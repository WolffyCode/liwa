/**
 * 显式实例配置与空壳子环境；会话策略只经 SDK 覆盖，不覆写成员共用状态。
 * @module @liwa/brain-claude-code/config
 */
import { cp, mkdir, readdir, realpath, stat, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import { z as jsonSchema } from 'zod'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import z from '@liwa/schemastery'
import { BrainError, HookEventSchema, ImplIdSchema, KERNEL_MCP_SERVER_NAME, memberMcpServers, rulesDocument, type Hooks, type McpServer, type SessionConfig, type MemberConfigSpec } from '@liwa/brain'
import { scrubbedParentEnv } from '@liwa/subprocess'
import { ClaudeProjectContext } from './project-context.ts'
import type { Options } from '@anthropic-ai/claude-agent-sdk'

/** 一行配置就是一个独立提供方；认证与地址像 Paseo 的自定义提供方一样直接写在 env 里。 */
export interface Config {
  /** 提供方唯一实现名，多行配置必须不同。 */
  impl: string
  /** 给人看的实例名称。 */
  label: string
  /** PATH 命令名或外部 Claude 可执行文件绝对路径。 */
  binary: string
  /** 跟在可执行文件后、SDK 参数前的固定参数（包装脚本、容器入口等）；探测 `--version` 时同样带上。 */
  binaryArgs: string[]
  /** 子进程部署变量（明文）：必须且只能含 ANTHROPIC_API_KEY 与 ANTHROPIC_AUTH_TOKEN 之一，可含 ANTHROPIC_BASE_URL、模型别名、超时等；不能覆写隔离与会话策略。 */
  env: Record<string, string>
  /** 允许的模型，必须且只能指定一个默认模型。 */
  models: InstanceModel[]
  /** 此实例额外禁止的原生工具。 */
  disallowedTools: string[]
  /** 实例自带的本事目录（绝对路径）；与会话的 skillsDir 一起装进同一个快照插件，同名本事报错。 */
  skills: string
  /** 实例受管 agent 描述目录，不使用 SDK 程序化 agents 入口。 */
  agents: string
  /** 实例受管斜杠命令目录。 */
  commands: string
  /** 实例自带的 MCP 服务器；与会话的 mcpServers 合并，同名报错，`liwa` 留给内核工具。 */
  mcpServers: Record<string, InstanceMcpServer>
  /** 实例装载的本地插件目录（绝对路径，须含 .claude-plugin/plugin.json）。 */
  plugins: string[]
  /** 实例的 settings 格式 hooks（只收 command 钩子），经 CLI 的 --settings 层生效，与 CLI 自带配置无关。 */
  hooks: Record<string, InstanceHookMatcher[]>
  /** 取消确认与子身份声明的等待上限（毫秒）。 */
  controlTimeoutMs: number
  /** 仅运行 --version 的等待上限（毫秒）。 */
  probeTimeoutMs: number
  /** 显式插件安装／更新命令的超时，不用于会话模型调用。 */
  pluginInstallTimeoutMs: number
  /** 受管进程终止阶梯的宽限期（毫秒）。 */
  graceMs: number
  /** 完整追加指令的 UTF-8 字节上限；超出拒绝，不截断。 */
  instructionsMaxBytes: number
}

/** Paseo 给自定义 Claude 模型的 thinking 档位：`off` 关掉，effort 五档，`ultracode` 是 xhigh 加 CLI 的 ultracode 设置。 */
export const THINKING_OPTION_IDS = ['off', 'low', 'medium', 'high', 'xhigh', 'max', 'ultracode'] as const
/** 一个 thinking 档位号。 */
export type ThinkingOptionId = (typeof THINKING_OPTION_IDS)[number]

/** 一个模型可选的 thinking 档位。 */
export interface ThinkingOption {
  /** 档位号：`off` 关掉，`low`…`max` 是 effort，`ultracode` 是 xhigh 加 CLI 的 ultracode 设置。 */
  id: ThinkingOptionId
  /** 给人看的档位名。 */
  label: string
  /** 会话没选档位时用它；一个模型至多一个。 */
  isDefault: boolean
}

/** 实例允许的一个模型。 */
export interface InstanceModel {
  /** 发给 CLI 的模型 id，实例内唯一。 */
  id: string
  /** 给人看的模型名。 */
  label: string
  /** 省略会话模型时使用；列表必须恰好一个。 */
  isDefault: boolean
  /** 本模型可选的 thinking 档位；空表示交给 CLI 默认，会话也不能选。 */
  thinkingOptions: ThinkingOption[]
}

/** 实例行里的一台 MCP 服务器：stdio 要 command，http／sse 要 url。 */
export interface InstanceMcpServer {
  /** 传输方式：本地进程 stdio，或远端 http／sse。 */
  type: 'stdio' | 'http' | 'sse'
  /** stdio 服务器的可执行文件或命令名。 */
  command?: string
  /** stdio 服务器的命令参数。 */
  args?: string[]
  /** stdio 服务器进程的额外环境变量。 */
  env?: Record<string, string>
  /** http／sse 服务器的地址，必须是 http(s)。 */
  url?: string
  /** http／sse 请求附带的头。 */
  headers?: Record<string, string>
}

/** settings.hooks 里的一条命令钩子。 */
export interface InstanceHook {
  /** 只收 CLI 的 command 钩子。 */
  type: 'command'
  /** 钩子要跑的 shell 命令。 */
  command: string
  /** 钩子超时（秒）；省略用 CLI 默认。 */
  timeout?: number
}

/** settings.hooks 的一个匹配组。 */
export interface InstanceHookMatcher {
  /** 匹配工具名等的模式（如 `Bash`）；省略匹配该事件的全部。 */
  matcher?: string
  /** 匹配时按顺序执行的钩子，至少一条。 */
  hooks: InstanceHook[]
}

const ThinkingOptionSchema = z.object({
  id: z.union([...THINKING_OPTION_IDS]).required(), label: z.string().required(), isDefault: z.boolean().default(false),
})
const InstanceModelSchema = z.object({
  id: z.string().required(), label: z.string().required(), isDefault: z.boolean().default(false),
  thinkingOptions: z.array(ThinkingOptionSchema).default([]),
})
const InstanceMcpServerSchema = z.object({
  type: z.union(['stdio', 'http', 'sse']).required(), command: z.string(), args: z.array(z.string()), env: z.dict(z.string()), url: z.string(), headers: z.dict(z.string()),
})
const InstanceHookMatcherSchema = z.object({
  matcher: z.string(),
  hooks: z.array(z.object({ type: z.const('command').required(), command: z.string().required(), timeout: z.natural() })).required(),
})

export const Config: z<Partial<Config>, Config> = z.object({
  impl: z.string().default('claude-code'),
  label: z.string().default('Claude Code'),
  binary: z.string().default('claude'),
  binaryArgs: z.array(z.string()).default([]),
  env: z.dict(z.string()).default({}),
  models: z.array(InstanceModelSchema).required(),
  disallowedTools: z.array(z.string()).default([]),
  skills: z.string().default(''),
  agents: z.string().default(''),
  commands: z.string().default(''),
  mcpServers: z.dict(InstanceMcpServerSchema).default({}),
  plugins: z.array(z.string()).default([]),
  hooks: z.dict(z.array(InstanceHookMatcherSchema)).default({}),
  controlTimeoutMs: z.natural().min(1).default(30_000),
  probeTimeoutMs: z.natural().min(1).default(10_000),
  pluginInstallTimeoutMs: z.natural().min(1).default(120_000),
  graceMs: z.natural().min(1).default(2_000),
  instructionsMaxBytes: z.natural().min(1).default(65_536),
})

/**
 * 校验跨字段约束，在登记前失败。
 * @param config - 已经 schema 校验的实例。
 */
export function validateConfig(config: Config): void {
  ImplIdSchema.parse(config.impl)
  if (config.binary.trim() === '') throw new BrainError('invalid_input', 'brain.claude_config', 'binary must be nonempty')
  if (config.binaryArgs.some(argument => argument.includes('\0'))) throw new BrainError('invalid_input', 'brain.claude_config', 'binaryArgs must not contain NUL characters')
  validateInstanceSurface(config)
  // 灵鲸改：部署变量像 Paseo 一样完整开放，但运行时/隔离策略的唯一归属不能被实例覆盖。
  for (const [name, value] of Object.entries(config.env)) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) throw new BrainError('invalid_input', 'brain.env_name', `Invalid uppercase environment name ${name}`)
    if (RESERVED_ENV.test(name)) throw new BrainError('invalid_input', 'brain.env_conflict', `Claude owns environment variable ${name}`)
    if (value.includes('\0')) throw new BrainError('invalid_input', 'brain.env_value', `${name} contains a NUL character`)
  }
  // 没有登录路径，认证变量缺失只会在第一回合才暴露，所以装载时就要求。
  const configuredAuth = AUTH_ENV.filter(name => (config.env[name] ?? '') !== '')
  if (configuredAuth.length !== 1) throw new BrainError('invalid_input', 'brain.claude_auth', `env must set exactly one of ${AUTH_ENV.join(' or ')}`)
  const ids = config.models.map(model => model.id)
  if (ids.length === 0 || ids.some(id => id.trim() !== id || id === '') || new Set(ids).size !== ids.length || config.models.filter(model => model.isDefault).length !== 1) {
    throw new BrainError('invalid_input', 'brain.claude_models', 'models must have distinct nonempty ids and exactly one isDefault model')
  }
  const baseUrl = config.env[BASE_URL_ENV]
  if (baseUrl !== undefined) {
    const url = new URL(baseUrl)
    if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '') {
      throw new BrainError('invalid_input', 'brain.claude_url', `${BASE_URL_ENV} must be HTTP(S) without credentials`)
    }
  }
}

/**
 * 实例 env 里会进子进程、必须从 stderr／日志／原生错误脱敏的值。
 * @param config - 已校验实例。
 * @returns 非空的认证与自定义头值。
 */
export function instanceSecrets(config: Config): string[] {
  return SECRET_ENV.map(name => config.env[name]).filter((value): value is string => value !== undefined && value !== '')
}

/**
 * 必须从配置列表选模型，不触发网络目录探测。
 * @param config - 实例。
 * @param model - 省略时用显式默认。
 * @returns 模型 id。
 */
export function resolveModel(config: Config, model?: string): InstanceModel {
  const selected = model === undefined ? config.models.find(entry => entry.isDefault) : config.models.find(entry => entry.id === model)
  if (selected === undefined) throw new BrainError('invalid_input', 'brain.model_unknown', `Unknown Claude model ${model ?? '(default)'}`)
  return selected
}

/**
 * 生成稳定空壳子；人设、规矩、MCP 与本事都是逐会话快照。
 * @param dir - 成员 impl 根。
 * @param _spec - 不写入共用 settings 的会话内容。
 */
export async function writeMemberConfig(dir: string, _spec: MemberConfigSpec): Promise<void> {
  await mkdir(join(dir, 'home'), { recursive: true, mode: 0o700 })
  await mkdir(join(dir, 'tmp'), { recursive: true, mode: 0o700 })
  await writeFile(join(dir, 'settings.json'), '{}\n', { mode: 0o600 })
}

/** CLI 认可的两个主认证变量；实例必须且只能配一个。 */
export const AUTH_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const
const BASE_URL_ENV = 'ANTHROPIC_BASE_URL'
// 认证值与自定义头是 CLI 定义的秘密载体；其余部署变量按 Paseo 的约定视为可见配置。
const SECRET_ENV = [...AUTH_ENV, 'ANTHROPIC_CUSTOM_HEADERS'] as const

// 配置路径、进程加载器和会话安全策略不得由部署 env 绕过；认证与地址按 Paseo 的做法由 env 自己给。
const RESERVED_ENV = new RegExp(`^(?:${[
  'PATH$|PATHEXT$|BASH_ENV$|ENV$|ZDOTDIR$|SHELL$|HOME$|USERPROFILE$|TMP(?:DIR)?$|TEMP$|XDG_|APPDATA$|LOCALAPPDATA$',
  '|NODE_|LD_|DYLD_|BUN_',
  '|CLAUDE(?:_CONFIG_DIR|_SECURESTORAGE_CONFIG_DIR|_AGENT_SDK_VERSION|_ENV_FILE|_PLUGIN_|_LOCAL_',
  '|_CODE_(?:OAUTH|CUSTOM_OAUTH|EMIT_|USE_|DISABLE_|ENABLE_|SKIP_|DANGEROUS|SDK|ENTRYPOINT|REMOTE_|PROJECT_DIR',
  '|SESSION|ADDITIONAL|SETTINGS|PLUGIN|MCP|EXPERIMENTAL_AGENT_TEAMS))',
  '|DISABLE_(?:AUTO_)?COMPACT$|ENABLE_TOOL_SEARCH$|DISABLE_(?:TELEMETRY|ERROR_REPORTING)$|DO_NOT_TRACK$',
].join('')})`, 'i')
const OWNED_ENV = /^(?:CLAUDE|ANTHROPIC|DISABLE_(?:AUTO_)?COMPACT$|ENABLE_TOOL_SEARCH$|HOME$|USERPROFILE$|TMPDIR$|NODE_OPTIONS$)/i

/**
 * 仅保留系统执行与区域设置；宿主部署配置、认证、加载器与路径覆盖不继承。
 * @returns 安全的基础环境；实例部署项另行显式注入。
 */
export function claudeParentEnvironment(): Record<string, string> {
  const inherited = /^(?:PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|LANG|LANGUAGE|LC_[A-Z_]+|TZ|TERM|COLORTERM|NO_COLOR|FORCE_COLOR)$/i
  return Object.fromEntries(Object.entries(scrubbedParentEnv()).filter(([name]) => inherited.test(name)))
}

/**
 * 构造完整环境：宿主只留基础变量，实例 env 原样注入，隔离与运行时拥有项最后覆盖。
 * @param home - 成员 impl 根。
 * @param config - 实例。
 * @param session - 会话策略。
 * @returns SDK 完整环境。
 */
export function claudeEnvironment(home: string, config: Config, session: SessionConfig): Record<string, string> {
  const env: Record<string, string> = {}
  Object.assign(env, claudeParentEnvironment())
  Object.assign(env, config.env)
  for (const [name, value] of Object.entries(session.env ?? {})) {
    if (OWNED_ENV.test(name) || RESERVED_ENV.test(name) || name in config.env) throw new BrainError('invalid_input', 'brain.env_conflict', `Claude owns environment variable ${name}`)
    env[name] = value
  }
  Object.assign(env, {
    HOME: join(home, 'home'), USERPROFILE: join(home, 'home'), TMPDIR: join(home, 'tmp'),
    CLAUDE_CONFIG_DIR: home,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', ENABLE_TOOL_SEARCH: 'false',
  })
  if (session.compaction === 'off') env['DISABLE_COMPACT'] = '1'
  return env
}

/** 一代会话的策略与可释放的本事快照。 */
export interface ClaudeSessionPolicy {
  /** 完全显式的 SDK 配置。 */
  options: Options
  /** 最终生效的 MCP 服务器（内核 + 实例 + 会话），SDK 与收尾策略、脱敏都用这一份。 */
  mcpServers: Record<string, McpServer>
  /** 此代受控项目说明；projectDocs 关时省略。 */
  projectContext?: ClaudeProjectContext
  /** 开会话时应用的 thinking 选择。 */
  thinking: ThinkingChoice
  /** 删除此代快照；不删除成员转录或其他会话。 */
  dispose(): Promise<void>
}

/**
 * 在拉进程前拒绝不能兑现的策略，并构造隔离 SDK 参数。
 * @param config - 实例部署项。
 * @param session - 完整会话配置。
 * @param home - 成员 impl 根。
 * @returns 独立策略快照。
 */
export async function resolveSessionPolicy(config: Config, session: SessionConfig, home: string): Promise<ClaudeSessionPolicy> {
  if (session.mindKind !== 'work') throw new BrainError('invalid_input', 'brain.claude_work_only', 'Claude is work-only until real CLI compaction and tool isolation are verified')
  if (session.nativeToolPolicy !== 'worktree' && session.childPolicy.native) throw new BrainError('invalid_input', 'brain.claude_children_policy', 'Native children require worktree tools; child tool restrictions cannot be inherited reliably')
  const mode = session.modeId ?? 'default'
  if (!isSessionMode(mode)) throw new BrainError('invalid_input', 'brain.mode_unknown', `Claude supports ${SESSION_MODES.join(', ')} modes`)
  if (session.kernelTools !== undefined && 'native' in session.kernelTools) throw new BrainError('invalid_input', 'brain.claude_mcp_required', 'Claude kernel tools require an MCP endpoint')
  const model = resolveModel(config, session.model)
  const thinking = resolveThinking(model, session.thinking)
  const mcpServers = mergedMcpServers(config, session)
  const prompt = [session.persona.stable, rulesDocument(session.rules), session.instructions ?? '']
  const projectContext = session.projectDocs ? await ClaudeProjectContext.create(session.cwd, config.instructionsMaxBytes) : undefined
  for (const document of projectContext?.initial.documents ?? []) prompt.push(`[Project instructions: ${document.path}]\n${document.text}`)
  prompt.push(session.persona.notes)
  const append = prompt.filter(Boolean).join('\n\n')
  if (Buffer.byteLength(append) > config.instructionsMaxBytes) throw new BrainError('invalid_input', 'brain.claude_instructions_limit', 'Instructions exceed instructionsMaxBytes; shorten them or increase the configured limit')
  const disallowedTools = [...config.disallowedTools]
  if (!session.childPolicy.native) disallowedTools.push('Agent', 'Task')
  const hooks = mergedHooks(config.hooks, session.hooks ?? {})
  const plugins = [...config.plugins, ...(session.plugins ?? [])]
  const options: Options = {
    model: model.id, settingSources: [], strictMcpConfig: true, persistSession: true,
    permissionMode: mode,
    allowDangerouslySkipPermissions: false,
    systemPrompt: { type: 'preset', preset: 'claude_code', append },
    maxTurns: session.limits.maxInferencesPerTurn,
    disallowedTools,
    ...(session.nativeToolPolicy === 'none' ? { tools: [] } : session.nativeToolPolicy === 'readonly' ? { tools: ['Read', 'Glob', 'Grep'] } : {}),
    settings: {
      claudeMdExcludes: ['**'], autoCompactEnabled: session.compaction !== 'off', autoMemoryEnabled: false, enabledPlugins: {},
      ...(Object.keys(hooks).length === 0 ? {} : { hooks }),
    },
    ...(plugins.length === 0 ? {} : { plugins: plugins.map(path => ({ type: 'local' as const, path })) }),
  }
  applyThinking(options, thinking)
  await assertPluginDirectories(plugins)
  const projectSources: Record<'skills' | 'agents' | 'commands', MaterialSource[]> = { skills: [], agents: [], commands: [] }
  if (projectContext !== undefined) {
    const root = projectContext.initial.root
    const directories = [await realpath(session.cwd)]
    while (directories[0] !== root) directories.unshift(dirname(directories[0] as string))
    for (const directory of directories) {
      for (const kind of ['skills', 'agents', 'commands'] as const) {
        const source = join(directory, '.claude', kind)
        const actual = await realpath(source).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
          throw error
        })
        if (actual === undefined) continue
        const local = relative(root, actual)
        if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) throw new BrainError('invalid_input', 'brain.project_material_outside', `Project ${kind} resolves outside the git root`)
        projectSources[kind].push({ dir: actual, root })
      }
    }
  }
  const hasSkills = config.skills !== '' || session.skillsDir !== '' || projectSources.skills.length > 0
  if (session.nativeToolPolicy === 'none' && hasSkills) throw new BrainError('invalid_input', 'brain.claude_skills_policy', 'Skills require the native Skill tool')
  const snapshot = await mkdtemp(join(home, 'snapshot-'))
  const dispose = async (): Promise<void> => { await rm(snapshot, { recursive: true, force: true }) }
  const populate = async (): Promise<void> => {
    const materials = {
      skills: [...[config.skills, session.skillsDir].map(dir => ({ dir })), ...projectSources.skills],
      agents: [...[config.agents, ...(session.agents ?? [])].map(dir => ({ dir })), ...projectSources.agents],
      commands: [...[config.commands, ...(session.commands ?? [])].map(dir => ({ dir })), ...projectSources.commands],
    }
    for (const kind of ['skills', 'agents', 'commands'] as const) {
      await copyMaterials(materials[kind], join(snapshot, kind), kind)
    }
    const hasMaterials = Object.values(materials).some(sources => sources.some(source => source.dir !== ''))
    if (hasMaterials) {
      await mkdir(join(snapshot, '.claude-plugin'))
      await writeFile(join(snapshot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'liwa-member-materials', version: '1.0.0' }), { mode: 0o600 })
      options.plugins = [...(options.plugins ?? []), { type: 'local', path: snapshot }]
    }
    const mcpFile = join(snapshot, 'mcp.json')
    const serializedServers = Object.fromEntries(Object.entries(mcpServers).map(([name, server]) => [name, server.type === 'stdio'
      ? { ...server, args: server.args ?? [], env: server.env ?? {} }
      : { ...server, headers: server.headers ?? {} }]))
    await writeFile(mcpFile, JSON.stringify({ mcpServers: serializedServers }), { mode: 0o600 })
    options.extraArgs = { ...options.extraArgs, 'mcp-config': mcpFile }
    const settingsFile = join(snapshot, 'settings.json')
    await writeFile(settingsFile, JSON.stringify(options.settings), { mode: 0o600 })
    options.settings = settingsFile
  }
  try {
    await populate()
  } catch (error) {
    await dispose()
    throw error
  }
  return { options, mcpServers, thinking, ...(projectContext === undefined ? {} : { projectContext }), dispose }

}

/** 会话模式：Paseo 的五个减去 bypassPermissions（设计 §4.2 禁用）；dontAsk 同理不开放。 */
export const SESSION_MODES = ['default', 'plan', 'acceptEdits', 'auto'] as const
type SessionMode = (typeof SESSION_MODES)[number]
const MCP_SERVER_NAME = /^[A-Za-z0-9_-]+$/
const MIN_SECRET_LENGTH = 8
const ADAPTIVE_THINKING: Options['thinking'] = { type: 'adaptive', display: 'summarized' }

/** 一个 thinking 档位落到 SDK 上的样子。 */
export interface ThinkingChoice {
  thinking?: Options['thinking']
  effort?: Options['effort']
  ultracode: boolean
}

const THINKING_CHOICES: Record<ThinkingOptionId, ThinkingChoice> = {
  off: { thinking: { type: 'disabled' }, ultracode: false },
  low: { thinking: ADAPTIVE_THINKING, effort: 'low', ultracode: false },
  medium: { thinking: ADAPTIVE_THINKING, effort: 'medium', ultracode: false },
  high: { thinking: ADAPTIVE_THINKING, effort: 'high', ultracode: false },
  xhigh: { thinking: ADAPTIVE_THINKING, effort: 'xhigh', ultracode: false },
  max: { thinking: ADAPTIVE_THINKING, effort: 'max', ultracode: false },
  ultracode: { thinking: ADAPTIVE_THINKING, effort: 'xhigh', ultracode: true },
}

function isSessionMode(value: string): value is SessionMode {
  return (SESSION_MODES as readonly string[]).includes(value)
}

/**
 * 把会话选的档位（或模型默认档）落成 SDK 选项。
 * @param model - 当前模型。
 * @param selected - 会话选的档位号；省略用模型默认档。
 * @returns SDK 选项；模型没列档位且会话没选时什么都不设。
 * @throws {BrainError} `invalid_input`（模型没有这一档）。
 */
export function resolveThinking(model: InstanceModel, selected: string | undefined): ThinkingChoice {
  const options = model.thinkingOptions
  if (options.length === 0) {
    if (selected !== undefined) throw new BrainError('invalid_input', 'brain.claude_thinking', `model ${model.id} offers no thinking options`)
    return { ultracode: false }
  }
  const option = selected === undefined ? options.find(entry => entry.isDefault) : options.find(entry => entry.id === selected)
  if (option !== undefined) return THINKING_CHOICES[option.id]
  if (selected !== undefined) throw new BrainError('invalid_input', 'brain.claude_thinking', `model ${model.id} has no thinking option ${selected}`)
  return { ultracode: false }
}

/**
 * 把 thinking 选择写进 SDK 选项（开会话时与运行中切档都走这里）。
 * @param options - SDK 选项，原地改。
 * @param choice - 档位选择。
 */
export function applyThinking(options: Options, choice: ThinkingChoice): void {
  if (choice.thinking === undefined) delete options.thinking
  else options.thinking = choice.thinking
  if (choice.effort === undefined) delete options.effort
  else options.effort = choice.effort
  const value = options.settings
  if (value === undefined) return
  const settings = typeof value === 'string' ? jsonSchema.record(jsonSchema.string(), jsonSchema.unknown()).parse(JSON.parse(readFileSync(value, 'utf8'))) : value
  if (choice.ultracode) settings.ultracode = true
  else delete settings.ultracode
  if (typeof value === 'string') writeFileSync(value, JSON.stringify(settings), { mode: 0o600 })
}

/**
 * 最终 MCP 配置与内核工具里会出现在请求头、子进程环境中的秘密，交给诊断脱敏。
 * @param mcpServers - 最终生效的 MCP 服务器。
 * @param kernelTools - 会话的内核工具。
 * @returns 要抹掉的值：头的完整值、头值里的令牌段（空格后的最后一段）、stdio 环境值、内核令牌；太短的不算。
 */
export function sessionSecrets(mcpServers: Record<string, McpServer>, kernelTools: SessionConfig['kernelTools']): string[] {
  const secrets: string[] = []
  const add = (value: string): void => {
    if (value.length >= MIN_SECRET_LENGTH) secrets.push(value)
  }
  for (const server of Object.values(mcpServers)) {
    if (server.type === 'stdio') {
      for (const value of Object.values(server.env ?? {})) add(value)
      continue
    }
    for (const value of Object.values(server.headers ?? {})) {
      add(value)
      const token = value.trim().split(/\s+/).at(-1)
      if (token !== undefined && token !== value) add(token)
    }
  }
  if (kernelTools !== undefined && 'endpoint' in kernelTools) add(kernelTools.token)
  return secrets
}

function validateInstanceSurface(config: Config): void {
  for (const model of config.models) validateThinkingOptions(model)
  for (const kind of ['skills', 'agents', 'commands'] as const) {
    if (config[kind] !== '' && !isAbsolute(config[kind])) throw new BrainError('invalid_input', 'brain.claude_materials', `${kind} must be an absolute directory path`)
  }
  for (const path of config.plugins) {
    if (!isAbsolute(path)) throw new BrainError('invalid_input', 'brain.claude_plugins', `plugin directory ${path} must be an absolute path`)
  }
  for (const [name, server] of Object.entries(config.mcpServers)) normalizedMcpServer(name, server)
  for (const [event, matchers] of Object.entries(config.hooks)) validateHookEvent(event, matchers)
}

function validateThinkingOptions(model: InstanceModel): void {
  const ids = model.thinkingOptions.map(option => option.id)
  const hasDuplicate = new Set(ids).size !== ids.length
  const hasManyDefaults = model.thinkingOptions.filter(option => option.isDefault).length > 1
  if (hasDuplicate || hasManyDefaults) {
    throw new BrainError('invalid_input', 'brain.claude_thinking', `model ${model.id} thinking options must be distinct with at most one default`)
  }
}

function validateHookEvent(event: string, matchers: InstanceHookMatcher[]): void {
  if (!HookEventSchema.safeParse(event).success) throw new BrainError('invalid_input', 'brain.claude_hooks', `unknown hook event ${event}`)
  for (const matcher of matchers) {
    if (matcher.hooks.length === 0) throw new BrainError('invalid_input', 'brain.claude_hooks', `hook group for ${event} has no hooks`)
    for (const hook of matcher.hooks) {
      if (hook.command.trim() === '') throw new BrainError('invalid_input', 'brain.claude_hooks', `hook command for ${event} is empty`)
    }
  }
}

/** 会话带来的钩子（全局集与目录级选出的）排在前，实例行自己的排在后：15 草稿 §4 "全局在前、对话在后"。 */
function mergedHooks(instance: Record<string, InstanceHookMatcher[]>, session: Hooks): Record<string, InstanceHookMatcher[]> {
  const merged: Record<string, InstanceHookMatcher[]> = {}
  for (const [event, matchers] of Object.entries(session)) {
    // 契约的可选字段带 undefined，SDK 的 settings 形状不收；按字段有无重建。
    merged[event] = matchers.map(matcher => ({
      ...(matcher.matcher === undefined ? {} : { matcher: matcher.matcher }),
      hooks: matcher.hooks.map(hook => ({
        type: hook.type, command: hook.command, ...(hook.timeout === undefined ? {} : { timeout: hook.timeout }),
      })),
    }))
  }
  for (const [event, matchers] of Object.entries(instance)) merged[event] = [...(merged[event] ?? []), ...matchers]
  return merged
}

function isHttpUrl(value: string): boolean {
  return URL.canParse(value) && ['http:', 'https:'].includes(new URL(value).protocol)
}

function normalizedMcpServer(name: string, server: InstanceMcpServer): McpServer {
  if (!MCP_SERVER_NAME.test(name)) throw new BrainError('invalid_input', 'brain.claude_mcp', `MCP server name ${name} must match ${MCP_SERVER_NAME.source}`)
  if (name === KERNEL_MCP_SERVER_NAME) throw new BrainError('invalid_input', 'brain.claude_mcp', `MCP server name ${name} is reserved for Liwa kernel tools`)
  if (server.type === 'stdio') {
    if (server.command === undefined || server.command.trim() === '') throw new BrainError('invalid_input', 'brain.claude_mcp', `MCP server ${name} needs a command`)
    return { type: 'stdio', command: server.command, ...(server.args === undefined ? {} : { args: server.args }), ...(server.env === undefined ? {} : { env: server.env }) }
  }
  if (server.url === undefined || !isHttpUrl(server.url)) throw new BrainError('invalid_input', 'brain.claude_mcp', `MCP server ${name} needs an http(s) url`)
  return { type: server.type, url: server.url, ...(server.headers === undefined ? {} : { headers: server.headers }) }
}

function mergedMcpServers(config: Config, session: SessionConfig): Record<string, McpServer> {
  const servers = memberMcpServers(session)
  for (const [name, server] of Object.entries(config.mcpServers)) {
    if (name in servers) throw new BrainError('invalid_input', 'brain.claude_mcp_conflict', `MCP server ${name} is defined by both the instance and the session`)
    servers[name] = normalizedMcpServer(name, server)
  }
  return servers
}

async function assertPluginDirectories(plugins: string[]): Promise<void> {
  for (const path of plugins) {
    await stat(join(path, '.claude-plugin', 'plugin.json')).catch((error: unknown) => {
      throw new BrainError('invalid_input', 'brain.claude_plugin_missing', `plugin directory ${path} has no .claude-plugin/plugin.json`, { cause: error })
    })
  }
}

interface MaterialSource { dir: string; root?: string }

async function copyMaterials(sources: MaterialSource[], target: string, kind: string): Promise<void> {
  await mkdir(target, { recursive: true, mode: 0o700 })
  const owners = new Map<string, string>()
  for (const source of sources) {
    if (source.dir === '') continue
    const active = new Set<string>()
    const claim = (name: string): void => {
      const owner = owners.get(name)
      if (owner !== undefined) throw new BrainError('invalid_input', 'brain.claude_material_conflict', `${kind} ${name} is provided by both ${owner} and ${source.dir}`)
      owners.set(name, source.dir)
    }
    const copy = async (name: string): Promise<void> => {
      const path = join(source.dir, name)
      const actual = await realpath(path)
      const local = source.root === undefined ? undefined : relative(source.root, actual)
      if (local !== undefined && (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local))) throw new BrainError('invalid_input', 'brain.project_material_outside', `Project ${kind} entry ${name} resolves outside the git root`)
      const metadata = await stat(actual)
      if (!metadata.isDirectory()) {
        claim(name)
        await mkdir(dirname(join(target, name)), { recursive: true, mode: 0o700 })
        await cp(actual, join(target, name), { dereference: true })
        return
      }
      if (active.has(actual)) throw new BrainError('invalid_input', 'brain.material_cycle', `Material directory cycle at ${name}`)
      active.add(actual)
      if (kind === 'skills' && name !== '' && !name.includes(sep)) claim(name)
      const entries = await readdir(actual)
      for (const entry of entries.sort()) await copy(join(name, entry))
      active.delete(actual)
    }
    try {
      await copy('')
    } catch (error) {
      if (error instanceof BrainError) throw error
      throw new BrainError('invalid_input', 'brain.material_unreadable', `${kind} directory ${source.dir} cannot be read`, { cause: error })
    }
  }
}
