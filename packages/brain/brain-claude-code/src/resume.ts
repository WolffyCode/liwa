/**
 * 续接准入检查独立于 UI 的容错回放，只接受当前成员/impl 根内可读的原生转录。
 * @module @liwa/brain-claude-code/resume
 */
import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { BrainError, type ResumeHandle } from '@liwa/brain'
import { claudeTranscriptPath } from './paseo/agent/providers/claude/project-dir.ts'

/** 完整 UUID，包括标准版本位与 variant；禁止路径、残缺或任意连字符。 */
export const CLAUDE_SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * 确认原生转录可恢复；不把原始内容或底层错误值放进诊断。
 * @param handle - 只带原生身份与根的续接句柄。
 * @param home - brains 分配的当前成员 impl 根。
 * @param cwd - 用于原生目录编码，原目录变更时可在同一根下查找。
 * @returns 已验证的转录快照，后续历史回放复用正文。
 */
export async function validateResume(handle: ResumeHandle, home: string, cwd: string): Promise<{ path: string; text: string }> {
  if (handle.home === undefined) throw new BrainError('invalid_input', 'brain.claude_resume_root', 'Resume handle must include its original member/provider home')
  const originalHome = handle.home
  const inspect = async (): Promise<{ path: string; text: string }> => {
    const root = await resumeHome(home)
    if (await resumeHome(originalHome) !== root) throw new BrainError('invalid_input', 'brain.claude_resume_root', 'Resume belongs to a different member/provider home')
    const path = await realpath(await claudeTranscriptPath({ cwd, configDir: root, sessionId: handle.sessionRef }))
    const local = relative(root, path)
    if (local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) throw new BrainError('invalid_input', 'brain.claude_resume_root', 'Native transcript escapes the member/provider home')
    return { path, text: await readFile(path, 'utf8') }
  }
  let snapshot: { path: string; text: string }
  try {
    snapshot = await inspect()
  } catch (error) {
    if (error instanceof BrainError) throw error
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new BrainError('not_found', 'brain.claude_resume_missing', 'Native Claude transcript is missing; restore the member data or start a new session')
    throw new BrainError('unavailable', 'brain.claude_resume_unreadable', 'Native Claude transcript cannot be read; check member directory access')
  }
  let messages = 0
  for (const line of snapshot.text.split('\n').filter(line => line.trim() !== '')) {
    let row: unknown
    try {
      row = JSON.parse(line)
    } catch (_invalidJson) {
      throw corruptTranscript()
    }
    if (row === null || typeof row !== 'object' || !('type' in row) || typeof row.type !== 'string') throw corruptTranscript()
    if (row.type !== 'user' && row.type !== 'assistant') continue
    if (!('sessionId' in row) || row.sessionId !== handle.sessionRef || !('message' in row) || row.message === null || typeof row.message !== 'object' || !('role' in row.message) || row.message.role !== row.type || !('content' in row.message) || !(typeof row.message.content === 'string' || Array.isArray(row.message.content))) throw corruptTranscript()
    messages++
  }
  if (messages === 0) throw corruptTranscript()
  return snapshot
}

function corruptTranscript(): BrainError {
  return new BrainError('unavailable', 'brain.claude_resume_corrupt', 'Native Claude transcript is damaged or has no conversation; restore it or start a new session')
}

async function resumeHome(path: string): Promise<string> {
  try { return await realpath(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new BrainError('not_found', 'brain.claude_resume_home_missing', 'Member/provider home is missing; restore the original member directory before resuming')
    throw new BrainError('unavailable', 'brain.claude_resume_home_unreadable', 'Member/provider home cannot be resolved; check directory access')
  }
}
