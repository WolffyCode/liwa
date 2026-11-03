/**
 * Codex 那一份成员配置（01 §4.6）：`codex/config.toml`（模型、`mcp_servers`、不读仓库指令时
 * `project_doc_max_bytes = 0`）、`codex/AGENTS.md`（规矩）、`codex/skills/`、`codex/sessions/`（转录）。
 * CLI 经 `CODEX_HOME` 只读这一份。模型提供方与沙箱默认值由 `brain-codex` 接入时补全。
 * @module @liwa/brain/config-dir/codex
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { McpServer } from '../contract.ts'
import { memberMcpServers, replaceSkills, rulesDocument, type MemberConfigSpec } from './shared.ts'

/**
 * TOML 基本字符串（JSON 的字符串转义是它的子集）。
 * @param value - 原文。
 * @returns 带引号、转义好的 TOML 字符串。
 */
function tomlString(value: string): string {
  return JSON.stringify(value)
}

/**
 * TOML 行内表。
 * @param entries - 键值。
 * @returns `{ "k" = "v", ... }`。
 */
function tomlInlineTable(entries: Record<string, string>): string {
  return `{ ${Object.entries(entries).map(([key, value]) => `${tomlString(key)} = ${tomlString(value)}`).join(', ')} }`
}

/**
 * 一台 MCP 服务器的 TOML 表。
 * @param name - 服务器名。
 * @param server - 服务器。
 * @returns `[mcp_servers."name"]` 段。
 */
function mcpServerTable(name: string, server: McpServer): string {
  const lines = [`[mcp_servers.${tomlString(name)}]`]
  switch (server.type) {
    case 'stdio':
      lines.push(`command = ${tomlString(server.command)}`)
      if (server.args !== undefined) lines.push(`args = [${server.args.map(tomlString).join(', ')}]`)
      if (server.env !== undefined) lines.push(`env = ${tomlInlineTable(server.env)}`)
      break
    case 'http':
    case 'sse':
      lines.push(`url = ${tomlString(server.url)}`)
      if (server.headers !== undefined) lines.push(`http_headers = ${tomlInlineTable(server.headers)}`)
      break
  }
  return lines.join('\n')
}

/**
 * 写 Codex 的成员配置。
 * @param brainsDir - 成员的 `brains/` 目录。
 * @param spec - 会话配置项。
 * @returns Codex 的配置目录（`CODEX_HOME` 指向它）。
 */
export async function writeCodexConfig(brainsDir: string, spec: MemberConfigSpec): Promise<string> {
  const dir = join(brainsDir, 'codex')
  await mkdir(join(dir, 'sessions'), { recursive: true })
  const sections = [
    `model = ${tomlString(spec.model)}`,
    ...(spec.projectDocs ? [] : ['project_doc_max_bytes = 0']),
    ...Object.entries(memberMcpServers(spec)).map(([name, server]) => `\n${mcpServerTable(name, server)}`),
  ]
  await writeFile(join(dir, 'config.toml'), `${sections.join('\n')}\n`)
  await writeFile(join(dir, 'AGENTS.md'), rulesDocument(spec.rules))
  await replaceSkills(spec.skillsDir, join(dir, 'skills'))
  return dir
}
