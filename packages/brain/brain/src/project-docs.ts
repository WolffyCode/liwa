/**
 * 说明类项目文档的唯一收集规则；纯收集器与受限文件读取分开，供各提供方共用。
 * @module @liwa/brain/project-docs
 */
import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, matchesGlob, relative, resolve, sep } from 'node:path'
import { JSON_SCHEMA, load } from 'js-yaml'
import { z } from 'zod'
import { BrainError } from './errors.ts'

/** SDK 随附 CLI 2.1.263 的 wgs=5、lD 的 d>=wgs；根文件深度为 0。 */
export const PROJECT_IMPORT_DEPTH = 5
/** 已读取的说明文件；realPath 用于去重和越界检查。 */
export interface ProjectDocumentSource { path: string; realPath: string; text: string }
/** 可注入的说明；path 为仓库相对路径，identity 是内部去重键。 */
export interface ProjectDocument { path: string; identity: string; text: string }
/** 一次受控读取的结果，不读取项目执行配置。 */
export interface ProjectDocuments { root: string; documents: ProjectDocument[] }

const RuleFrontmatter = z.object({ paths: z.union([z.string(), z.array(z.string())]).optional() })

function inside(root: string, path: string): boolean {
  const local = relative(root, path)
  return local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local)
}

function directories(root: string, cwd: string): string[] {
  if (!inside(root, cwd)) throw documentError('outside', `Project path is outside the git root: ${cwd}`)
  const levels = [cwd]
  while (levels[0] !== root) levels.unshift(dirname(levels[0] as string))
  return levels
}

function description(text: string): { text: string; paths: string[] } {
  const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (front === null) return { text, paths: [] }
  const parsed = RuleFrontmatter.parse(load(front[1] as string, { schema: JSON_SCHEMA }) ?? {})
  const paths = typeof parsed.paths === 'string' ? parsed.paths.split(',') : parsed.paths ?? []
  return { text: text.slice(front[0].length), paths: paths.map(path => path.trim()).filter(Boolean) }
}

function imports(text: string): string[] {
  let fence: string | undefined
  const lines: string[] = []
  for (const line of text.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker !== undefined) {
      if (fence === undefined) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined
      continue
    }
    if (fence !== undefined || /^(?: {4}|\t)/.test(line)) continue
    lines.push(line)
  }
  const prose = lines.join('\n').replace(/(`+)[\s\S]*?\1/g, span => span.replace(/[^\r\n]/g, ' '))
  return [...prose.matchAll(/(?:^|\s)@(?:"([^"]+)"|'([^']+)'|([^\s]+))/g)]
    .map(match => (match[1] ?? match[2] ?? match[3]) as string)
}

/**
 * 从不可变文件快照纯计算静态或触及路径的说明，不访问文件系统、不修改快照。
 * @param sources - 候选说明与其导入闭包，含规范路径。
 * @param root - git 根；无 git 时就是 cwd。
 * @param cwd - 会话工作目录。
 * @param touched - 有值时收集到所触及文件的父目录，并选择匹配 paths 的规则。
 * @returns 按来源顺序展开且按 realpath 去重的正文。
 */
export function collectProjectDocs(
  sources: readonly ProjectDocumentSource[], root: string, cwd: string, touched?: string,
): ProjectDocument[] {
  const byPath = new Map(sources.map(source => [source.path, source]))
  const documents: ProjectDocument[] = []
  const seen = new Set<string>()
  const active = new Set<string>()
  const append = (path: string, depth: number): void => {
    if (!inside(root, path)) throw documentError('outside', `Import is outside the git root: ${path}`)
    if (depth >= PROJECT_IMPORT_DEPTH) throw documentError('depth', `Project import depth exceeds ${PROJECT_IMPORT_DEPTH}: ${path}`)
    const source = byPath.get(path)
    if (source === undefined) throw documentError('missing', `Project import is missing: ${relative(root, path)}`)
    if (!inside(root, source.realPath)) throw documentError('outside', `Project document resolves outside the git root: ${relative(root, path)}`)
    if (active.has(source.realPath)) throw documentError('cycle', `Project import cycle: ${relative(root, path)}`)
    if (seen.has(source.realPath)) return
    seen.add(source.realPath)
    active.add(source.realPath)
    const parsed = description(source.text)
    documents.push({ path: relative(root, path).split(sep).join('/'), identity: source.realPath, text: parsed.text })
    for (const imported of imports(parsed.text)) append(resolve(dirname(path), imported), depth + 1)
    active.delete(source.realPath)
  }
  const target = touched === undefined ? cwd : dirname(touched)
  for (const directory of directories(root, target)) {
    const primary = join(directory, 'CLAUDE.md')
    const fallback = join(directory, 'AGENTS.md')
    const paths = [byPath.has(primary) ? primary : fallback, join(directory, '.claude', 'CLAUDE.md')]
    const rules = sources.filter(source => dirname(source.path) === join(directory, '.claude', 'rules')).sort((left, right) => left.path.localeCompare(right.path))
    for (const rule of rules) {
      const conditions = description(rule.text).paths
      const matches = touched !== undefined && conditions.some(pattern => matchesGlob(relative(directory, touched).split(sep).join('/'), pattern))
      if (conditions.length === 0 || matches) paths.push(rule.path)
    }
    paths.push(join(directory, 'CLAUDE.local.md'))
    for (const path of paths) if (byPath.has(path)) append(path, 0)
  }
  return documents
}

/**
 * 只在 git 根以内读取说明及导入；无 git 根时只读 cwd，执行类配置不在候选表。
 * @param cwd - 会话工作目录。
 * @param touched - 可选的已触及文件；越出根时不加载额外说明。
 * @returns 根与完整的可注入说明。
 */
export async function readProjectDocs(cwd: string, touched?: string): Promise<ProjectDocuments> {
  const canonical = await realpath(cwd)
  let root = canonical
  let probe = canonical
  while (true) {
    if (await exists(join(probe, '.git'))) { root = probe; break }
    const parent = dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  const target = touched === undefined ? undefined : await resolveProjectDocumentPath(resolve(canonical, touched))
  if (target !== undefined && !inside(root, target)) return { root, documents: [] }
  const sources = new Map<string, ProjectDocumentSource>()
  const read = async (path: string, depth: number): Promise<void> => {
    if (!inside(root, path)) throw documentError('outside', `Import is outside the git root: ${path}`)
    if (depth >= PROJECT_IMPORT_DEPTH) throw documentError('depth', `Project import depth exceeds ${PROJECT_IMPORT_DEPTH}: ${relative(root, path)}`)
    if (sources.has(path)) return
    const actual = await realpath(path)
    if (!inside(root, actual)) throw documentError('outside', `Project document resolves outside the git root: ${relative(root, path)}`)
    const text = await readFile(actual, 'utf8')
    sources.set(path, { path, realPath: actual, text })
    const parsed = description(text)
    const ruleBase = dirname(path).endsWith(join('.claude', 'rules')) ? dirname(dirname(dirname(path))) : dirname(path)
    const matches = target !== undefined && parsed.paths.some(pattern => matchesGlob(relative(ruleBase, target).split(sep).join('/'), pattern))
    if (depth === 0 && parsed.paths.length > 0 && !matches) return
    for (const imported of imports(parsed.text)) await read(resolve(dirname(path), imported), depth + 1)
  }
  for (const directory of directories(root, target === undefined ? canonical : dirname(target))) {
    const primary = join(directory, 'CLAUDE.md')
    const candidates = [await exists(primary) ? primary : join(directory, 'AGENTS.md'), join(directory, '.claude', 'CLAUDE.md')]
    const ruleDir = join(directory, '.claude', 'rules')
    if (await exists(ruleDir)) {
      const actualRules = await realpath(ruleDir)
      if (!inside(root, actualRules)) throw documentError('outside', 'Project rules directory resolves outside the git root')
      for (const name of (await readdir(ruleDir)).sort()) if (name.endsWith('.md')) candidates.push(join(ruleDir, name))
    }
    candidates.push(join(directory, 'CLAUDE.local.md'))
    for (const path of candidates) {
      if (!await exists(path)) continue
      await read(path, 0)
    }
  }
  return { root, documents: collectProjectDocs([...sources.values()], root, canonical, target) }
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  return true
}

function documentError(reason: string, message: string): BrainError {
  return new BrainError('invalid_input', `brain.project_docs_${reason}`, message)
}

/**
 * 规范化说明触及路径；尚不存在的文件沿最近的真实祖先目录解析，避免符号链接别名进入事件路径。
 * @param path - 绝对路径。
 * @returns 规范化后的触及路径。
 */
export async function resolveProjectDocumentPath(path: string): Promise<string> {
  try { return await realpath(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return join(await resolveProjectDocumentPath(dirname(path)), basename(path))
}
