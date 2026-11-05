import { describeBrainProviderContract, type BrainContractScenario } from '../src/contract.ts'
import { SCRIPTED_META, ScriptedBrainProvider } from '../src/scripted-provider.ts'
import { textInput } from '../src/harness.ts'

const scenarioInput = (scenario: BrainContractScenario): ReturnType<typeof textInput> => textInput(`please run the ${scenario} scenario`)

const switching = { models: { known: 'scripted-large', unknown: 'scripted-missing' }, modes: { switchTo: 'plan' } }

describeBrainProviderContract({
  name: 'scripted provider (full capabilities)',
  createProvider: () => new ScriptedBrainProvider(),
  scenarioInput,
  ...switching,
})

describeBrainProviderContract({
  name: 'scripted provider (no delivery, no resume, no child observation)',
  createProvider: () => new ScriptedBrainProvider({
    meta: {
      resume: false,
      delivery: { nextStep: false, nextTurn: false, cancelKeepsQueue: false },
      children: { native: 'none', crossCli: true },
      modelSwitch: false,
      modeSwitch: false,
    },
  }),
  scenarioInput,
})

describeBrainProviderContract({
  name: 'scripted provider (no CLI process)',
  createProvider: () => new ScriptedBrainProvider({ process: false, meta: { ...SCRIPTED_META } }),
  scenarioInput,
  ...switching,
})
