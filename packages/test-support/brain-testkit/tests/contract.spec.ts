import { describeBrainProviderContract, type BrainContractScenario } from '../src/contract.ts'
import { SCRIPTED_META, ScriptedBrainProvider } from '../src/scripted-provider.ts'
import { textInput } from '../src/harness.ts'

const scenarioInput = (scenario: BrainContractScenario): ReturnType<typeof textInput> => textInput(`please run the ${scenario} scenario`)

describeBrainProviderContract({
  name: 'scripted provider (full capabilities)',
  createProvider: () => new ScriptedBrainProvider(),
  scenarioInput,
})

describeBrainProviderContract({
  name: 'scripted provider (no delivery, no resume, no child observation)',
  createProvider: () => new ScriptedBrainProvider({
    meta: {
      resume: false,
      delivery: { nextStep: false, nextTurn: false, cancelKeepsQueue: false },
      children: { native: 'none', crossCli: true },
    },
  }),
  scenarioInput,
})

describeBrainProviderContract({
  name: 'scripted provider (no CLI process)',
  createProvider: () => new ScriptedBrainProvider({ process: false, meta: { ...SCRIPTED_META } }),
  scenarioInput,
})
