import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createBrainTestHost, type BrainTestHost } from '@liwa/brain-testkit'
import { loadAgentsConfig, resolveAgentConfig } from '@liwa/brain'
import { Config } from '../src/config.ts'
import { manageClaudePlugins } from '../src/plugin-library.ts'
import { ClaudeBrainProvider } from '../src/provider.ts'
let host: BrainTestHost | undefined
afterEach(async () => { await host?.dispose() })
it('installs, records, resolves, updates and removes plugins using only the configured fake binary', async () => {
  host = await createBrainTestHost()
  const binary = join(host.root, 'plugin-cli')
  await writeFile(binary, `#!/usr/bin/env node
import {mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.env.CLAUDE_CONFIG_DIR;
appendFileSync(join(root,'calls.jsonl'),JSON.stringify(process.argv.slice(2))+'\\n');
if(process.argv.includes('install')||process.argv.includes('update')&&!process.argv.includes('marketplace')){
 const dir=join(root,'plugins','cache','reviewer');mkdirSync(join(dir,'.claude-plugin'),{recursive:true});
 writeFileSync(join(dir,'.claude-plugin','plugin.json'),'{}');
 writeFileSync(join(root,'plugins','installed_plugins.json'),JSON.stringify({version:2,plugins:{'reviewer@demo':[{scope:'user',version:process.argv.includes('update')?'2':'1',installPath:dir}]}}));
}
`, { mode: 0o700 })
  const config = Config({ impl: 'fake', binary, env: { ANTHROPIC_API_KEY: 'fake-library-key' }, models: [{ id: 'mock', label: 'Mock', isDefault: true, thinkingOptions: [] }] })
  const root = join(host.root, 'agents')
  const context = host.probeContext()
  const installed = await new ClaudeBrainProvider(config).managePlugins(context, root, { action: 'install', plugin: 'reviewer@demo', source: 'local-source' })
  expect(installed).toMatchObject([{ key: 'fake/reviewer@demo', name: 'reviewer', marketplace: 'demo', version: '1' }])
  expect((await stat(join(root, 'plugin-library'))).mode & 0o777).toBe(0o700)
  await writeFile(join(root, 'agents.yml'), 'version: 1\nplugins:\n  reviewer: {library: fake/reviewer@demo}\n')
  const resolved = await resolveAgentConfig(await loadAgentsConfig(root, {}), { impl: 'fake' })
  expect(resolved.plugins).toEqual([installed[0]?.dir])
  await writeFile(join(root, 'agents.yml'), 'version: 1\nplugins:\n  reviewer: {library: fake/reviewer@demo, applyTo: [fake]}\n')
  expect((await resolveAgentConfig(await loadAgentsConfig(root, {}), { impl: 'other' })).plugins).toEqual([])
  expect(await manageClaudePlugins(context, config, root, { action: 'list' })).toEqual(installed)
  expect(await manageClaudePlugins(context, config, root, { action: 'update', plugin: 'reviewer@demo' })).toMatchObject([{ version: '2' }])
  const calls = await readFile(join(root, 'plugin-library', 'fake', 'calls.jsonl'), 'utf8')
  expect(calls).toContain('marketplace')
  expect(calls).not.toContain('fake-library-key')
  expect(await manageClaudePlugins(context, config, root, { action: 'remove', plugin: 'reviewer@demo' })).toEqual([])
  await expect(loadAgentsConfig(root, {})).rejects.toThrow('fake/reviewer@demo')
})

it('rejects invalid identifiers, missing updates, concurrent management and invalid CLI installation records', async () => {
  host = await createBrainTestHost()
  const root = join(host.root, 'agents')
  const binary = join(host.root, 'broken-plugin-cli')
  const config = Config({ impl: 'fake', binary, env: { ANTHROPIC_API_KEY: 'fake-library-key' }, models: [{ id: 'mock', label: 'Mock', isDefault: true, thinkingOptions: [] }] })
  const context = host.probeContext()
  await expect(manageClaudePlugins(context, config, root, { action: 'install', plugin: '../bad', source: 'local' })).rejects.toMatchObject({ code: 'brain.plugin_id' })
  await expect(manageClaudePlugins(context, config, root, { action: 'update', plugin: 'reviewer@demo' })).rejects.toMatchObject({ code: 'brain.plugin_missing' })
  const directory = join(root, 'plugin-library', 'fake')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'management.lock'), '')
  await expect(manageClaudePlugins(context, config, root, { action: 'install', plugin: 'reviewer@demo', source: 'local' })).rejects.toMatchObject({ code: 'brain.plugin_busy' })
  await rm(join(directory, 'management.lock'))
  for (const variant of ['absent', 'outside']) {
    await writeFile(binary, `#!/usr/bin/env node\nimport {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';\nconst root=process.env.CLAUDE_CONFIG_DIR;mkdirSync(join(root,'plugins'),{recursive:true});writeFileSync(join(root,'plugins','installed_plugins.json'),JSON.stringify({version:2,plugins:${variant === 'absent' ? '{}' : `{'reviewer@demo':[{scope:'project',version:'ignored',installPath:root},{scope:'user',version:'1',installPath:${JSON.stringify(host.root)}}]}`}}));\n`, { mode: 0o700 })
    await expect(manageClaudePlugins(context, config, root, { action: 'install', plugin: 'reviewer@demo', source: 'local' })).rejects.toMatchObject({ code: variant === 'absent' ? 'brain.plugin_install_record' : 'brain.plugin_outside' })
    await expect(readFile(join(directory, 'management.lock'))).rejects.toThrow()
  }
})
