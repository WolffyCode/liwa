import { executeToolFixture } from '@liwa/tool-testkit'
import * as NativeToolExecutor from '@liwa/tool-executor-native'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { unsupportedModel, provideWorkingDirectoryFixture, unsupportedInbox } from '@liwa/agent-loop-testkit'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@liwa/cordis'
import Loader from '@liwa/cordis-plugin-loader'
import Include from '@liwa/cordis-plugin-include'
import { ToolCallId } from '@liwa/llm'
import { Session, SessionId } from '@liwa/session'
import AgentRegistry from '@liwa/agent'
import type { Agent } from '@liwa/agent'
import SystemPrompt from '@liwa/system-prompt'
import ToolRuntime from '@liwa/tools'
import TerminalSessionService from '@liwa/terminal'
import SandboxProvider from '@liwa/sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@liwa/sandbox'
import SandboxPolicyService from '@liwa/sandbox-policy'
import SessionProjectionRegistry from '@liwa/session-projection'
import LocalSubprocessRuntime from '@liwa/subprocess-local'
import * as TerminalLocal from '@liwa/terminal-bash'
import * as ToolPty from '@liwa/tool-terminal'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

class PassthroughSandbox extends SandboxProvider {
  async confine(argv: readonly string[], _policy: SandboxPolicy): Promise<ConfinedArgv> {
    return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

async function agent(ctx: Context): Promise<Agent> {
  const scope = ctx.plugin(() => {})
  const id = SessionId('pty-loader-agent')
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session, model: unsupportedModel(),
    inbox: unsupportedInbox(),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {}, steer: () => {}, inject: () => {}, cancel() {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await ctx.agents.register(value)
  return value
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const suite = process.platform === 'linux' || process.platform === 'darwin' ? describe : describe.skip

suite('terminal real Loader composition through cordis.yml', () => {
  it('boots cordis.yml and preserves shell state across real tool calls', async () => {
    root = await mkdtemp(join(tmpdir(), 'liwa-pty-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@liwa/agent'",
      "- name: '@liwa/system-prompt'",
      "- name: '@liwa/tools'",
      "- name: '@liwa/tool-executor-native'",
      "- name: '@liwa/terminal'",
      "- name: '@liwa/test-sandbox'",
      "- name: '@liwa/session-projection'",
      "- name: '@liwa/sandbox-policy'",
      '  config:',
      '    mode: danger-full-access',
      `    workspaceRoot: ${JSON.stringify(root)}`,
      "- name: '@liwa/subprocess-local'",
      "- name: '@liwa/terminal-bash'",
      '  config:',
      '    pollIntervalMs: 10',
      '    exactProbeAfterMs: 20',
      '    idleSilenceMs: 250',
      '    handoffGraceMs: 250',
      '    timeoutMs: 2000',
      '    disposeGraceMs: 500',
      "- name: '@liwa/tool-terminal'",
      '',
    ].join('\n'))

    context = new Context()

    provideWorkingDirectoryFixture(context)
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@liwa/agent', AgentRegistry],
      ['@liwa/system-prompt', SystemPrompt],
      ['@liwa/tools', ToolRuntime],
      ['@liwa/tool-executor-native', NativeToolExecutor],
      ['@liwa/terminal', TerminalSessionService],
      ['@liwa/test-sandbox', PassthroughSandbox],
      ['@liwa/session-projection', SessionProjectionRegistry],
      ['@liwa/sandbox-policy', SandboxPolicyService],
      ['@liwa/subprocess-local', LocalSubprocessRuntime],
      ['@liwa/terminal-bash', TerminalLocal],
      ['@liwa/tool-terminal', ToolPty],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const owner = await agent(context)
    const signal = new AbortController().signal
    const spawn = await executeToolFixture(context, {
      signal, callId: ToolCallId('spawn'), name: 'terminal_open', arguments: { type: 'shell', name: 'main', cwd: root }, agent: owner,
    })
    expect(resultText(spawn)).toContain('started terminal session pty-1 (main)')

    await executeToolFixture(context, {
      signal, callId: ToolCallId('state'), name: 'terminal_send', arguments: { sessionId: 'pty-1', text: 'export KEEP=loader; cd /' }, agent: owner,
    })
    const read = await executeToolFixture(context, {
      signal, callId: ToolCallId('read'), name: 'terminal_send', arguments: { sessionId: 'pty-1', text: 'printf "cwd=%s keep=%s\\n" "$PWD" "$KEEP"' }, agent: owner,
    })
    expect(resultText(read)).toContain('cwd=/ keep=loader')
    expect(context.terminals.list(owner)).toHaveLength(1)
  }, 15_000)
})
