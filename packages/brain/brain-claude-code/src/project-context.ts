/**
 * 每代会话的项目说明快照与按需注入；模型可见正文在返回钩子前先发布完整事件。
 * @module @liwa/brain-claude-code/project-context
 */
import { resolve, relative, join } from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import type { HookInput } from '@anthropic-ai/claude-agent-sdk'
import { readProjectDocs, resolveProjectDocumentPath, type BrainEvent, type ProjectDocuments } from '@liwa/brain'

/** 每个会话只注入一次的受管说明，不加载执行类项目配置。 */
export class ClaudeProjectContext {
  private readonly seen: Set<string>
  /** 安装会话的持久观察出口；缺出口时拒绝注入。 */
  publish: ((event: BrainEvent) => void) | undefined
  private constructor(private readonly cwd: string, private readonly limit: number, readonly initial: ProjectDocuments) {
    this.seen = new Set(initial.documents.map(document => document.identity))
  }

  /**
   * 读取静态层，开会话时由同一套共享规则收集。
   * @param cwd - 会话目录。
   * @param limit - 单份动态注入的字节上限。
   * @returns 会话自己的说明状态。
   */
  static async create(cwd: string, limit: number): Promise<ClaudeProjectContext> {
    const canonical = await realpath(cwd)
    return new ClaudeProjectContext(canonical, limit, await readProjectDocs(canonical))
  }

  /**
   * 在 SDK 实际触及路径时注入；并发回调在发布后同步去重。
   * @param input - 原生工具钩子输入。
   * @returns 只包含本次新增说明的 additionalContext。
   */
  async hook(input: HookInput): Promise<{ hookSpecificOutput?: { hookEventName: 'PreToolUse'; additionalContext: string } }> {
    if (input.hook_event_name !== 'PreToolUse') return {}
    const toolInput = input.tool_input
    if (typeof toolInput !== 'object' || toolInput === null) return {}
    const parameters = toolInput as Record<string, unknown>
    const file = parameters['file_path'] ?? parameters['path'] ?? parameters['notebook_path'] ?? parameters['cwd']
    if (typeof file !== 'string') return {}
    if (this.publish === undefined) throw new Error('Project context requires a session event observer before tools run')
    const target = resolve(this.cwd, file)
    const reason = { tool: input.tool_name, path: relative(this.initial.root, target) || '.' }
    let resolved: { target: string; documents: ProjectDocuments }
    try {
      resolved = await this.documentsAt(target)
    } catch (error) {
      this.publish({ kind: 'session.project_document_failed', path: reason.path, reason, message: error instanceof Error ? error.message : String(error) })
      return {}
    }
    reason.path = relative(this.initial.root, resolved.target) || '.'
    const contexts: string[] = []
    for (const document of resolved.documents.documents) {
      if (this.seen.has(document.identity)) continue
      const text = `[Project instructions: ${document.path}]\n${document.text}`
      if (Buffer.byteLength(text) > this.limit) {
        this.publish({ kind: 'session.project_document_failed', path: document.path, reason, message: 'Project instructions exceed instructionsMaxBytes; shorten them or increase the configured limit' })
        continue
      }
      this.publish({ kind: 'session.project_document', path: document.path, reason, text })
      this.seen.add(document.identity)
      contexts.push(text)
    }
    if (contexts.length === 0) return {}
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: contexts.join('\n\n') } }
  }
  private async documentsAt(path: string): Promise<{ target: string; documents: ProjectDocuments }> {
    const actual = await resolveProjectDocumentPath(path)
    const metadata = await stat(actual).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    const target = metadata?.isDirectory() ? join(actual, '.liwa-project-context') : actual
    return { target: actual, documents: await readProjectDocs(this.cwd, target) }
  }

}
