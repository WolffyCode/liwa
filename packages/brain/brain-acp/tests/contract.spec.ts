import { fileURLToPath } from 'node:url'
import { ImplId } from '@liwa/brain'
import { paseoLogger } from '@liwa/brain-shared'
import { describeBrainProviderContract, type BrainContractScenario } from '@liwa/brain-testkit/contract'
import { textInput } from '@liwa/brain-testkit'
import { AcpBrainProvider, GenericACPAgentClient, genericAcpMeta } from '../src/index.ts'

const agent = fileURLToPath(new URL('./fixtures/mock-acp-agent.ts', import.meta.url))

// 通用 ACP 提供方对一个真的 ACP agent 子进程（SDK 1.4 的 agent 端，按场景演）走完整条线：
// 客户端的 SDK 1.4 连接、Paseo 的会话翻译、契约映射，一来一回都过线协议（01 §9 A6 的回环编解码）。
describeBrainProviderContract({
  name: 'acp (generic client against a scripted ACP agent process)',
  createProvider: host => new AcpBrainProvider({
    impl: ImplId('acp'),
    meta: genericAcpMeta(process.execPath),
    client: new GenericACPAgentClient({
      logger: paseoLogger(host.ctx.logger('brain-acp-test')),
      command: [process.execPath, '--import', import.meta.resolve('tsx/esm'), agent],
      providerId: 'acp',
      processHost: host.ctx.subprocess,
    }),
    versionCommand: [process.execPath, '--version'],
  }),
  scenarioInput: (scenario: BrainContractScenario) => textInput(`please run scenario:${scenario}`),
  models: { known: 'mock-large', unknown: 'mock-missing' },
  modes: { switchTo: 'plan' },
  exitCli: (launch) => {
    for (const handle of launch.processes) handle.terminate()
    return Promise.resolve()
  },
  eventTimeoutMs: 20_000,
  testTimeoutMs: 60_000,
})
