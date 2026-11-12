import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrainTestHost, type BrainTestHost } from '@liwa/brain-testkit'
import { JsonValueSchema, KERNEL_MCP_SERVER_NAME } from '@liwa/brain'
import { Config, type Config as ClaudeConfig, type ThinkingOptionId, type ClaudeSessionPolicy, claudeEnvironment, instanceSecrets, resolveModel, resolveSessionPolicy, resolveThinking, applyThinking, sessionSecrets, validateConfig, writeMemberConfig } from '../src/config.ts'

const settings = (patch: Partial<ClaudeConfig> = {}): ClaudeConfig => Config(Object.assign({ env: { ANTHROPIC_API_KEY: 'instance-key' }, models: [{ id: 'mock', label: 'Mock', isDefault: true }] }, patch))
async function sdkOptions(policy: ClaudeSessionPolicy) {
  return { ...policy.options, settings: JsonValueSchema.parse(JSON.parse(await readFile(policy.options.settings as string, 'utf8'))), mcpServers: (JSON.parse(await readFile(policy.options.extraArgs?.['mcp-config'] as string, 'utf8')) as { mcpServers: Record<string, unknown> }).mcpServers }
}
let host: BrainTestHost | undefined
afterEach(async () => { vi.unstubAllEnvs(); await host?.dispose() })

describe('Claude instance configuration', () => {
  it('validates defaults, distinct models, exactly one authentication variable and endpoint shape', () => {
    validateConfig(settings())
    expect(resolveModel(settings()).id).toBe('mock')
    expect(() => resolveModel(settings({ models: [] }))).toThrow('(default)')
    expect(resolveModel(settings(), 'mock').id).toBe('mock')
    expect(() => resolveModel(settings(), 'absent')).toThrow('Unknown Claude model')
    for (const patch of [
      { binary: '' }, { env: { ANTHROPIC_API_KEY: 'k', CUSTOM_VALUE: 'bad\0value' } }, { models: [] },
      { models: [{ id: ' mock', label: 'Mock', isDefault: true, thinkingOptions: [] }] },
      { models: [{ id: 'mock', label: 'Mock', isDefault: false, thinkingOptions: [] }] },
      { models: [...settings().models, ...settings().models] },
      { env: {} }, { env: { ANTHROPIC_API_KEY: '' } }, { env: { ANTHROPIC_API_KEY: 'k', ANTHROPIC_AUTH_TOKEN: 't' } },
      { env: { ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'file:///tmp/service' } },
      { env: { ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'https://user:password@example.test' } },
    ]) expect(() =>{  validateConfig(settings(patch)) }).toThrow()
    expect(() =>{  validateConfig(settings({ env: {} })) }).toThrow('exactly one of ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN')
    validateConfig(settings({ env: { ANTHROPIC_AUTH_TOKEN: 'token', ANTHROPIC_BASE_URL: 'https://example.test' } }))
  })

  it('scrubs inherited credentials, CLI identity, settings and runtime injection', async () => {
    host = await createBrainTestHost()
    const pollution = join(host.root, 'polluted')
    await mkdir(join(pollution, '.claude'), { recursive: true })
    await writeFile(join(pollution, '.claude', 'settings.json'), JSON.stringify({ hooks: { SessionStart: [{ command: 'touch polluted' }] }, enabledPlugins: { malicious: true } }))
    await writeFile(join(host.root, '.mcp.json'), JSON.stringify({ mcpServers: { unwanted: { command: 'polluted' } } }))
    vi.stubEnv('CLAUDE_CONFIG_DIR', pollution)
    vi.stubEnv('CLAUDE_SECURESTORAGE_CONFIG_DIR', '')
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'host-token')
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'host-token')
    vi.stubEnv('ANTHROPIC_BASE_URL', 'http://host.invalid')
    vi.stubEnv('ANTHROPIC_MODEL', 'host-model')
    vi.stubEnv('API_TIMEOUT_MS', '123')
    vi.stubEnv('ARBITRARY_DEPLOYMENT_SETTING', 'host-value')
    vi.stubEnv('NODE_OPTIONS', '--require=/host/injection')
    const launch = host.launch()
    const cfg = host.sessionConfig({ compaction: 'off', env: { TASK_FLAG: 'yes' } })
    await writeMemberConfig(launch.homeDir, cfg)
    const env = claudeEnvironment(launch.homeDir, settings({ env: { ANTHROPIC_API_KEY: 'instance-key', ANTHROPIC_BASE_URL: 'https://one.invalid' } }), cfg)
    expect(env).toMatchObject({ HOME: join(launch.homeDir, 'home'), CLAUDE_CONFIG_DIR: launch.homeDir, ANTHROPIC_API_KEY: 'instance-key', ANTHROPIC_BASE_URL: 'https://one.invalid', DISABLE_COMPACT: '1', TASK_FLAG: 'yes' })
    for (const key of ['CLAUDE_SECURESTORAGE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL', 'NODE_OPTIONS', 'API_TIMEOUT_MS', 'ARBITRARY_DEPLOYMENT_SETTING']) expect(env).not.toHaveProperty(key)
    const policy = await resolveSessionPolicy(settings(), cfg, launch.homeDir)
    expect(await sdkOptions(policy)).toMatchObject({ settingSources: [], strictMcpConfig: true, mcpServers: {}, settings: { claudeMdExcludes: ['**'], enabledPlugins: {} } })
    expect(policy.options.plugins).toBeUndefined()
    expect(await readFile(join(launch.homeDir, 'settings.json'), 'utf8')).toBe('{}\n')
    await policy.dispose()
    expect(() => claudeEnvironment(launch.homeDir, settings(), host!.sessionConfig({ env: { CLAUDE_SECURESTORAGE_CONFIG_DIR: '' } }))).toThrow('owns environment')
    expect(() => claudeEnvironment(launch.homeDir, settings(), host!.sessionConfig({ env: { ANTHROPIC_API_KEY: 'session-key' } }))).toThrow('owns environment')
    expect(claudeEnvironment(launch.homeDir, settings(), host.sessionConfig())).not.toHaveProperty('DISABLE_COMPACT')
  })

  it('injects project text only when requested and keeps concurrent policy snapshots independent', async () => {
    host = await createBrainTestHost()
    const launch = host.launch()
    const doc = 'project sentinel'
    await writeFile(join(host.root, 'CLAUDE.md'), doc)
    const [one, two] = await Promise.all([
      resolveSessionPolicy(settings(), host.sessionConfig({ projectDocs: true, persona: { stable: 'persona-one', notes: 'notes-one', version: '1' }, rules: 'rules-one' }), launch.homeDir),
      resolveSessionPolicy(settings(), host.sessionConfig({ nativeToolPolicy: 'none', childPolicy: { native: false, maxDepth: 1, maxConcurrent: 1, crossCli: [] } }), launch.homeDir),
    ])
    expect(JSON.stringify(one.options.systemPrompt)).toContain(doc)
    expect(JSON.stringify(two.options.systemPrompt)).not.toContain(doc)
    expect(two.options.tools).toEqual([])
    expect(one.options.tools).toBeUndefined()
    expect(two.options.disallowedTools).toEqual(['Agent', 'Task'])
    await Promise.all([one.dispose(), two.dispose()])
  })

  it('rejects unsupported combinations before starting a CLI', async () => {
    host = await createBrainTestHost()
    const launch = host.launch()
    for (const mindKind of ['instance', 'think', 'own', 'tidy'] as const) {
      await expect(resolveSessionPolicy(settings(), host.sessionConfig({ mindKind }), launch.homeDir)).rejects.toMatchObject({ category: 'invalid_input' })
    }
    await expect(resolveSessionPolicy(settings(), host.sessionConfig({ nativeToolPolicy: 'readonly' }), launch.homeDir)).rejects.toThrow('Native children')
    await expect(resolveSessionPolicy(settings(), host.sessionConfig({ nativeToolPolicy: 'none', childPolicy: { native: false, maxDepth: 1, maxConcurrent: 1, crossCli: [] }, skillsDir: 'skills' }), launch.homeDir)).rejects.toThrow('Skills require')
    await expect(resolveSessionPolicy(settings(), host.sessionConfig({ modeId: 'bypassPermissions' }), launch.homeDir)).rejects.toThrow('acceptEdits')
    await expect(resolveSessionPolicy(settings({ instructionsMaxBytes: 1 }), host.sessionConfig(), launch.homeDir)).rejects.toThrow('instructionsMaxBytes')
  })
})

describe('Claude policy filesystem and transport boundaries', () => {
  it('accepts a missing project document but surfaces unreadable documents', async () => {
    host = await createBrainTestHost()
    const launch = host.launch()
    await (await resolveSessionPolicy(settings(), host.sessionConfig({ projectDocs: true }), launch.homeDir)).dispose()
    await mkdir(join(host.root, 'CLAUDE.md'))
    await expect(resolveSessionPolicy(settings(), host.sessionConfig({ projectDocs: true }), launch.homeDir)).rejects.toMatchObject({ code: 'EISDIR' })
  })

  it('isolates member skill snapshots and removes them after use or failed preparation', async () => {
    host = await createBrainTestHost()
    const launch = host.launch()
    const skills = join(host.root, 'skills')
    await mkdir(join(skills, 'review'), { recursive: true })
    await writeFile(join(skills, 'review', 'SKILL.md'), '# review')
    const cfg = host.sessionConfig({ skillsDir: skills })
    const [one, two] = await Promise.all([
      resolveSessionPolicy(settings(), cfg, launch.homeDir), resolveSessionPolicy(settings(), cfg, launch.homeDir),
    ])
    const first = one.options.plugins?.[0]?.path
    const second = two.options.plugins?.[0]?.path
    expect(first).not.toBe(second)
    expect(await readFile(join(first!, 'skills', 'review', 'SKILL.md'), 'utf8')).toBe('# review')
    await one.dispose()
    expect(await readFile(join(second!, 'skills', 'review', 'SKILL.md'), 'utf8')).toBe('# review')
    await two.dispose()
    await expect(resolveSessionPolicy(settings(), host.sessionConfig({ skillsDir: join(host.root, 'missing') }), launch.homeDir)).rejects.toThrow('cannot be read')
  })

  it('resolves readonly/plan and every MCP transport without leaking missing fields', async () => {
    host = await createBrainTestHost()
    const cfg = host.sessionConfig({ modeId: 'plan', nativeToolPolicy: 'readonly', childPolicy: { native: false, maxDepth: 0, maxConcurrent: 0, crossCli: [] }, mcpServers: {
      bare: { type: 'stdio', command: 'fake' }, full: { type: 'stdio', command: 'fake', args: ['x'], env: { A: 'b' } },
      http: { type: 'http', url: 'https://example.invalid', headers: { X: 'y' } }, sse: { type: 'sse', url: 'https://example.invalid/events' },
    } })
    const policy = await resolveSessionPolicy(settings(), cfg, host.launch().homeDir)
    expect(await sdkOptions(policy)).toMatchObject({ permissionMode: 'plan', tools: ['Read', 'Glob', 'Grep'], mcpServers: { bare: { args: [], env: {} }, full: { args: ['x'], env: { A: 'b' } }, sse: { headers: {} } } })
    await policy.dispose()
    await expect(resolveSessionPolicy(settings(), host.sessionConfig({ kernelTools: { native: [], token: 'fake' } }), host.launch().homeDir)).rejects.toThrow('MCP endpoint')
    expect(() =>{  validateConfig(settings({ env: { ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'https://:password@example.test' } })) }).toThrow()
  })
})


it('takes plaintext deployment variables like Paseo and forbids only isolation, loader and runtime-owned names', () => {
  validateConfig(settings({ env: { ANTHROPIC_AUTH_TOKEN: 'token', ANTHROPIC_MODEL: 'custom', API_TIMEOUT_MS: '60000', CUSTOM_FLAG: '1', ANTHROPIC_CUSTOM_HEADERS: 'X-Gateway: value', MAX_THINKING_TOKENS: '16000', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '32000', GATEWAY_TOKEN: 'plaintext' } }))
  for (const name of ['HOME', 'USERPROFILE', 'TMPDIR', 'CLAUDE_CONFIG_DIR', 'CLAUDE_SECURESTORAGE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN', 'DISABLE_COMPACT', 'DISABLE_AUTO_COMPACT', 'NODE_OPTIONS', 'XDG_CONFIG_HOME', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY', 'CLAUDE_CODE_USE_BEDROCK', 'ENABLE_TOOL_SEARCH']) {
    expect(() =>{  validateConfig(settings({ env: { ANTHROPIC_API_KEY: 'k', [name]: 'value' } })) }).toThrow('owns environment')
  }
  expect(() =>{  validateConfig(settings({ env: { ANTHROPIC_API_KEY: 'k', 'invalid-name': 'x' } })) }).toThrow('environment name')
  expect(instanceSecrets(settings({ env: { ANTHROPIC_AUTH_TOKEN: 'tok', ANTHROPIC_CUSTOM_HEADERS: 'hdr', ANTHROPIC_MODEL: 'm' } }))).toEqual(['tok', 'hdr'])
  expect(instanceSecrets(settings({ env: { ANTHROPIC_API_KEY: 'key', ANTHROPIC_CUSTOM_HEADERS: '' } }))).toEqual(['key'])
})

describe('thinking options', () => {
  const thinkingModel = (options: { id: ThinkingOptionId; label: string; isDefault?: boolean }[]) => settings({
    models: [{ id: 'mock', label: 'Mock', isDefault: true, thinkingOptions: options.map(option => ({ isDefault: false, ...option })) }],
  })

  it('maps the selected or default option to SDK thinking and effort, including off and ultracode', async () => {
    host = await createBrainTestHost()
    const home = host.launch().homeDir
    const config = thinkingModel([{ id: 'high', label: 'High', isDefault: true }, { id: 'off', label: 'Off' }, { id: 'ultracode', label: 'Ultra' }])
    const defaulted = await resolveSessionPolicy(config, host.sessionConfig(), home)
    expect(defaulted.options).toMatchObject({ thinking: { type: 'adaptive', display: 'summarized' }, effort: 'high' })
    expect((await sdkOptions(defaulted)).settings).not.toHaveProperty('ultracode')
    const off = await resolveSessionPolicy(config, host.sessionConfig({ thinking: 'off' }), home)
    expect(off.options.thinking).toEqual({ type: 'disabled' })
    expect(off.options).not.toHaveProperty('effort')
    const ultra = await resolveSessionPolicy(config, host.sessionConfig({ thinking: 'ultracode' }), home)
    expect(await sdkOptions(ultra)).toMatchObject({ effort: 'xhigh', thinking: { type: 'adaptive' }, settings: { ultracode: true } })
    const plain = await resolveSessionPolicy(settings(), host.sessionConfig(), home)
    expect(plain.options).not.toHaveProperty('thinking')
    expect(plain.options).not.toHaveProperty('effort')
    for (const policy of [defaulted, off, ultra, plain]) await policy.dispose()
  })

  it('rejects unknown, duplicate or doubly-default options and a selection the model does not offer', async () => {
    host = await createBrainTestHost()
    const home = host.launch().homeDir
    const unknownOption: unknown = { env: { ANTHROPIC_API_KEY: 'k' }, models: [{ id: 'mock', label: 'Mock', isDefault: true, thinkingOptions: [{ id: 'deep', label: 'Deep' }] }] }
    expect(() => { validateConfig(Config(unknownOption as ClaudeConfig)) }).toThrow('thinking')
    expect(() => { validateConfig(thinkingModel([{ id: 'high', label: 'A' }, { id: 'high', label: 'B' }])) }).toThrow('thinking')
    expect(() => { validateConfig(thinkingModel([{ id: 'high', label: 'A', isDefault: true }, { id: 'low', label: 'B', isDefault: true }])) }).toThrow('thinking')
    await expect(resolveSessionPolicy(thinkingModel([{ id: 'high', label: 'High' }]), host.sessionConfig({ thinking: 'max' }), home)).rejects.toThrow('thinking')
    await expect(resolveSessionPolicy(settings(), host.sessionConfig({ thinking: 'high' }), home)).rejects.toThrow('thinking')
  })
})

describe('permission modes', () => {
  it('accepts acceptEdits and auto, keeps bypassPermissions and dontAsk out', async () => {
    host = await createBrainTestHost()
    const home = host.launch().homeDir
    for (const modeId of ['default', 'plan', 'acceptEdits', 'auto']) {
      const policy = await resolveSessionPolicy(settings(), host.sessionConfig({ modeId }), home)
      expect(policy.options.permissionMode).toBe(modeId)
      await policy.dispose()
    }
    for (const modeId of ['bypassPermissions', 'dontAsk']) {
      await expect(resolveSessionPolicy(settings(), host.sessionConfig({ modeId }), home)).rejects.toMatchObject({ code: 'brain.mode_unknown' })
    }
  })
})

describe('instance skills, MCP servers, plugins and hooks', () => {
  const hook = { matcher: 'Write', hooks: [{ type: 'command' as const, command: 'echo written' }] }

  it('validates shapes and absolute paths at load time', () => {
    expect(() => { validateConfig(settings({ skills: 'relative/skills' })) }).toThrow('absolute')
    expect(() => { validateConfig(settings({ plugins: ['plugins/one'] })) }).toThrow('absolute')
    expect(() => { validateConfig(settings({ mcpServers: { 'bad name': { type: 'stdio', command: 'x' } } })) }).toThrow('MCP server name')
    expect(() => { validateConfig(settings({ mcpServers: { [KERNEL_MCP_SERVER_NAME]: { type: 'http', url: 'https://x.invalid' } } })) }).toThrow('reserved')
    expect(() => { validateConfig(settings({ mcpServers: { s: { type: 'stdio' } } })) }).toThrow('command')
    expect(() => { validateConfig(settings({ mcpServers: { h: { type: 'http', url: 'ftp://x' } } })) }).toThrow('url')
    expect(() => { validateConfig(settings({ hooks: { NotAnEvent: [hook] } })) }).toThrow('hook event')
    expect(() => { validateConfig(settings({ hooks: { PreToolUse: [{ matcher: 'Write', hooks: [] }] } })) }).toThrow('hook')
    expect(() => { validateConfig(settings({ hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: ' ' }] }] } })) }).toThrow('command')
    validateConfig(settings({
      skills: '/abs/skills', plugins: ['/abs/plugin'],
      mcpServers: {
        s: { type: 'stdio', command: 'x', args: ['a'], env: { K: 'v' } },
        h: { type: 'http', url: 'https://x.invalid', headers: { A: 'b' } }, e: { type: 'sse', url: 'http://x.invalid' },
      },
      hooks: { PreToolUse: [hook] },
    }))
  })

  it('merges instance and session MCP servers and refuses a name used by both', async () => {
    host = await createBrainTestHost()
    const home = host.launch().homeDir
    const config = settings({ mcpServers: { inst: { type: 'stdio', command: 'inst-cmd' }, web: { type: 'http', url: 'https://inst.invalid' } } })
    const policy = await resolveSessionPolicy(config, host.sessionConfig({ mcpServers: { sess: { type: 'sse', url: 'https://sess.invalid' } } }), home)
    expect((await sdkOptions(policy)).mcpServers).toEqual({
      inst: { type: 'stdio', command: 'inst-cmd', args: [], env: {} },
      web: { type: 'http', url: 'https://inst.invalid', headers: {} },
      sess: { type: 'sse', url: 'https://sess.invalid', headers: {} },
    })
    await policy.dispose()
    await expect(resolveSessionPolicy(config, host.sessionConfig({ mcpServers: { inst: { type: 'stdio', command: 'other' } } }), home)).rejects.toThrow('MCP server inst')
  })

  it('loads instance skills next to member skills, refuses a skill present in both, and lists plugin directories', async () => {
    host = await createBrainTestHost()
    const home = host.launch().homeDir
    const instanceSkills = join(host.root, 'instance-skills')
    const memberSkills = join(host.root, 'member-skills')
    const plugin = join(host.root, 'plugin-a')
    await mkdir(join(instanceSkills, 'shared-skill'), { recursive: true })
    await writeFile(join(instanceSkills, 'shared-skill', 'SKILL.md'), 'instance')
    await mkdir(join(memberSkills, 'member-skill'), { recursive: true })
    await writeFile(join(memberSkills, 'member-skill', 'SKILL.md'), 'member')
    await mkdir(join(plugin, '.claude-plugin'), { recursive: true })
    await writeFile(join(plugin, '.claude-plugin', 'plugin.json'), '{"name":"a","version":"1.0.0"}')
    const withBoth = settings({ skills: instanceSkills, plugins: [plugin] })
    const policy = await resolveSessionPolicy(withBoth, host.sessionConfig({ skillsDir: memberSkills }), home)
    const snapshot = policy.options.plugins?.find(entry => entry.path !== plugin)?.path ?? ''
    expect(policy.options.plugins).toEqual([{ type: 'local', path: plugin }, { type: 'local', path: snapshot }])
    expect(await readFile(join(snapshot, 'skills', 'shared-skill', 'SKILL.md'), 'utf8')).toBe('instance')
    expect(await readFile(join(snapshot, 'skills', 'member-skill', 'SKILL.md'), 'utf8')).toBe('member')
    await policy.dispose()
    await mkdir(join(memberSkills, 'shared-skill'), { recursive: true })
    await writeFile(join(memberSkills, 'shared-skill', 'SKILL.md'), 'member copy')
    await expect(resolveSessionPolicy(settings({ skills: instanceSkills }), host.sessionConfig({ skillsDir: memberSkills }), home)).rejects.toThrow('shared-skill')
    await expect(resolveSessionPolicy(settings({ plugins: [join(host.root, 'missing-plugin')] }), host.sessionConfig(), home)).rejects.toThrow('plugin')
    const onlyInstance = await resolveSessionPolicy(settings({ skills: instanceSkills }), host.sessionConfig(), home)
    expect(onlyInstance.options.plugins).toHaveLength(1)
    await onlyInstance.dispose()
  })

  it('passes instance hooks through the CLI settings layer', async () => {
    host = await createBrainTestHost()
    const home = host.launch().homeDir
    const hooks = { PreToolUse: [hook], SessionStart: [{ hooks: [{ type: 'command' as const, command: 'echo start', timeout: 5 }] }] }
    const policy = await resolveSessionPolicy(settings({ hooks }), host.sessionConfig(), home)
    expect((await sdkOptions(policy)).settings).toMatchObject({ hooks })
    await policy.dispose()
    const none = await resolveSessionPolicy(settings(), host.sessionConfig(), home)
    expect((await sdkOptions(none)).settings).not.toHaveProperty('hooks')
    await none.dispose()
  })
})

describe('session-level agent configuration', () => {
  it('merges session plugins, hooks (session first) and instructions with the instance ones in a fixed prompt order', async () => {
    host = await createBrainTestHost()
    const home = host.launch().homeDir
    const pluginA = join(host.root, 'plugin-a')
    const pluginB = join(host.root, 'plugin-b')
    for (const dir of [pluginA, pluginB]) {
      await mkdir(join(dir, '.claude-plugin'), { recursive: true })
      await writeFile(join(dir, '.claude-plugin', 'plugin.json'), '{"name":"x","version":"1.0.0"}')
    }
    await writeFile(join(host.root, 'CLAUDE.md'), 'PROJECT-DOC')
    const instanceHook = { matcher: 'Bash', hooks: [{ type: 'command' as const, command: 'echo instance' }] }
    const sessionHook = { hooks: [{ type: 'command' as const, command: 'echo session' }] }
    const timedHook = { matcher: 'Write', hooks: [{ type: 'command' as const, command: 'echo timed', timeout: 3 }] }
    const policy = await resolveSessionPolicy(
      settings({ plugins: [pluginA], hooks: { PreToolUse: [instanceHook] } }),
      host.sessionConfig({
        plugins: [pluginB], hooks: { PreToolUse: [sessionHook, timedHook], SessionStart: [sessionHook] }, instructions: 'SESSION-INSTRUCTIONS',
        rules: 'RULES', projectDocs: true, persona: { stable: 'STABLE', notes: 'NOTES', version: 'v' },
      }),
      home,
    )
    expect(policy.options.plugins).toEqual([{ type: 'local', path: pluginA }, { type: 'local', path: pluginB }])
    expect((await sdkOptions(policy)).settings).toMatchObject({
      hooks: { PreToolUse: [sessionHook, timedHook, instanceHook], SessionStart: [sessionHook] },
    })
    const prompt = policy.options.systemPrompt
    const append = typeof prompt === 'object' && prompt !== null && 'append' in prompt ? prompt.append ?? '' : ''
    const order = ['STABLE', 'RULES', 'SESSION-INSTRUCTIONS', 'PROJECT-DOC', 'NOTES'].map(marker => append.indexOf(marker))
    expect(order.every(index => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    await policy.dispose()
  })
})

describe('secrets carried by MCP servers and kernel tools', () => {
  it('lists header values, bearer tokens, stdio env values and the kernel token for redaction', () => {
    const secrets = sessionSecrets({
      docs: { type: 'http', url: 'https://x.invalid', headers: { Authorization: 'Bearer tok-abcdefgh', 'X-Key': 'k-12345678' } },
      db: { type: 'stdio', command: 'db', env: { DB_PASS: 'pw-12345678', SHORT: 'ab' } },
      bare: { type: 'sse', url: 'https://y.invalid' },
    }, { endpoint: 'http://127.0.0.1:1/mcp', token: 'kernel-token-1', tools: [] })
    expect(secrets).toEqual(['Bearer tok-abcdefgh', 'tok-abcdefgh', 'k-12345678', 'pw-12345678', 'kernel-token-1'])
    expect(sessionSecrets({}, undefined)).toEqual([])
  })
})

describe('binary arguments', () => {
  it('accepts extra arguments for the executable and rejects NUL bytes', () => {
    validateConfig(settings({ binaryArgs: ['--wrapper-flag', 'value'] }))
    expect(() => { validateConfig(settings({ binaryArgs: ['bad\0arg'] })) }).toThrow('binaryArgs')
  })
})

it('snapshots instance and project agents/commands and keeps settings/MCP secrets in private files', async () => {
  host = await createBrainTestHost()
  const home = host.launch().homeDir
  const agents = join(host.root, 'configured-agents')
  const commands = join(host.root, 'configured-commands')
  await mkdir(agents)
  await mkdir(join(commands, 'nested'), { recursive: true })
  await writeFile(join(agents, 'reviewer.md'), 'reviewer')
  await writeFile(join(commands, 'nested', 'check.md'), 'check')
  await mkdir(join(host.root, '.claude', 'agents'), { recursive: true })
  await writeFile(join(host.root, '.claude', 'agents', 'worker.md'), 'worker')
  const secret = 'fake-mcp-header-token'
  const policy = await resolveSessionPolicy(settings({ agents, commands, hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: `echo ${secret}` }] }] } }), host.sessionConfig({ projectDocs: true, mcpServers: { docs: { type: 'http', url: 'https://docs.invalid', headers: { Authorization: secret } } } }), home)
  const snapshot = policy.options.plugins?.at(-1)?.path as string
  expect(await readFile(join(snapshot, 'agents', 'reviewer.md'), 'utf8')).toBe('reviewer')
  expect(await readFile(join(snapshot, 'agents', 'worker.md'), 'utf8')).toBe('worker')
  expect(await readFile(join(snapshot, 'commands', 'nested', 'check.md'), 'utf8')).toBe('check')
  expect(policy.options.mcpServers).toBeUndefined()
  expect(typeof policy.options.settings).toBe('string')
  expect(JSON.stringify(policy.options)).not.toContain(secret)
  const settingsFile = policy.options.settings as string
  expect(await readFile(settingsFile, 'utf8')).toContain(secret)
  const mcpFile = policy.options.extraArgs?.['mcp-config'] as string
  expect(await readFile(mcpFile, 'utf8')).toContain(secret)
  await policy.dispose()
  await expect(readFile(mcpFile)).rejects.toThrow()
  await writeFile(join(agents, 'worker.md'), 'duplicate')
  const conflict = resolveSessionPolicy(settings({ agents }), host.sessionConfig({ projectDocs: true }), home)
  await expect(conflict).rejects.toThrow(/worker.*configured-agents.*\.claude|worker.*\.claude.*configured-agents/s)
})

it('collects project materials from the git root to cwd and merges distinct nested command names', async () => {
  host = await createBrainTestHost()
  await mkdir(join(host.root, '.git'))
  const cwd = join(host.root, 'sub')
  await mkdir(join(host.root, '.claude', 'agents'), { recursive: true })
  await mkdir(join(host.root, '.claude', 'commands', 'nested'), { recursive: true })
  await mkdir(join(cwd, '.claude', 'commands', 'nested'), { recursive: true })
  await writeFile(join(host.root, '.claude', 'agents', 'root.md'), 'root agent')
  await writeFile(join(host.root, '.claude', 'commands', 'nested', 'root.md'), 'root command')
  await writeFile(join(cwd, '.claude', 'commands', 'nested', 'sub.md'), 'sub command')
  const policy = await resolveSessionPolicy(settings(), host.sessionConfig({ cwd, projectDocs: true }), host.launch().homeDir)
  const snapshot = policy.options.plugins?.at(-1)?.path as string
  expect(await readFile(join(snapshot, 'agents', 'root.md'), 'utf8')).toBe('root agent')
  expect(await readFile(join(snapshot, 'commands', 'nested', 'root.md'), 'utf8')).toBe('root command')
  expect(await readFile(join(snapshot, 'commands', 'nested', 'sub.md'), 'utf8')).toBe('sub command')
  await policy.dispose()
})

it('leaves unselected thinking to CLI and accepts absent optional MCP fields through the typed configuration API', () => {
  const config = settings()
  config.mcpServers = { bare: { type: 'stdio', command: 'bare' }, web: { type: 'http', url: 'https://x.invalid' } }
  validateConfig(config)
  expect(sessionSecrets({ bare: { type: 'stdio', command: 'bare' } }, undefined)).toEqual([])
  expect(resolveThinking({ id: 'm', label: 'M', isDefault: true, thinkingOptions: [{ id: 'high', label: 'H', isDefault: false }] }, undefined)).toEqual({ ultracode: false })
  const options: import('@anthropic-ai/claude-agent-sdk').Options = {}
  applyThinking(options, { ultracode: false })
  expect(options).toEqual({})
})

it('rejects project material links outside the git root and directory cycles, while copying nested skill assets', async () => {
  host = await createBrainTestHost()
  const root = join(host.root, 'repo')
  await mkdir(join(root, '.git'), { recursive: true })
  await mkdir(join(root, '.claude'))
  const outside = join(host.root, 'outside')
  await mkdir(outside)
  await symlink(outside, join(root, '.claude', 'agents'))
  await expect(resolveSessionPolicy(settings(), host.sessionConfig({ cwd: root, projectDocs: true }), host.launch().homeDir)).rejects.toMatchObject({ code: 'brain.project_material_outside' })
  await rm(join(root, '.claude', 'agents'))
  await mkdir(join(root, '.claude', 'agents'))
  await symlink(outside, join(root, '.claude', 'agents', 'escape'))
  await expect(resolveSessionPolicy(settings(), host.sessionConfig({ cwd: root, projectDocs: true }), host.launch().homeDir)).rejects.toMatchObject({ code: 'brain.project_material_outside' })
  await rm(join(root, '.claude', 'agents'), { recursive: true })
  await symlink('agents', join(root, '.claude', 'agents'))
  await expect(resolveSessionPolicy(settings(), host.sessionConfig({ cwd: root, projectDocs: true }), host.launch().homeDir)).rejects.toMatchObject({ code: 'ELOOP' })
  const skills = join(host.root, 'skill-materials')
  await mkdir(join(skills, 'review', 'assets', 'nested'), { recursive: true })
  await writeFile(join(skills, 'review', 'SKILL.md'), 'review')
  await writeFile(join(skills, 'review', 'assets', 'nested', 'asset.txt'), 'asset')
  const policy = await resolveSessionPolicy(settings({ skills }), host.sessionConfig(), host.launch().homeDir)
  expect(await readFile(join(policy.options.plugins!.at(-1)!.path, 'skills', 'review', 'assets', 'nested', 'asset.txt'), 'utf8')).toBe('asset')
  await policy.dispose()
  await symlink(skills, join(skills, 'loop'))
  await expect(resolveSessionPolicy(settings({ skills }), host.sessionConfig(), host.launch().homeDir)).rejects.toMatchObject({ code: 'brain.material_cycle' })
})
