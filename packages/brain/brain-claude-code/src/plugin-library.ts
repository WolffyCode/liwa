/**
 * 显式插件安装命令使用实例 binary/env 与灵鲸专有配置；会话不会调用安装器。
 * @module @liwa/brain-claude-code/plugin-library
 */
import { chmod, mkdir, open, readFile, realpath, unlink } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { z } from 'zod'
import { BrainError, ImplId, execProviderCommand, readPluginLibrary, removePluginLibraryRecord, writePluginLibraryRecord, type BrainProcessHost, type PluginLibraryRecord, type PluginManagementRequest } from '@liwa/brain'
import { claudeParentEnvironment, instanceSecrets, type Config } from './config.ts'
import { ClaudeDiagnostics } from './diagnostics.ts'
import { sdkEnvironmentOverlay } from './process.ts'

const InstalledPlugins = z.object({
  version: z.literal(2),
  plugins: z.record(z.string(), z.array(z.object({ scope: z.string(), version: z.string().min(1), installPath: z.string().min(1) }))),
})
const PLUGIN_ID = /^([A-Za-z0-9][A-Za-z0-9_.-]*)@([A-Za-z0-9][A-Za-z0-9_.-]*)$/

/**
 * 安装、列出、更新、卸载一实例在灵鲸插件库里的插件；所有输出先脱敏。
 * @param host - 受管子进程入口。
 * @param config - 实例 binary/env 与时限。
 * @param root - agents 配置根，不是被干活仓库。
 * @param request - 显式管理动作；list 不启动子进程。
 * @returns 该实例更新后的安装登记。
 */
export async function manageClaudePlugins(
  host: BrainProcessHost, config: Config, root: string, request: PluginManagementRequest,
): Promise<PluginLibraryRecord[]> {
  const list = async (): Promise<PluginLibraryRecord[]> => (await readPluginLibrary(root)).filter(record => record.impl === config.impl)
  if (request.action === 'list') return list()
  const parsed = PLUGIN_ID.exec(request.plugin)
  if (parsed === null) throw new BrainError('invalid_input', 'brain.plugin_id', 'Plugin must be <plugin>@<marketplace>')
  const name = parsed[1] as string
  const marketplace = parsed[2] as string
  const key = `${config.impl}/${request.plugin}`
  const records = await list()
  const existing = records.find(record => record.key === key)
  if (request.action !== 'install' && existing === undefined) throw new BrainError('not_found', 'brain.plugin_missing', `Plugin ${key} is not in the Liwa library`)
  const library = join(root, 'plugin-library')
  const directory = join(library, config.impl)
  await mkdir(join(directory, 'home'), { recursive: true, mode: 0o700 })
  await chmod(library, 0o700)
  await chmod(directory, 0o700)
  const lockPath = join(directory, 'management.lock')
  const lock = await open(lockPath, 'wx', 0o600).catch((error: unknown) => {
    throw new BrainError('conflict', 'brain.plugin_busy', `Plugin management for ${config.impl} is locked; wait for the active operation or inspect management.lock after a crash`, { cause: error })
  })
  const diagnostics = new ClaudeDiagnostics(instanceSecrets(config))
  const execute = async (): Promise<void> => {
    const executable = await host.resolveExecutable(config.binary)
    const env = { ...claudeParentEnvironment(), ...config.env, HOME: join(directory, 'home'), USERPROFILE: join(directory, 'home'), CLAUDE_CONFIG_DIR: directory, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }
    const command = async (args: string[]): Promise<void> => {
      await diagnostics.protect(() => execProviderCommand(host, executable, [...config.binaryArgs, 'plugin', ...args], { cwd: directory, envOverlay: sdkEnvironmentOverlay(env), timeout: config.pluginInstallTimeoutMs, graceMs: config.graceMs }))
    }
    if (request.action === 'install') {
      await command(['marketplace', 'add', request.source])
      await command(['install', request.plugin, '--scope', 'user'])
    } else if (request.action === 'update') {
      await command(['marketplace', 'update', marketplace])
      await command(['update', request.plugin, '--scope', 'user'])
    } else {
      await command(['uninstall', request.plugin, '--scope', 'user'])
      await removePluginLibraryRecord(root, key)
      return
    }
    const installed = InstalledPlugins.parse(JSON.parse(await readFile(join(directory, 'plugins', 'installed_plugins.json'), 'utf8')))
    const entries = (installed.plugins[request.plugin] ?? []).filter(entry => entry.scope === 'user')
    if (entries.length !== 1) throw new BrainError('unavailable', 'brain.plugin_install_record', `CLI did not record exactly one user installation of ${request.plugin}`)
    const entry = entries[0] as (typeof entries)[number]
    const dir = await realpath(entry.installPath)
    const boundary = await realpath(directory)
    const local = relative(boundary, dir)
    if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) throw new BrainError('unavailable', 'brain.plugin_outside', 'Installed plugin directory escapes the Liwa plugin library')
    await writePluginLibraryRecord(root, { key, impl: ImplId(config.impl), name, marketplace, version: entry.version, dir })
  }
  try {
    await diagnostics.protect(execute)
  } finally {
    try { await lock.close() } finally { await unlink(lockPath) }
  }
  return list()
}
