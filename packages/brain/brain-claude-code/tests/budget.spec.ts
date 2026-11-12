import { describe, expect, it } from 'vitest'
import { sampleSessionConfig } from '@liwa/brain-testkit'
import { SessionConfigSchema } from '@liwa/brain'
import { ClaudeTurnPolicy } from '../src/budget.ts'

const config = () => SessionConfigSchema.parse(sampleSessionConfig('/tmp/test', { concludeOn: ['report'], kernelTools: { endpoint: 'http://localhost/mcp', token: 'fake', tools: [{ id: 'report', description: 'Report', schema: {} }] } }))
const base = { session_id: 'session', transcript_path: '/tmp/owned', cwd: '/tmp/test' }
const call = { tool_name: 'mcp__liwa__report', tool_use_id: 'call', tool_input: {} }

describe('Claude tool batch conclusion', () => {
  it('stops only after a successful parent tool in the allowed kernel server', async () => {
    const policy = new ClaudeTurnPolicy(config())
    await policy.hook({ ...base, ...call, hook_event_name: 'PostToolUse', tool_response: { ok: true } })
    expect(await policy.hook({ ...base, hook_event_name: 'PostToolBatch', tool_calls: [call] })).toEqual({ continue: false, stopReason: 'Completed by report' })
    expect(policy.concludedBy).toBe('report')
    policy.begin()
    expect(policy.concludedBy).toBeUndefined()
  })

  it('does not conclude on failures, unknown results, other servers or child calls', async () => {
    for (const patch of [ { tool_name: 'mcp__other__report' }, { agent_id: 'child' }, { tool_response: { isError: true } } ]) {
      const policy = new ClaudeTurnPolicy(config())
      await policy.hook({ ...base, ...call, hook_event_name: 'PostToolUse', tool_response: {}, ...patch })
      expect(await policy.hook({ ...base, hook_event_name: 'PostToolBatch', tool_calls: [call] })).toEqual({})
    }
    const policy = new ClaudeTurnPolicy(config())
    expect(await policy.hook({ ...base, hook_event_name: 'PostToolBatch', tool_calls: [call] })).toEqual({})
    await policy.hook({ ...base, ...call, hook_event_name: 'PostToolUseFailure', error: 'failed' })
    expect(await policy.hook({ ...base, hook_event_name: 'PostToolBatch', tool_calls: [call] })).toEqual({})
  })

  it('forces every kernel-mode tool through permission routing, including child tools', async () => {
    const cfg = config()
    cfg.permission.mode = 'kernel'
    const policy = new ClaudeTurnPolicy(cfg)
    expect(await policy.hook({ ...base, ...call, agent_id: 'child', hook_event_name: 'PreToolUse' })).toMatchObject({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask' } })
  })
})

it('requires declared tool names and exact success, including multi-tool batches', async () => {
  const cfg = config()
  cfg.concludeOn = ['mcp__other__done', 'missing', 'report']
  cfg.mcpServers = { other: { type: 'http', url: 'http://example.invalid' } }
  const policy = new ClaudeTurnPolicy(cfg)
  for (const tool_name of ['Read', 'mcp__liwa__missing', 'mcp__liwa__ordinary']) {
    const entry = { ...call, tool_name }
    await policy.hook({ ...base, ...entry, hook_event_name: 'PostToolUse', tool_response: null })
    expect(await policy.hook({ ...base, hook_event_name: 'PostToolBatch', tool_calls: [entry] })).toEqual({})
  }
  const entry = { ...call, tool_name: 'mcp__other__done' }
  await policy.hook({ ...base, ...entry, hook_event_name: 'PostToolUse', tool_response: { is_error: false } })
  expect(await policy.hook({ ...base, hook_event_name: 'PostToolBatch', tool_calls: [{ ...call, tool_use_id: 'unknown' }, entry] })).toMatchObject({ continue: false })
  policy.begin()
  await policy.hook({ ...base, ...call, hook_event_name: 'PostToolUse', tool_response: { is_error: true } })
  expect(await policy.hook({ ...base, hook_event_name: 'PostToolBatch', tool_calls: [call] })).toEqual({})
})

it('keeps explicit owner session grants across turns without allowing other tools', async () => {
  const cfg = config()
  cfg.permission.mode = 'kernel'
  const policy = new ClaudeTurnPolicy(cfg)
  policy.allowSession('mcp__liwa__report')
  policy.begin()
  expect(await policy.hook({ ...base, ...call, hook_event_name: 'PreToolUse' })).toMatchObject({ hookSpecificOutput: { permissionDecision: 'allow' } })
  expect(await policy.hook({ ...base, ...call, tool_name: 'Bash', hook_event_name: 'PreToolUse' })).toMatchObject({ hookSpecificOutput: { permissionDecision: 'ask' } })
})

it('honors only exact configured auto-allow names', async () => {
  const cfg = config()
  cfg.permission.autoAllow = ['Read', 'report']
  const policy = new ClaudeTurnPolicy(cfg)
  for (const tool_name of ['Read', 'mcp__liwa__report']) {
    expect(await policy.hook({ ...base, ...call, tool_name, hook_event_name: 'PreToolUse' })).toMatchObject({ hookSpecificOutput: { permissionDecision: 'allow' } })
  }
  expect(await policy.hook({ ...base, ...call, tool_name: 'Bash', hook_event_name: 'PreToolUse' })).toEqual({})
})

it('concludes on a tool of an MCP server that only the instance row configures', async () => {
  const cfg = SessionConfigSchema.parse(sampleSessionConfig('/tmp/test', { concludeOn: ['mcp__inst__report'] }))
  const policy = new ClaudeTurnPolicy(cfg, ['inst'])
  const instanceCall = { tool_name: 'mcp__inst__report', tool_use_id: 'call-inst', tool_input: {} }
  await policy.hook({ ...base, ...instanceCall, hook_event_name: 'PostToolUse', tool_response: { ok: true } })
  expect(await policy.hook({ ...base, hook_event_name: 'PostToolBatch', tool_calls: [instanceCall] })).toEqual({ continue: false, stopReason: 'Completed by mcp__inst__report' })
  const unaware = new ClaudeTurnPolicy(cfg)
  await unaware.hook({ ...base, ...instanceCall, hook_event_name: 'PostToolUse', tool_response: { ok: true } })
  expect(await unaware.hook({ ...base, hook_event_name: 'PostToolBatch', tool_calls: [instanceCall] })).toEqual({})
})

it('delegates only owner-selected native tools to CLI while keeping MCP grants exact', async () => {
  const cfg = config()
  cfg.permission.mode = 'kernel'
  const policy = new ClaudeTurnPolicy(cfg)
  const bash = { ...base, ...call, tool_name: 'Bash', hook_event_name: 'PreToolUse' as const }
  expect(await policy.hook(bash)).toMatchObject({ hookSpecificOutput: { permissionDecision: 'ask' } })
  policy.delegateSession('Bash')
  expect(await policy.hook(bash)).toEqual({})
  expect(await policy.hook({ ...bash, agent_id: 'child' })).toEqual({})
  expect(await policy.hook({ ...bash, tool_name: 'Write' })).toMatchObject({ hookSpecificOutput: { permissionDecision: 'ask' } })
  policy.allowSession('mcp__liwa__report')
  expect(await policy.hook({ ...bash, tool_name: 'mcp__liwa__report' })).toMatchObject({ hookSpecificOutput: { permissionDecision: 'allow' } })
  policy.begin()
  expect(await policy.hook(bash)).toEqual({})
})
