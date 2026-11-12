/**
 * 全局 agent 配置集：`$LIWA_HOME/agents/agents.yml` 里的本事、MCP 服务器、插件、钩子与指令片段，按实例（条目的
 * `applyTo`、`instances.<impl>.use / disable`）和工作目录（`dirs/<路径哈希>.yml`）选出一份，物化成会话配置能直接用的东西。
 *
 * 文件形状照 Claude Code：本事是带 `SKILL.md` 的目录，插件是带 `.claude-plugin/plugin.json` 的目录，钩子是 settings.hooks
 * 的 command 钩子，MCP 是 `.mcp.json` 的服务器形状。各家提供方把它翻成自己的形状；翻不了的按 `Meta.agentConfig` 在开会话前拒绝。
 * 目录级配置只放在这个根下（主人在主控台写），仓库自带的 `.claude/`、`.mcp.json` 永远不执行。
 * @module @liwa/brain/agents-config
 */
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { JSON_SCHEMA, load as parseYaml } from 'js-yaml'
import { z } from 'zod'
import { readPluginLibrary } from '../plugin-library.ts'
import { BrainError } from '../errors.ts'
import {
  HookCommandSchema, HookEventSchema, McpHttpServerSchema, McpSseServerSchema, McpStdioServerSchema,
  type HookMatcher, type Hooks, type McpServer,
} from '../contract.ts'
import { KERNEL_MCP_SERVER_NAME } from '../config-dir/shared.ts'

/** 全局集的文件名。 */
export const AGENTS_CONFIG_FILE = 'agents.yml'
/** 目录级配置所在的子目录。 */
export const AGENTS_DIRS_DIR = 'dirs'
const ENTRY_NAME = /^[a-z0-9][a-z0-9_-]*$/
const ENV_REFERENCE = /\$\{([A-Z_][A-Z0-9_]*)\}/g
const SKILL_FILE = 'SKILL.md'

const ApplyToSchema = z.strictObject({ applyTo: z.array(z.string().min(1)).optional() })
const SkillEntrySchema = ApplyToSchema.extend({ dir: z.string().min(1) })
const PluginEntrySchema = z.union([ApplyToSchema.extend({ dir: z.string().min(1) }), ApplyToSchema.extend({ library: z.string().min(1) })])
const InstructionEntrySchema = ApplyToSchema.extend({ file: z.string().min(1) })
const HookEntrySchema = ApplyToSchema.extend({
  event: HookEventSchema, matcher: z.string().optional(), hooks: z.array(HookCommandSchema).min(1),
})
const applyTo = { applyTo: z.array(z.string().min(1)).optional() }
const McpEntrySchema = z.discriminatedUnion('type', [
  McpStdioServerSchema.extend(applyTo).strict(), McpHttpServerSchema.extend(applyTo).strict(), McpSseServerSchema.extend(applyTo).strict(),
])
const SelectionSchema = z.strictObject({ use: z.array(z.string().min(1)).default([]), disable: z.array(z.string().min(1)).default([]) })
const named = <T extends z.ZodType>(schema: T) => z.record(z.string().regex(ENTRY_NAME), schema).default({})

/** `agents.yml` 的形状。 */
export const AgentsConfigSchema = z.strictObject({
  version: z.literal(1),
  skills: named(SkillEntrySchema),
  agents: named(SkillEntrySchema),
  commands: named(SkillEntrySchema),
  mcpServers: named(McpEntrySchema),
  plugins: named(PluginEntrySchema),
  hooks: named(HookEntrySchema),
  instructions: named(InstructionEntrySchema),
  instances: z.record(z.string().min(1), SelectionSchema).default({}),
})
/** 读好的全局集：目录与文件都已是绝对路径，MCP 里的 `${VAR}` 已展开。 */
export type AgentsConfig = Omit<z.output<typeof AgentsConfigSchema>, 'plugins'> & { plugins: Record<string, { dir: string; applyTo?: string[] | undefined }> }
/** `dirs/<哈希>.yml` 的形状：某个工作目录下各实例的再选择。 */
export const DirectoryConfigSchema = z.strictObject({
  version: z.literal(1),
  path: z.string().min(1),
  instances: z.record(z.string().min(1), SelectionSchema).default({}),
})
/** 读好的目录级配置。 */
export type DirectoryConfig = z.output<typeof DirectoryConfigSchema>
type Selection = z.output<typeof SelectionSchema>

/** 解析的输入：实例名，加可选的目录级配置。 */
export interface ResolveAgentOptions {
  impl: string
  directory?: DirectoryConfig
}

/** 为一个实例选出的配置，已经是会话配置能直接用的形状（本事还要经 {@link materializeSkills} 落成目录）。 */
export interface ResolvedAgentConfig {
  skills: { name: string; dir: string }[]
  agents: string[]
  commands: string[]
  mcpServers: Record<string, McpServer>
  plugins: string[]
  hooks: Hooks
  instructions: string
}

/**
 * 读全局集；没有文件就是空集。
 * @param root - 全局集根目录（`$LIWA_HOME/agents`）。
 * @param env - 展开 `${VAR}` 用的环境；缺的变量装载即报。
 * @returns 读好的全局集。
 * @throws {BrainError} `invalid_input`（文件不合形状、名字不合法、钩子事件未知、MCP 名保留、环境变量缺失）。
 */
export async function loadAgentsConfig(root: string, env: Record<string, string | undefined> = process.env): Promise<AgentsConfig> {
  const path = join(root, AGENTS_CONFIG_FILE)
  const text = await readOptional(path)
  if (text === undefined) {
    return { version: 1, skills: {}, agents: {}, commands: {}, mcpServers: {}, plugins: {}, hooks: {}, instructions: {}, instances: {} }
  }
  const parsed = AgentsConfigSchema.safeParse(parseYamlDocument(text, path))
  if (!parsed.success) throw invalidFile(path, parsed.error.issues)
  const config = parsed.data
  for (const name of Object.keys(config.mcpServers)) {
    if (name === KERNEL_MCP_SERVER_NAME) throw new BrainError('invalid_input', 'brain.agent_config_invalid', `${path}: MCP server name ${name} is reserved for Liwa kernel tools`)
  }
  const library = await readPluginLibrary(root)
  const plugins = Object.fromEntries(Object.entries(config.plugins).map(([name, entry]) => {
    if ('dir' in entry) return [name, { ...entry, dir: resolvePath(root, entry.dir) }]
    const record = library.find(record => record.key === entry.library)
    if (record === undefined) throw new BrainError('invalid_input', 'brain.plugin_reference_missing', `Plugin library reference ${entry.library} is not installed`)
    return [name, { dir: record.dir, ...(entry.applyTo === undefined ? {} : { applyTo: entry.applyTo }) }]
  }))
  return {
    ...config,
    skills: mapValues(config.skills, entry => ({ ...entry, dir: resolvePath(root, entry.dir) })),
    agents: mapValues(config.agents, entry => ({ ...entry, dir: resolvePath(root, entry.dir) })),
    commands: mapValues(config.commands, entry => ({ ...entry, dir: resolvePath(root, entry.dir) })),
    plugins,
    instructions: mapValues(config.instructions, entry => ({ ...entry, file: resolvePath(root, entry.file) })),
    mcpServers: mapValues(config.mcpServers, entry => expandMcpEnvironment(entry, env, path)),
  }
}

/**
 * 某个工作目录的目录级配置文件路径：`<root>/dirs/<sha256(规范化绝对路径) 前 32 位>.yml`。
 * @param root - 全局集根目录。
 * @param cwd - 工作目录。
 * @returns 文件路径。
 */
export function directoryConfigPath(root: string, cwd: string): string {
  const hash = createHash('sha256').update(normalizeDirectory(cwd)).digest('hex').slice(0, 32)
  return join(root, AGENTS_DIRS_DIR, `${hash}.yml`)
}

/**
 * 读某个工作目录的目录级配置；没有就是 `undefined`。
 * @param root - 全局集根目录。
 * @param cwd - 工作目录。
 * @returns 读好的目录级配置。
 * @throws {BrainError} `invalid_input`（不合形状，或文件里记的 `path` 不是这个目录）。
 */
export async function loadDirectoryConfig(root: string, cwd: string): Promise<DirectoryConfig | undefined> {
  const path = directoryConfigPath(root, cwd)
  const text = await readOptional(path)
  if (text === undefined) return undefined
  const parsed = DirectoryConfigSchema.safeParse(parseYamlDocument(text, path))
  if (!parsed.success) throw invalidFile(path, parsed.error.issues)
  if (normalizeDirectory(parsed.data.path) !== normalizeDirectory(cwd)) {
    throw new BrainError('invalid_input', 'brain.agent_config_dir_mismatch', `${path} records path ${parsed.data.path}, not ${cwd}`)
  }
  return parsed.data
}

/**
 * 为一个实例选出配置：默认集是 `applyTo` 匹配的条目，全局 `instances.<impl>` 与目录级的 `use` 都能加；任何一级 `disable`
 * 的名字都不会被任何一级的 `use` 放回来（15 §4）。引用不存在的名字报错。指令片段按声明顺序读文件、空行相连。
 * @param config - 读好的全局集。
 * @param options - 实例名与目录级配置。
 * @returns 选出的配置。
 * @throws {BrainError} `invalid_input`（`use` / `disable` 引用的名字不存在）、`unavailable`（指令文件读不到）。
 */
export async function resolveAgentConfig(config: AgentsConfig, options: ResolveAgentOptions): Promise<ResolvedAgentConfig> {
  const selections = [config.instances[options.impl], options.directory?.instances[options.impl]]
    .filter(selection => selection !== undefined)
  const sections = [config.skills, config.agents, config.commands, config.mcpServers, config.plugins, config.hooks, config.instructions]
  const knownNames = new Set(sections.flatMap(entries => Object.keys(entries)))
  for (const selection of selections) {
    for (const name of [...selection.use, ...selection.disable]) {
      if (knownNames.has(name)) continue
      throw new BrainError('invalid_input', 'brain.agent_config_unknown_name', `agent configuration for ${options.impl} refers to ${name}, which is not in ${AGENTS_CONFIG_FILE}`)
    }
  }
  const skills = chosen(config.skills, options.impl, selections).map(([name, entry]) => ({ name, dir: entry.dir }))
  const mcpServers = Object.fromEntries(
    chosen(config.mcpServers, options.impl, selections).map(([name, entry]) => [name, mcpServerOf(entry)]),
  )
  const plugins = chosen(config.plugins, options.impl, selections).map(([, entry]) => entry.dir)
  const hooks: Hooks = {}
  for (const [, entry] of chosen(config.hooks, options.impl, selections)) {
    const matcher: HookMatcher = { ...(entry.matcher === undefined ? {} : { matcher: entry.matcher }), hooks: entry.hooks }
    hooks[entry.event] = [...(hooks[entry.event] ?? []), matcher]
  }
  const pieces: string[] = []
  for (const [name, entry] of chosen(config.instructions, options.impl, selections)) {
    const text = await readFile(entry.file, 'utf8').catch((error: unknown) => {
      throw new BrainError('unavailable', 'brain.agent_config_unreadable', `instruction ${name} at ${entry.file} cannot be read`, { cause: error })
    })
    pieces.push(text.trim())
  }
  return { skills, agents: chosen(config.agents, options.impl, selections).map(([, entry]) => entry.dir), commands: chosen(config.commands, options.impl, selections).map(([, entry]) => entry.dir), mcpServers, plugins, hooks, instructions: pieces.filter(piece => piece !== '').join('\n\n') }
}

/**
 * 把选出的本事拷进一个目录（每个本事一个子目录），给会话配置的 `skillsDir` 用。
 * @param skills - 选出的本事。
 * @param target - 目标目录；不存在就建。
 * @throws {BrainError} `invalid_input`（本事目录里没有 `SKILL.md`）。
 */
export async function materializeSkills(skills: readonly { name: string; dir: string }[], target: string): Promise<void> {
  await mkdir(target, { recursive: true })
  for (const skill of skills) {
    await stat(join(skill.dir, SKILL_FILE)).catch((error: unknown) => {
      throw new BrainError('invalid_input', 'brain.agent_config_skill_invalid', `skill ${skill.name} at ${skill.dir} has no ${SKILL_FILE}`, { cause: error })
    })
    await cp(skill.dir, join(target, skill.name), { recursive: true })
  }
}

function chosen<T extends { applyTo?: string[] | undefined }>(
  entries: Record<string, T>, impl: string, selections: Selection[],
): [string, T][] {
  const names = new Set(Object.keys(entries).filter(name => entries[name]?.applyTo === undefined || entries[name].applyTo.includes(impl)))
  for (const selection of selections) {
    for (const name of selection.use) if (name in entries) names.add(name)
  }
  for (const selection of selections) {
    for (const name of selection.disable) names.delete(name)
  }
  return Object.entries(entries).filter(([name]) => names.has(name))
}

function mcpServerOf(entry: McpServer & { applyTo?: string[] | undefined }): McpServer {
  const alwaysLoad = entry.alwaysLoad === undefined ? {} : { alwaysLoad: entry.alwaysLoad }
  if (entry.type === 'stdio') {
    return {
      type: 'stdio', command: entry.command,
      ...(entry.args === undefined ? {} : { args: entry.args }), ...(entry.env === undefined ? {} : { env: entry.env }), ...alwaysLoad,
    }
  }
  return { type: entry.type, url: entry.url, ...(entry.headers === undefined ? {} : { headers: entry.headers }), ...alwaysLoad }
}

function mapValues<T, U>(record: Record<string, T>, map: (value: T) => U): Record<string, U> {
  return Object.fromEntries(Object.entries(record).map(([name, value]) => [name, map(value)]))
}

function resolvePath(root: string, path: string): string {
  return isAbsolute(path) ? path : join(root, path)
}

function normalizeDirectory(path: string): string {
  return resolve(path).normalize('NFC')
}

function expandMcpEnvironment<T extends McpServer>(entry: T, env: Record<string, string | undefined>, path: string): T {
  const expand = (value: string): string => value.replace(ENV_REFERENCE, (_match, name: string) => {
    const found = env[name]
    if (found === undefined) throw new BrainError('invalid_input', 'brain.agent_config_env', `${path}: environment variable ${name} is not set`)
    return found
  })
  const expandRecord = (record: Record<string, string> | undefined): Record<string, string> | undefined => {
    return record === undefined ? undefined : mapValues(record, expand)
  }
  if (entry.type === 'stdio') {
    const stdioEnv = expandRecord(entry.env)
    return { ...entry, ...(stdioEnv === undefined ? {} : { env: stdioEnv }) }
  }
  const headers = expandRecord(entry.headers)
  return { ...entry, url: expand(entry.url), ...(headers === undefined ? {} : { headers }) }
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new BrainError('unavailable', 'brain.agent_config_unreadable', `${path} cannot be read`, { cause: error })
  }
}

function parseYamlDocument(text: string, path: string): unknown {
  let document: unknown
  try {
    document = parseYaml(text, { schema: JSON_SCHEMA, filename: path })
  } catch (error) {
    throw new BrainError('invalid_input', 'brain.agent_config_invalid', `${path} is not valid YAML: ${String(error)}`, { cause: error })
  }
  return document
}

function invalidFile(path: string, issues: readonly { path: readonly PropertyKey[]; message: string }[]): BrainError {
  const detail = issues.map(issue => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`).join('; ')
  return new BrainError('invalid_input', 'brain.agent_config_invalid', `${path} is invalid: ${detail}`)
}
