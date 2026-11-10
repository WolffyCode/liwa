import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { readClaudeWorkflowResultFile } from '../src/paseo/agent/providers/claude/subagents/workflow-output.ts'

it('reads only owned workflow output, including symlink resolution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'liwa-claude-workflow-'))
  const owned = join(root, 'owned')
  await mkdir(owned)
  await writeFile(join(owned, 'result'), JSON.stringify({ result: 'owned' }))
  await writeFile(join(root, 'outside'), JSON.stringify({ result: 'outside' }))
  await symlink(join(root, 'outside'), join(owned, 'link'))
  try {
    expect(readClaudeWorkflowResultFile(join(owned, 'result'), owned)).toBe('owned')
    expect(readClaudeWorkflowResultFile(join(root, 'outside'), owned)).toBeUndefined()
    expect(readClaudeWorkflowResultFile(join(owned, 'link'), owned)).toBeUndefined()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
