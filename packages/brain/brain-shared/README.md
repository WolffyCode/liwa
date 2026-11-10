---
description: "Paseo provider code shared by the Liwa brain providers (agent contract types, protocol files, provider utilities, subagent store, MCP injection) plus Liwa's mapping from a Paseo agent session onto the brain.provider session contract."
kind: "package-library"
---

# @liwa/brain-shared

English | [中文](README.zh.md)

## Summary

Brain provider packages build their Claude Code, Codex, and ACP clients on Paseo's code. This library holds the Paseo files those clients share, copied in place from one fixed commit, plus the Liwa code every Paseo-based provider shares: the mapping from a Paseo agent session onto the `brain.provider` session contract, turn-input rendering, and the pino-shaped logger the copied code expects. Provider packages import a migrated module by its upstream-shaped subpath. The package registers nothing and owns no provider; `NOTICE` records the origin and every in-place change.

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

Provider packages (`brain-acp`, `brain-deepseek`, `brain-claude-code`, `brain-codex`) import it while adapting their own copied Paseo client: the shared agent contract, the protocol helpers, the provider utilities, the provider subagent store, and runtime MCP configuration all live here once, so no provider copies them again. A provider whose client yields a Paseo `AgentSession` wraps it in `PaseoBrainSession` and overrides only what differs; it does not re-map events itself.

### Entry point

```text
import type { AgentSession } from '@liwa/brain-shared/paseo/agent/agent-sdk-types'
import { PaseoBrainSession, paseoLogger } from '@liwa/brain-shared'

const logger = paseoLogger(ctx.logger('brain-claude-code'))           // what copied Paseo code calls `Logger`
const session: AgentSession = await client.createSession(paseoConfig, { agentId: launch.sessionId, processHost: launch })
return new PaseoBrainSession({ impl, meta, session, blobs: launch }) // a BrainProviderSession
```

`PaseoBrainSession` translates `AgentStreamEvent` into `BrainEvent` and answers `deliver` from `Meta.delivery`:

- **Turns and items** — the parent's open message and reasoning are kept per turn, so a turn's end finalizes only its own message: a late-acknowledged cancel of an older turn never touches a newer turn's items, and items arriving for a turn that already ended are dropped. Each tool call keeps its own turn and child, and a parent turn's end settles only the parent's own unfinished calls. A runtime exit between turns is `session.exited`; `beginProviderTurn` / `finishTurn` report a turn the CLI started by itself.
- **Children** — `provider_subagent` becomes `child.*`. A child's items carry its `childId` and the turn that started it and keep arriving after that turn ended; a child reported running again after it ended is reopened.
- **Permissions and questions** — native actions become one-shot options; a request without actions (Claude and Codex tool approvals and questions) gets an `allow_once` (`Answer` for questions), and every request gets a `deny_once` and a `cancel`; an unknown option is answered as `deny_once`. A question carries typed `questions` (`permissionQuestions`, by default Paseo's `input.questions`), and an allowing answer must carry `answers`. Answers stay structured across the boundary: `permissionAnswerInput` hands the provider's adapter `updatedInput.answers` keyed by question id, each `{ selected, custom? }` (`structuredAnswers`), never selections and custom text joined into display text; a provider whose adapter wants a native shape encodes it there, and refuses with `invalid_input` an answer the native shape cannot hold (the request stays pending). `permissionChildId` attributes a request to a child, which may arrive without a parent turn.
- **Cancel** — Paseo's acknowledged interrupt is enough: once `interruptTurn` resolves, the turn captured at the call is settled with `turn.interrupted` unless it already ended, and no later turn is touched. A protocol whose interrupt is only a notification waits in its own subclass (`whenTurnEnds`).
- **Models and modes** — `setModel` checks the runtime info afterwards and refuses a model the session did not switch to; `availableModes`, `currentMode`, and `setMode` map Paseo modes, and an "applies next turn" notice becomes `appliesAt: 'next_turn'`. `mode_changed` and `model_changed` become `session.*_changed` events; Paseo reports a mode state twice for one switch (the switch call, then the CLI's confirmation), and an unchanged state is reported once.
- **Input** — `toPaseoPrompt` renders a `TurnInput`: named blocks as `<liwa-block name="…">` with the closing tag escaped, images read back from the blob store into Paseo inline image blocks.

Subclasses override the protected hooks: `toolName`, `toolArgs`, `toolResult`, `permissionTool`, `permissionChildId`, `permissionOptions`, `permissionQuestions`, `permissionAnswerInput`, `turnUsage`, `childUsage`, `modelName`, `nativeModel`, `modeAppliesAt`, `steer`, `interruptTurn`, `decorate`. The resume handle drops Paseo's configuration metadata. The process helpers (`spawnProviderProcess` and friends) live in `@liwa/brain`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Each file under `src/paseo/` is upstream Paseo source with a first-line origin comment; changed lines are edited in place and marked, with no mapping layer. `src/paseo/` is its own TypeScript project (`tsconfig.paseo.json`) with Paseo's strictness (no `noUncheckedIndexedAccess` or `exactOptionalPropertyTypes`); Liwa's modules are the package's main project (`tsconfig.json`) under the repository's full strictness and reference the copied project, never the other way round. Lint, export-documentation, cast, duplication, and coverage gates treat `src/paseo/` like `vendor/`.

| Path | Role |
|---|---|
| [`src/paseo/agent/`](src/paseo/agent/agent-sdk-types.ts) | Agent contract, launch configuration, provider options and notices, refresh deadline, session import, timeline helpers, subagent store, runtime MCP configuration |
| [`src/paseo/agent/providers/`](src/paseo/agent/providers/provider-runner.ts) | Provider runner, tool-call mapping helpers, diagnostics, image output, JSONL framing |
| [`src/paseo/protocol/`](src/paseo/protocol/agent-types.ts) | Protocol types, provider configuration schemas, tool names, paths, tool-call display |
| [`src/paseo/utils/`](src/paseo/utils/path.ts) | Timeouts, path equivalence, string-command shells |
| [`src/session.ts`](src/session.ts) | `PaseoBrainSession`: a Paseo agent session as a `brain.provider` session |
| [`src/turn-input.ts`](src/turn-input.ts) | Turn input to Paseo prompt blocks, `<liwa-block>` rendering |
| [`src/logger.ts`](src/logger.ts) | The pino-shaped logger over a cordis logger |
| [`NOTICE`](NOTICE) | Upstream commit, license, and the per-file change list |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [@liwa/brain](../brain/README.md) — the contract the provider adapters map these types onto.
- [@liwa/brain-acp](../brain-acp/README.md) — the first provider built on these modules.
- [Third-party notices](../../../THIRD_PARTY_NOTICES.md) — the repository-wide record of copied source.

-----

<a id="model-experience"></a>
## Model Experience

None, as this library only supplies provider-side code; each provider package owns what its CLI sends to a model.

#### KV Cache effect

Nothing here builds a model request, so it cannot invalidate a cached prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Manager migration plan** — under decision 67, the AgentManager layer will move into `@liwa/minds`; the MCP catalog and tool contribution move into `@liwa/toolport` and `@liwa/tool-minds`, while the three provider snapshot modules belong to `@liwa/brain`. This change freezes documentation only; the code has not moved. Paseo attachments, dedicated presentation, and the OpenCode bridge stay behind.
- **Protocol subset plan** — extract only agent schemas and types from `messages.ts`; the [migration map](../../../docs/liwa/architecture/modules/01-agent-cli.md#附录-a1-agent-协议子集的精确边界f7) owns the exact exports and removed branches. Add agent-labels, agent-lifecycle, and agent-title-limits. Update NOTICE per file when copying the source, without recording planned files as already copied.
- **Upstream sync is manual** — updating to a newer Paseo commit means re-copying the files and re-applying the changes `NOTICE` lists.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
