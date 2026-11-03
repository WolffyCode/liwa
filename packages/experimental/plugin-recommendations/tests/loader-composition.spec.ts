/** Profile files, Loader, HMR, AgentLoop, skills and the card service are real; only model output is scripted. */
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { Context } from '@liwa/cordis'
import type { Include } from '@liwa/cordis-plugin-include'
import Timer from '@liwa/cordis-plugin-timer'
import { boot, initProfile, loadProfileDirectory, readProfilePatches, readProfileManifest, type ProfileContext } from '@liwa/app-boot'
import Hmr from '@liwa/hmr'
import PluginManager from '@liwa/plugin-manager'
import Sessions, { SessionId } from '@liwa/session'
import Projections from '@liwa/session-projection'
import Agents from '@liwa/agent'
import AgentLoop from '@liwa/agent-loop'
import Llm, { LlmAdapter, createUserMessage, type GenerateOptions, type StreamChunk } from '@liwa/llm'
import SystemPrompt from '@liwa/system-prompt'
import Tools from '@liwa/tools'
import * as NativeToolExecutor from '@liwa/tool-executor-native'
import Skills from '@liwa/skill'
import Access from '@liwa/api-remote-access'
import * as ActionCards from '@liwa/action-cards'
import * as Recommendations from '../src/index.ts'
import { ACTION, logProposal } from './fixture.ts'

class Model extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'Continuing the requested search.' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Continuing the requested search.' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

it.each(['normal', 'consumer-unload'] as const)('enables through the real Loader/HMR queue: %s', async (scenario) => {
  const home = await mkdtemp(join(tmpdir(), 'liwa-recommendations-'))
  let owner: Context | undefined
  onTestFinished(async () => { await owner?.fiber.dispose(); await rm(home, { recursive: true, force: true }) })
  const dir = join(home, 'profiles', 'test')
  const anchor = join(home, 'package.json')
  const name = '@liwa/experimental-session-search'
  await writeFile(anchor, JSON.stringify({ name: 'installation', dependencies: { [name]: '1.0.0' } }))
  initProfile(dir, ['fixture-base'])
  async function bundle(root: string, name: string, patch: string) {
    const path = join(root, 'node_modules', name)
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'package.json'), JSON.stringify({
      name, version: '1.0.0', description: 'Find previous conversations',
      liwa: { bundle: { patch: './cordis.patch.yml' } },
    }))
    await writeFile(join(path, 'cordis.patch.yml'), patch)
    return path
  }
  await bundle(dir, 'fixture-base', await readFile(new URL('./fixtures/cordis.yml', import.meta.url), 'utf8'))
  const plugin = await bundle(home, name, JSON.stringify([{ insert: [{ id: 'recommendation-probe', name: './plugin.mjs' }] }]))
  await writeFile(join(plugin, 'plugin.mjs'), 'export function apply(ctx) { ctx.provide("recommendationProbe", true) }\n')
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
  const profile: ProfileContext = {
    name: 'test', dir, home, cwd: home, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: anchor,
    startedBundles: loadProfileDirectory('test', dir, anchor).layers.map(layer => layer.packageName),
    overlays: [],
  }
  const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), (ctx) => {
    owner = ctx
    ctx.provide('profileContext', profile)
    ctx.provide('appReady', { onReady: (listener) => { listener(); return () => {} } })
    Object.assign(ctx.loader.builtins, {
      sessions: Sessions, projections: Projections, llm: Llm, prompt: SystemPrompt, tools: Tools,
      executor: NativeToolExecutor, skills: Skills, agents: Agents, loop: AgentLoop, access: Access, manager: PluginManager,
      actionCards: ActionCards, recommendations: Recommendations,
    })
  })
  // The profile's Include watches its file through the HMR queue; the watcher's initial event refreshes it once.
  const include = [...ctx.loader.entries()].find(entry => entry.options.name === 'cordis:include')?.subtree as Include | undefined
  if (include === undefined) throw new Error('the profile Include is not mounted')
  const includeRefresh = vi.spyOn(include, 'refresh')
  await ctx.plugin(Timer)
  await ctx.plugin(Hmr, { root: [], ignored: [], debounce: 0 })
  // The queue below then holds only the operations this test starts.
  await vi.waitFor(() => { expect(includeRefresh).toHaveBeenCalled() }, { timeout: 10_000 })
  await ctx.hmr.runExclusive(async () => {})
  expect([...ctx.loader.entries()].filter(entry => entry.options.id === 'action-cards')).toHaveLength(1)
  const model = new Model()
  ctx.llm.registerAdapter(['mock'], model)
  const agent = await ctx.agentLoop.create(SessionId('recommendation-live'), { provider: 'mock', model: 'test' })
  const callId = logProposal(ctx, agent, 'call-live', { title: 'Session search', brief: 'Search saved conversations', details: { name } })
  expect((await ctx.skills.list()).map(skill => skill.name)).toContain('official-plugins')
  expect(readProfileManifest('test', dir).liwa?.profile?.bundles).not.toContain(name)
  if (scenario === 'consumer-unload') {
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    onTestFinished(() => { release.resolve(undefined) })
    const reload = ctx.hmr.runExclusive(async () => {
      entered.resolve(undefined)
      await release.promise
      const fiber = [...ctx.loader.entries()].find(entry => entry.options.name === 'cordis:recommendations')?.fiber
      expect(fiber).toBeDefined()
      await fiber!.dispose()
    })
    await entered.promise
    const exclusive = vi.spyOn(ctx.hmr, 'runExclusive')
    const action = ctx.actionCards.act(agent, callId, 'enable')
    await vi.waitFor(() => { expect(exclusive).toHaveBeenCalledOnce() })
    release.resolve(undefined)
    await reload
    expect(await action).toEqual({ status: 'unconfirmed', reason: 'closing' })
    expect(ctx.actionCards.view(agent.session).decisions[callId]).toEqual({ callId, action: ACTION, phase: 'unconfirmed' })
    expect(ctx.get('pluginRecommendations')).toBeUndefined()
    expect(await ctx.skills.list()).toEqual([])
    await ctx.hmr.runExclusive(async () => {})
    expect(readProfileManifest('test', dir).liwa?.profile?.bundles).toContain(name)
    expect((await ctx.pluginManager.listBundles()).find(bundle => bundle.name === name)?.enabled).toBe(true)
    expect(model.requests).toHaveLength(0)
    return
  }
  const enabled = { callId, action: ACTION, phase: 'enabled' }
  expect(await ctx.actionCards.act(agent, callId, 'enable')).toEqual({ status: 'settled', decision: enabled })
  expect(readProfileManifest('test', dir).liwa?.profile?.bundles).toContain(name)
  expect([...ctx.loader.entries()].find(entry => entry.options.id === 'recommendation-probe')?.fiber).toBeDefined()
  expect((await ctx.pluginManager.listBundles()).find(bundle => bundle.name === name)?.enabled).toBe(true)
  // The outcome reaches the model with the next request; enabling starts no turn by itself.
  expect(agent.status).toBe('idle')
  expect(model.requests).toHaveLength(0)
  expect(ctx.actionCards.view(agent.session).decisions[callId]).toEqual(enabled)
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Thanks.' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(model.requests).toHaveLength(1)
  expect(JSON.stringify(model.requests[0]?.messages)).toContain('enabled means the plugin is on now')
})
