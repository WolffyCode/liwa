import { join } from 'node:path'
import { fakeClaudeBinary } from './fixtures/binary.ts'
import { fakeAuthEnv } from './fixtures/auth.ts'
import { describeBrainProviderContract } from '@liwa/brain-testkit/contract'
import { textInput } from '@liwa/brain-testkit'
import { Config, ClaudeBrainProvider, type Config as ClaudeConfig } from '../src/index.ts'



describeBrainProviderContract({
  name: 'claude-code (official SDK + managed stream-json CLI)',
  createProvider: async (host) => {
    // 成员级布局与真实 brains 一致；testkit 默认每次 launch 分配新根。
    const launch = host.launch.bind(host)
    host.launch = home => launch(home ?? join(host.root, 'member-claude'))
    return new ClaudeBrainProvider(Config({ binary: await fakeClaudeBinary(host.root), env: fakeAuthEnv, models: [
      { id: 'mock', label: 'Mock', isDefault: true }, { id: 'mock-other', label: 'Other', isDefault: false },
    ] } as ClaudeConfig))
  },
  scenarioInput: scenario => textInput(`scenario:${scenario}`),
  // 原生逗号分隔多选及未经 A2 验证的 annotations 无法兑现该全组合；专属 codec 测正反边界。
  unsupported: ['answers'],
  models: { known: 'mock-other', unknown: 'absent' },
  modes: { switchTo: 'plan' },
  exitCli: (launch) => { for (const child of launch.processes) child.terminate(); return Promise.resolve() },
  eventTimeoutMs: 5_000,
  testTimeoutMs: 15_000,
})
