/**
 * Claude Code 那一份成员配置（01 §4.6）：`claude/CLAUDE.md`（规矩）、`claude/settings.json`、
 * `claude/skills/`、`claude/projects/`（转录）。CLI 经 `CLAUDE_CONFIG_DIR` 只读这一份；MCP 只经
 * SDK 的 `mcpServers` 给，不写进设置文件。设置的细节（权限模式、禁用工具、`ANTHROPIC_BASE_URL`）
 * 由 `brain-claude` 接入时补全。
 * @module @liwa/brain/config-dir/claude
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { replaceSkills, rulesDocument, type MemberConfigSpec } from './shared.ts'

/**
 * 写 Claude Code 的成员配置。
 * @param brainsDir - 成员的 `brains/` 目录。
 * @param spec - 会话配置项。
 * @returns Claude 的配置目录（`CLAUDE_CONFIG_DIR` 指向它）。
 */
export async function writeClaudeConfig(brainsDir: string, spec: MemberConfigSpec): Promise<string> {
  const dir = join(brainsDir, 'claude')
  await mkdir(join(dir, 'projects'), { recursive: true })
  await writeFile(join(dir, 'CLAUDE.md'), rulesDocument(spec.rules))
  await writeFile(join(dir, 'settings.json'), `${JSON.stringify({ model: spec.model }, null, 2)}\n`)
  await replaceSkills(spec.skillsDir, join(dir, 'skills'))
  return dir
}
