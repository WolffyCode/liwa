/**
 * 成员配置目录（01 §4.6）：每个成员一份由 brains 生成、CLI 只读的目录，
 * `<membersRoot>/<member>/brains/`。`prepare` 按提供方写那一家的子目录（每次覆盖）；
 * `homeDirFor` 给出会话的提供方 home：`deepseek` 每个会话一个 `deepseek/<sessionId>/`（它的
 * `LIWA_HOME`），其余提供方是 `<impl>/`。
 * @module @liwa/brain/config-dir
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrainSessionId, ImplId, MemberId } from '../brand.ts'
import { writeClaudeConfig } from './claude.ts'
import { writeCodexConfig } from './codex.ts'
import type { MemberConfigSpec } from './shared.ts'

export { KERNEL_MCP_SERVER_NAME, RULES_PRECEDENCE, memberMcpServers, rulesDocument } from './shared.ts'
export type { MemberConfigSpec } from './shared.ts'

/** 每个会话独占一个 home 的提供方（home 里放该会话的转录与 profile）。 */
const PER_SESSION_HOME: ReadonlySet<string> = new Set(['deepseek'])

/**
 * 成员的 `brains/` 目录。
 * @param membersRoot - 成员数据目录的根。
 * @param member - 成员。
 * @returns `<membersRoot>/<member>/brains`。
 */
export function memberBrainsDir(membersRoot: string, member: MemberId): string {
  return join(membersRoot, member, 'brains')
}

/**
 * 生成或刷新一个成员给某家提供方的配置。
 * @param membersRoot - 成员数据目录的根。
 * @param member - 成员。
 * @param impl - 提供方。
 * @param spec - 会话配置项（规矩、本事、模型、MCP、是否读仓库指令）。
 * @returns 成员配置目录（`SessionConfig.configDir`）。
 */
export async function prepareMemberConfigDir(
  membersRoot: string,
  member: MemberId,
  impl: ImplId,
  spec: MemberConfigSpec,
): Promise<string> {
  const brainsDir = memberBrainsDir(membersRoot, member)
  switch (impl) {
    case 'claude':
      await writeClaudeConfig(brainsDir, spec)
      break
    case 'codex':
      await writeCodexConfig(brainsDir, spec)
      break
    default:
      // deepseek 的会话 home 在开会话时按会话号建；其余提供方暂时只有一个空的 home。
      await mkdir(join(brainsDir, impl), { recursive: true })
  }
  return brainsDir
}

/**
 * 会话的提供方 home。
 * @param configDir - 成员配置目录。
 * @param impl - 提供方。
 * @param sessionId - brains 分配的会话号。
 * @returns `deepseek/<sessionId>`，或 `<impl>`。
 */
export function homeDirFor(configDir: string, impl: ImplId, sessionId: BrainSessionId): string {
  return PER_SESSION_HOME.has(impl) ? join(configDir, impl, sessionId) : join(configDir, impl)
}
