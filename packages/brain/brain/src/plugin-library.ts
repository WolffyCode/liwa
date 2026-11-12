/**
 * 灵鲸自有插件库登记；会话只引用已安装的目录，不参与安装或联网。
 * @module @liwa/brain/plugin-library
 */
import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { ImplIdSchema } from './contract.ts'

/** 已完成安装的唯一定位，key 为 impl/plugin@marketplace。 */
export const PluginLibraryRecordSchema = z.strictObject({
  key: z.string().min(1), impl: ImplIdSchema, name: z.string().min(1), marketplace: z.string().min(1),
  version: z.string().min(1), dir: z.string().min(1),
})
/** 安装记录中不保存认证、安装输出或展开后的环境变量。 */
export type PluginLibraryRecord = z.output<typeof PluginLibraryRecordSchema>
/** 安装与更新是显式配置操作，会话打开不调用这些操作。 */
export type PluginManagementRequest = { action: 'list' }
  | { action: 'install'; plugin: string; source: string }
  | { action: 'update' | 'remove'; plugin: string }

/**
 * 读取全部登记；不存在是空库，已存在但损坏的记录明确失败。
 * @param root - agents 配置根。
 * @returns 已校验的插件记录。
 */
export async function readPluginLibrary(root: string): Promise<PluginLibraryRecord[]> {
  const directory = join(root, 'plugin-library', 'records')
  let names: string[]
  try { names = await readdir(directory) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const records: PluginLibraryRecord[] = []
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue
    records.push(PluginLibraryRecordSchema.parse(JSON.parse(await readFile(join(directory, name), 'utf8'))))
  }
  return records
}

/**
 * 安装确认后原子登记一条记录。
 * @param root - agents 配置根。
 * @param record - 不含秘密的安装定位。
 */
export async function writePluginLibraryRecord(root: string, record: PluginLibraryRecord): Promise<void> {
  const directory = join(root, 'plugin-library', 'records')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmod(directory, 0o700)
  const path = recordPath(root, record.key)
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(PluginLibraryRecordSchema.parse(record)) + '\n', { mode: 0o600, flag: 'wx' })
  try { await rename(temporary, path) } finally { await rm(temporary, { force: true }) }
}

/**
 * 原生卸载成功后删除对应登记，不按 cwd 推测目录。
 * @param root - agents 配置根。
 * @param key - 明确的安装记录键。
 */
export async function removePluginLibraryRecord(root: string, key: string): Promise<void> {
  await rm(recordPath(root, key))
}

function recordPath(root: string, key: string): string {
  return join(root, 'plugin-library', 'records', `${createHash('sha256').update(key).digest('hex')}.json`)
}
