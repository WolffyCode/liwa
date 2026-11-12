import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AGENTS_CONFIG_FILE, directoryConfigPath, loadAgentsConfig, loadDirectoryConfig, materializeSkills, resolveAgentConfig,
} from '../src/index.ts'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'liwa-agents-config-'))
  roots.push(root)
  for (const skill of ['review', 'release']) {
    await mkdir(join(root, 'skills', skill), { recursive: true })
    await writeFile(join(root, 'skills', skill, 'SKILL.md'), `---\nname: ${skill}\n---\n${skill} skill\n`)
  }
  await mkdir(join(root, 'plugins', 'reviewer', '.claude-plugin'), { recursive: true })
  await writeFile(join(root, 'plugins', 'reviewer', '.claude-plugin', 'plugin.json'), '{"name":"reviewer","version":"1.0.0"}')
  await mkdir(join(root, 'instructions'), { recursive: true })
  await writeFile(join(root, 'instructions', 'house.md'), 'HOUSE STYLE\n')
  await writeFile(join(root, 'instructions', 'secret.md'), 'SECRET NOTE\n')
  await writeFile(join(root, AGENTS_CONFIG_FILE), `
version: 1
skills:
  review: { dir: skills/review }
  release: { dir: skills/release, applyTo: [claude-a] }
mcpServers:
  docs: { type: http, url: https://mcp.example.test/docs, headers: { Authorization: 'Bearer \${AGENTS_TEST_TOKEN}' } }
  db: { type: stdio, command: /srv/db, args: [--fast], env: { DB_HOME: '\${AGENTS_TEST_TOKEN}-home' }, alwaysLoad: true, applyTo: [claude-a] }
  events: { type: sse, url: 'https://events.example.test/\${AGENTS_TEST_TOKEN}', alwaysLoad: false, applyTo: [nobody] }
plugins:
  reviewer: { dir: plugins/reviewer }
hooks:
  audit: { event: PreToolUse, matcher: Bash, hooks: [{ type: command, command: /srv/audit.sh }] }
  start: { event: SessionStart, hooks: [{ type: command, command: /srv/start.sh, timeout: 5 }], applyTo: [codex-b] }
instructions:
  house: { file: instructions/house.md }
  secret: { file: instructions/secret.md, applyTo: [claude-a] }
instances:
  claude-a: { disable: [docs] }
  codex-b: { use: [release] }
`)
  return root
}

describe('global agent configuration set', () => {
  it('loads entries with absolute paths and expands environment references in MCP headers', async () => {
    const root = await fixture()
    const config = await loadAgentsConfig(root, { AGENTS_TEST_TOKEN: 'tok-1' })
    expect(config.skills['review']?.dir).toBe(join(root, 'skills', 'review'))
    expect(config.plugins['reviewer']?.dir).toBe(join(root, 'plugins', 'reviewer'))
    expect(config.instructions['house']?.file).toBe(join(root, 'instructions', 'house.md'))
    expect(config.mcpServers['docs']).toMatchObject({ type: 'http', url: 'https://mcp.example.test/docs', headers: { Authorization: 'Bearer tok-1' } })
    expect(config.hooks['start']).toMatchObject({ event: 'SessionStart', applyTo: ['codex-b'] })
    await expect(loadAgentsConfig(root, {})).rejects.toMatchObject({ code: 'brain.agent_config_env' })
    const empty = await mkdtemp(join(tmpdir(), 'liwa-agents-empty-'))
    roots.push(empty)
    expect(await loadAgentsConfig(empty, {})).toEqual({
      version: 1, skills: {}, agents: {}, commands: {}, mcpServers: {}, plugins: {}, hooks: {}, instructions: {}, instances: {},
    })
  })

  it('rejects malformed files, bad names, unknown hook events and the reserved MCP name at load time', async () => {
    const root = await mkdtemp(join(tmpdir(), 'liwa-agents-bad-'))
    roots.push(root)
    const malformed = [
      'version: 1\nskills: [1, 2]\n', 'version: 2\n', 'version: 1\nskills: { "Bad Name": { dir: x } }\n',
      'version: 1\nhooks: { h: { event: Nope, hooks: [{ type: command, command: x }] } }\n',
      'version: 1\nmcpServers: { liwa: { type: http, url: https://x.invalid } }\n', ': not yaml: [\n',
      'version: 1\nskils: {}\n', 'version: 1\nskills: { a: { dir: x, nope: 1 } }\n',
      'version: 1\nmcpServers: { s: { type: stdio, command: x, extra: 1 } }\n', 'version: 1\ninstances: { x: { enable: [] } }\n',
    ]
    for (const text of malformed) {
      await writeFile(join(root, AGENTS_CONFIG_FILE), text)
      await expect(loadAgentsConfig(root, {})).rejects.toMatchObject({ category: 'invalid_input' })
    }
  })

  it('selects entries per instance by applyTo, use and disable, and concatenates instruction files', async () => {
    const root = await fixture()
    const config = await loadAgentsConfig(root, { AGENTS_TEST_TOKEN: 'tok-1' })
    const claude = await resolveAgentConfig(config, { impl: 'claude-a' })
    expect(claude.skills.map(skill => skill.name)).toEqual(['review', 'release'])
    expect(Object.keys(claude.mcpServers)).toEqual(['db'])
    expect(claude.mcpServers['db']).toEqual({ type: 'stdio', command: '/srv/db', args: ['--fast'], env: { DB_HOME: 'tok-1-home' }, alwaysLoad: true })
    expect(claude.plugins).toEqual([join(root, 'plugins', 'reviewer')])
    expect(claude.hooks).toEqual({ PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/srv/audit.sh' }] }] })
    expect(claude.instructions).toBe('HOUSE STYLE\n\nSECRET NOTE')
    const codex = await resolveAgentConfig(config, { impl: 'codex-b' })
    expect(codex.skills.map(skill => skill.name)).toEqual(['review', 'release'])
    expect(Object.keys(codex.mcpServers)).toEqual(['docs'])
    expect(codex.hooks).toEqual({
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '/srv/audit.sh' }] }],
      SessionStart: [{ hooks: [{ type: 'command', command: '/srv/start.sh', timeout: 5 }] }],
    })
    expect(codex.instructions).toBe('HOUSE STYLE')
    const nobody = await resolveAgentConfig(config, { impl: 'nobody' })
    expect(nobody.mcpServers).toEqual({ docs: { type: 'http', url: 'https://mcp.example.test/docs', headers: { Authorization: 'Bearer tok-1' } }, events: { type: 'sse', url: 'https://events.example.test/tok-1', alwaysLoad: false } })
    const other = await resolveAgentConfig(config, { impl: 'other' })
    expect(other.skills.map(skill => skill.name)).toEqual(['review'])
    expect(Object.keys(other.mcpServers)).toEqual(['docs'])
    expect(other.instructions).toBe('HOUSE STYLE')
    await expect(resolveAgentConfig({ ...config, instances: { other: { use: ['nope'], disable: [] } } }, { impl: 'other' })).rejects.toMatchObject({ code: 'brain.agent_config_unknown_name' })
  })

  it('applies a directory file on top of the instance selection and checks its path', async () => {
    const root = await fixture()
    const cwd = join(root, 'work')
    await mkdir(cwd)
    const file = directoryConfigPath(root, cwd)
    expect(file.startsWith(join(root, 'dirs'))).toBe(true)
    expect(directoryConfigPath(root, cwd)).toBe(directoryConfigPath(root, `${cwd}/`))
    await mkdir(join(root, 'dirs'), { recursive: true })
    await writeFile(file, `version: 1\npath: ${resolve(cwd)}\ninstances:\n  claude-a: { use: [docs, events], disable: [review] }\n`)
    const directory = await loadDirectoryConfig(root, cwd)
    expect(directory?.instances['claude-a']).toEqual({ use: ['docs', 'events'], disable: ['review'] })
    const config = await loadAgentsConfig(root, { AGENTS_TEST_TOKEN: 'tok-1' })
    const resolved = await resolveAgentConfig(config, { impl: 'claude-a', ...(directory === undefined ? {} : { directory }) })
    // 目录级能加（events），但全局 disable 的 docs 在任何一级都不会被 use 放回来。
    expect(resolved.skills.map(skill => skill.name)).toEqual(['release'])
    expect(Object.keys(resolved.mcpServers).sort()).toEqual(['db', 'events'])
    expect(await loadDirectoryConfig(root, join(root, 'elsewhere'))).toBeUndefined()
    await writeFile(file, 'version: 1\npath: /somewhere/else\ninstances: {}\n')
    await expect(loadDirectoryConfig(root, cwd)).rejects.toMatchObject({ code: 'brain.agent_config_dir_mismatch' })
    await writeFile(file, `version: 1\npath: ${resolve(cwd)}\ninstances:\n  claude-a: { instructions: [house] }\n`)
    await expect(loadDirectoryConfig(root, cwd)).rejects.toMatchObject({ code: 'brain.agent_config_invalid' })
  })

  it('materializes the selected skills into one directory and refuses a skill without SKILL.md', async () => {
    const root = await fixture()
    const config = await loadAgentsConfig(root, { AGENTS_TEST_TOKEN: 'tok-1' })
    const resolved = await resolveAgentConfig(config, { impl: 'claude-a' })
    const target = join(root, 'snapshot')
    await materializeSkills(resolved.skills, target)
    expect(await readFile(join(target, 'review', 'SKILL.md'), 'utf8')).toContain('review skill')
    expect(await readFile(join(target, 'release', 'SKILL.md'), 'utf8')).toContain('release skill')
    await mkdir(join(root, 'skills', 'broken'))
    await expect(materializeSkills([{ name: 'broken', dir: join(root, 'skills', 'broken') }], join(root, 'snapshot-2'))).rejects.toMatchObject({ code: 'brain.agent_config_skill_invalid' })
  })
})
