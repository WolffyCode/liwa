---
description: "Test kit for brain providers: a script-replay provider, a direct-provider test host with an event recorder, and the brain.provider contract suite every provider must pass."
kind: "package-library"
---

# @liwa/brain-testkit

English | [中文](README.zh.md)

## Summary

Brain provider packages prove their contract here. The contract suite drives a provider directly and checks every `brain.provider` obligation: event shapes, turns, delivery, cancel, permissions, usage, child agents, CLI exits, resume, and release. A script-replay provider passes the suite without a real CLI and also serves `liwa brain` demos through an explicit overlay. The kit is test infrastructure and joins no shipped profile.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### When to use it

Every provider package runs the contract suite from its own tests, against its client wired to a replayed CLI. Tests of `ctx.brains` and of its consumers use the scripted provider and the recorder.

### Entry point

```text
import { describeBrainProviderContract } from '@liwa/brain-testkit/contract'
import { textInput } from '@liwa/brain-testkit'

describeBrainProviderContract({
  name: 'claude',
  createProvider: host => new ClaudeBrainProvider(host.ctx, replayOptions),
  scenarioInput: scenario => textInput(fixturePromptFor(scenario)),
})
```

The provider receives a host with a mounted `ctx.subprocess`, a temporary directory, recording launch contexts, and a ready `SessionConfig`. For each scenario (`reply`, `tool`, `permission`, `child`, `long`, `exit`) the subject supplies the input that makes its CLI act it out. Tests that depend on a `Meta` capability — child observation, resume, each delivery semantics — check the declared behavior, including `unsupported`.

The scripted provider (`ScriptedBrainProvider`) replays `ScriptStep`s chosen per prompt; `demoScript` picks a scenario by keyword. `@liwa/brain-testkit/plugin` registers it into `ctx.brains`:

```yaml
- insert:
    - id: brain-scripted-provider
      name: '@liwa/brain-testkit/plugin'
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Each scripted session spawns an idle node process through its launch context, so process ownership, termination, and `session.exited` take their real paths. Steering, cancel withdrawal, permission answers, and child agents follow the provider rules the suite checks.

| File | Role |
|---|---|
| [`src/contract.ts`](src/contract.ts) | `describeBrainProviderContract`, the vitest suite |
| [`src/scripted-provider.ts`](src/scripted-provider.ts) | `ScriptedBrainProvider`, script steps, and the demo script |
| [`src/harness.ts`](src/harness.ts) | Test host, recording launch contexts, sample session configuration, event recorder |
| [`src/plugin.ts`](src/plugin.ts) | Cordis plugin that registers the scripted provider |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [@liwa/brain](../../brain/brain/README.md) — the contract under test.
- [@liwa/brain-cli](../../bundle/brain-cli/README.md) — the command the scripted provider demonstrates.

-----

<a id="model-experience"></a>
## Model Experience

None, as scripted turns are replayed locally and never reach a model.

#### KV Cache effect

No model request is made, so no cache is involved.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Replay fixtures belong to providers** — each provider package records or writes the replayed CLI behavior for its own scenarios; the kit does not ship CLI recordings.
- **Wire round trips** — the suite drives providers in process; codec round-trip tests of a wire protocol stay with the provider that speaks it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
