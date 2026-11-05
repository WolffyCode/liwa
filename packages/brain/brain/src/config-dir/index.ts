/**
 * 成员配置目录（01 §4.6）：每个成员一份由 brains 生成、CLI 只读的目录，`<membersRoot>/<member>/brains/`，
 * 每家提供方一个子目录 `<impl>/`。目录里写什么由提供方自己的 `writeMemberConfig` 决定（每次覆盖）；
 * 这里只管目录位置、会话 home 的布局与各家共用的写法帮助（规矩文本、本事目录、MCP 汇总）。
 * @module @liwa/brain/config-dir
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { BrainSessionId, ImplId, MemberId } from '../brand.ts'
import type { BrainSessionHome } from '../provider.ts'
import type { MemberConfigSpec } from './shared.ts'

export { KERNEL_MCP_SERVER_NAME, RULES_PRECEDENCE, memberMcpServers, replaceSkills, rulesDocument } from './shared.ts'
export type { MemberConfigSpec } from './shared.ts'

/**
 * 成员的 `brains/` 目录。
 * @param membersRoot - 成员数据目录的根。
 * @param member - 成员。
 * @returns `<membersRoot>/<member>/brains`。
 */
export function memberBrainsDir(membersRoot: string, member: MemberId): string {
  return join(membersRoot, member, 'brains')
}

/** 一家提供方写自己那一份成员配置的方法（`BrainProvider.writeMemberConfig`）。 */
export type MemberConfigWriter = (dir: string, spec: MemberConfigSpec) => Promise<void>

/**
 * 生成或刷新一个成员给某家提供方的配置：建好 `<brains>/<impl>/`，再交给提供方写它那一份。
 * @param membersRoot - 成员数据目录的根。
 * @param member - 成员。
 * @param impl - 提供方。
 * @param spec - 会话配置项（规矩、本事、模型、MCP、是否读仓库指令）。
 * @param write - 提供方的写法；省略时只建空目录。
 * @returns 成员配置目录（`SessionConfig.configDir`）。
 */
export async function prepareMemberConfigDir(
  membersRoot: string,
  member: MemberId,
  impl: ImplId,
  spec: MemberConfigSpec,
  write: MemberConfigWriter | undefined,
): Promise<string> {
  const brainsDir = memberBrainsDir(membersRoot, member)
  const dir = join(brainsDir, impl)
  await mkdir(dir, { recursive: true })
  await write?.(dir, spec)
  return brainsDir
}

/**
 * 会话的提供方 home。
 * @param configDir - 成员配置目录。
 * @param impl - 提供方。
 * @param sessionId - brains 分配的会话号。
 * @param home - 提供方声明的布局。
 * @returns `per-session` 时 `<impl>/<会话号>`，`per-member` 时 `<impl>`。
 */
export function homeDirFor(configDir: string, impl: ImplId, sessionId: BrainSessionId, home: BrainSessionHome): string {
  switch (home) {
    case 'per-session':
      return join(configDir, impl, sessionId)
    case 'per-member':
      return join(configDir, impl)
  }
}
