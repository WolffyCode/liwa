import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll } from 'vitest'
import { describeBrainProviderContract, type BrainContractScenario } from '@liwa/brain-testkit/contract'
import { textInput } from '@liwa/brain-testkit'
import { deepseekProvider } from './fixtures/provider.ts'
import { startScriptedModel, type ScriptedModel } from './fixtures/scripted-model.ts'

let model: ScriptedModel
let files: string

beforeAll(async () => {
  files = await mkdtemp(join(tmpdir(), 'liwa-deepseek-contract-'))
  await writeFile(join(files, 'README.md'), '# contract fixture\n')
  model = await startScriptedModel({ readPath: join(files, 'README.md'), outsidePath: join(files, 'outside.txt') })
})

afterAll(async () => {
  await model.close()
  await rm(files, { recursive: true, force: true })
})

// 真的 `liwa --profile deepseek` 子进程（从本检出的源码入口起），模型换成按场景回答的 Messages 端点。
describeBrainProviderContract({
  name: 'deepseek (real liwa --profile deepseek process, scripted model endpoint)',
  createProvider: host => deepseekProvider(host, { DEEPSEEK_API_KEY: 'scripted-key', DEEPSEEK_BASE_URL: model.baseURL }),
  scenarioInput: (scenario: BrainContractScenario) => textInput(`please run this scenario:${scenario}`),
  // 模型目录来自 llm-deepseek 的内置目录（端点不是官方 API，不拉 /models）；干活会话的预设挂着计划模式。
  models: { known: 'deepseek-v4-pro', unknown: 'deepseek-no-such-model' },
  modes: { switchTo: 'plan' },
  // 真 CLI 不会照提示词退出：终止它的进程（SIGTERM → liwa 有界退出）。
  exitCli: (launch) => {
    for (const handle of launch.processes) handle.terminate()
    return Promise.resolve()
  },
  eventTimeoutMs: 45_000,
  testTimeoutMs: 120_000,
})
