/**
 * 成员配置目录各写法共用的部分：输入形状、规矩文本的优先级声明、本事目录的复制、MCP 服务器汇总。
 * 每家 CLI 的写法各在一个文件里（`claude.ts`、`codex.ts`、`deepseek.ts`），互不相干，便于各提供方
 * 分别细化自己那一份。
 * @module @liwa/brain/config-dir/shared
 */

import { cp, mkdir, rm, stat } from 'node:fs/promises'
import type { McpServer, SessionConfig } from '../contract.ts'
import { BrainError } from '../errors.ts'

/** 生成成员配置目录要用的会话配置项。 */
export type MemberConfigSpec = Pick<SessionConfig, 'rules' | 'skillsDir' | 'projectDocs' | 'model' | 'mcpServers' | 'kernelTools'>

/** 写在规矩文本最前面的优先级声明（four-layers §3.2、01 §4.6）。 */
export const RULES_PRECEDENCE = '本交接优先于通用指令。'

/** toolport 端点在 CLI 配置里的服务器名。 */
export const KERNEL_MCP_SERVER_NAME = 'liwa'

/**
 * 规矩文件的全文：优先级声明在前，规矩文本在后。
 * @param rules - self 提供的规矩文本。
 * @returns 写进 `CLAUDE.md` / `AGENTS.md` 的内容。
 */
export function rulesDocument(rules: string): string {
  const body = rules.trim()
  return body === '' ? `${RULES_PRECEDENCE}\n` : `${RULES_PRECEDENCE}\n\n${body}\n`
}

/**
 * 用本事目录整个替换 `target`（每次覆盖）。`skillsDir` 为空串表示没有本事，只留空目录。
 * @param skillsDir - 本事目录；每个本事一个子目录，内含 `SKILL.md`。
 * @param target - CLI 读的本事目录。
 * @throws {BrainError} `skillsDir` 不是目录时。
 */
export async function replaceSkills(skillsDir: string, target: string): Promise<void> {
  await rm(target, { recursive: true, force: true })
  if (skillsDir === '') {
    await mkdir(target, { recursive: true })
    return
  }
  const info = await stat(skillsDir).catch((error: unknown) => {
    throw new BrainError('invalid_input', 'brain.skills_dir_missing', `skillsDir ${skillsDir} cannot be read`, { cause: error })
  })
  if (!info.isDirectory()) {
    throw new BrainError('invalid_input', 'brain.skills_dir_missing', `skillsDir ${skillsDir} is not a directory`)
  }
  await cp(skillsDir, target, { recursive: true })
}

/**
 * 会话要给 CLI 的全部 MCP 服务器：toolport 端点（有的话）加调用方直接给的。
 * @param spec - 会话配置项。
 * @returns 按名字排好的服务器表。
 */
export function memberMcpServers(spec: MemberConfigSpec): Record<string, McpServer> {
  const servers: Record<string, McpServer> = {}
  const tools = spec.kernelTools
  if (tools !== undefined && 'endpoint' in tools) {
    servers[KERNEL_MCP_SERVER_NAME] = { type: 'http', url: tools.endpoint, headers: { Authorization: `Bearer ${tools.token}` } }
  }
  for (const [name, server] of Object.entries(spec.mcpServers ?? {})) servers[name] = server
  return servers
}
