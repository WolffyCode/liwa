import { describe, expect, it } from 'vitest'
import { claudeConfigDir, claudeProjectDirSync } from '../src/paseo/agent/providers/claude/project-dir.ts'
import { normalizeClaudeRuntimeModelId } from '../src/paseo/agent/providers/claude/models.ts'

describe('Claude isolated native state', () => {
  it('requires an explicit configuration root rather than resolving a user profile', () => {
    expect(() => claudeConfigDir({})).toThrow('CLAUDE_CONFIG_DIR')
    expect(() => claudeConfigDir({ CLAUDE_CONFIG_DIR: '' })).toThrow('CLAUDE_CONFIG_DIR')
    expect(() => claudeProjectDirSync('/workspace')).toThrow('configDir')
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: '/isolated/member' })).toBe('/isolated/member')
    expect(claudeProjectDirSync('/workspace', { configDir: '/isolated/member' })).toBe('/isolated/member/projects/-workspace')
  })

  it('preserves configured custom model names without consulting a product catalog', () => {
    expect(normalizeClaudeRuntimeModelId(' deepseek-custom ')).toBe('deepseek-custom')
    expect(normalizeClaudeRuntimeModelId('')).toBeNull()
    expect(normalizeClaudeRuntimeModelId(undefined)).toBeNull()
  })
})
