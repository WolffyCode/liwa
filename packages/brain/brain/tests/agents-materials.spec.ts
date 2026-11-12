import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createBrainTestHost, type BrainTestHost } from '@liwa/brain-testkit'
import { loadAgentsConfig, materializeSkills, resolveAgentConfig } from '../src/agents-config/index.ts'
let host: BrainTestHost | undefined
afterEach(async () => { await host?.dispose() })
it('selects file-based agents and commands with the same four-scope use/disable rules', async () => {
  host = await createBrainTestHost()
  await writeFile(join(host.root, 'agents.yml'), 'version: 1\nagents:\n  reviewer: {dir: review, applyTo: [other]}\ncommands:\n  check: {dir: commands}\ninstances:\n  test: {use: [reviewer]}\n')
  const config = await loadAgentsConfig(host.root, {})
  const resolved = await resolveAgentConfig(config, { impl: 'test', directory: { version: 1, path: host.root, instances: { test: { use: [], disable: ['check'] } } } })
  expect(resolved.agents).toEqual([join(host.root, 'review')])
  expect(resolved.commands).toEqual([])
  const enabled = await resolveAgentConfig(config, { impl: 'test' })
  expect(enabled.commands).toEqual([join(host.root, 'commands')])
  await mkdir(join(host.root, 'plugins'))
})

it('preserves optional MCP fields and reports unreadable configuration, instructions and missing skills', async () => {
  host = await createBrainTestHost()
  const path = join(host.root, 'agents.yml')
  await writeFile(path, `version: 1
mcpServers:
  bare: {type: stdio, command: fake}
  web: {type: http, url: 'https://example.invalid'}
instructions:
  empty: {file: ${JSON.stringify(join(host.root, 'empty.md'))}}
`)
  await writeFile(join(host.root, 'empty.md'), '')
  const config = await loadAgentsConfig(host.root, {})
  const selected = await resolveAgentConfig(config, { impl: 'test' })
  expect(selected.mcpServers).toEqual({ bare: { type: 'stdio', command: 'fake' }, web: { type: 'http', url: 'https://example.invalid' } })
  expect(selected.instructions).toBe('')
  config.instructions['missing'] = { file: join(host.root, 'missing.md') }
  await expect(resolveAgentConfig(config, { impl: 'test' })).rejects.toMatchObject({ code: 'brain.agent_config_unreadable' })
  await expect(materializeSkills([{ name: 'missing', dir: host.root }], join(host.root, 'output'))).rejects.toMatchObject({ code: 'brain.agent_config_skill_invalid' })
  await mkdir(join(host.root, 'unreadable'))
  await mkdir(join(host.root, 'unreadable', 'agents.yml'))
  await expect(loadAgentsConfig(join(host.root, 'unreadable'), {})).rejects.toMatchObject({ code: 'brain.agent_config_unreadable' })
})
