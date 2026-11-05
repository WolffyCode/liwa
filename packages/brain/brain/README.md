---
description: "The brain-provider seam (ctx.brains): the agent CLI contract, provider registration, and wrapped sessions that record usage, processes, and child agents."
kind: "package-reference"
---

# @liwa/brain

English | [中文](README.zh.md)

## Summary

`ctx.brains` is where agent CLI providers register and where the member layer opens their sessions. A provider plugin registers a client for one CLI (deepseek, Claude Code, Codex, generic ACP); a caller opens a session with one validated `SessionConfig` and gets a handle that streams `BrainEvent`s. The handle sums usage, records each spawned process and child agent, and refuses semantics the provider's `Meta` declares false. The package owns the contract and the records, not the CLIs or when sessions open.

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

### Mount the service

Mount one row beside `ctx.subprocess`; `membersRoot` is where member configuration directories live.

```yaml
- id: brains
  name: '@liwa/brain'
  config:
    membersRoot: !!js liwaHomePath('members')
```

The `web`, `headless`, and `brain` profiles mount it with the `deepseek` provider (`@liwa/brain-deepseek`) and a switched-off generic `acp` row (`@liwa/brain-acp`); the `deepseek` profile does not, so a session process never opens sessions of its own. The optional timeouts (`handshakeTimeoutMs`, `callTimeoutMs`, `closeTimeoutMs`, `probeTimeoutMs`) bound provider calls. `blobsDir` (default `<membersRoot>/.blobs`) holds the content-addressed bytes behind image turn input.

### Register a provider

A provider plugin injects `brains` and calls `ctx.brains.register(provider)` with an object implementing `BrainProvider`: `impl`, `meta`, `sessionHome`, `probe`, `createSession`, `resumeSession`, and optionally `writeMemberConfig`. Registration validates `impl` and `meta`, rejects a duplicate name, and is released with the registering plugin; release closes that provider's open sessions. Every process of a session must start through the launch context's `spawn`, which records ownership before handing the spec to `ctx.subprocess`; `spawnProviderProcess`, `findProviderExecutable`, and `execProviderCommand` carry a provider's own spawn, lookup, and probe commands through the same path.

`sessionHome` says where a session's home lies: `per-member` shares `<configDir>/<impl>` across the member's sessions; `per-session` gives each session `<configDir>/<impl>/<sessionId>`, records it in the resume handle (`home`), and resumes in the same directory. `writeMemberConfig` writes the provider's part of the member configuration directory (rules, skills, settings); the registry creates the directory and calls it.

### Open a session

```text
const configDir = await ctx.brains.prepareConfigDir(member, impl, { rules, skillsDir, projectDocs })
const session = await ctx.brains.createSession(ctx, { impl, cfg: { ...config, configDir } })
session.subscribe(event => { /* BrainEvent */ })
const { turnId } = await session.startTurn({ blocks: [{ kind: 'text', text: 'hello' }] })
```

`model` is optional: without it the provider's CLI uses its own default, and no placeholder is passed. `modeId` opens the session in one of the provider's session modes. Before opening, four checks run: a provider whose compaction is `always_on` refuses `compaction: 'off'`; a provider with irremovable native tools (`meta.nativeTools`) refuses `nativeToolPolicy: 'none'`; a provider without modes (`meta.modeSwitch`) refuses `modeId`; native child agents are switched off for every kind except `work` and the change is recorded in the session's `adjustments`. Everything else in the configuration — native tools, compaction, repository documents, rules, skills, `env`, MCP `alwaysLoad` — is the provider's to carry out, and a combination it cannot honour fails `createSession`. The session closes with the context passed as owner.

An image block references bytes stored first: `const blob = await ctx.brains.blobs.put(bytes, 'image/png')`, then `{ kind: 'image', blob }`. The store is a content-addressed directory; providers read the bytes back through the launch context's `readBlob`, which checks size and hash.

### Drive and observe it

`deliver` answers `unsupported` for semantics `Meta.delivery` declares false; `cancel` is idempotent, and a cancel the provider does not confirm leaves the session `stopping` until a later cancel succeeds. Once confirmed, the turn running at the call has its terminal event; a later turn is never settled by it. `canStopRuntime` vetoes while a turn, a pending permission, or a running child exists, then asks the provider. `events()` iterates from the call onwards; `usage()`, `children()`, and `pendingPermissions()` read the session's records. `resumeSession` continues a handle from `persistence()` when `Meta.resume` holds. `openChildTask` (cross-CLI child tasks) rejects with `brain.not_implemented` until the tasks layer exists.

`respondToPermission` accepts only pending requests. A request's `category` tells tool approvals, plan approvals, mode approvals, and questions apart; a question carries typed `questions`, and an allowing answer to it must carry `answers` keyed by question id (`{ selected, custom? }`, checked before the provider sees it). The visible options are one-shot (`allow_once`, `allow_session`, `deny_once`, `cancel`); a parent agent never answers its children's requests — they reach the owner with their `childId`.

`setModel(model)` and `setMode(modeId)` work when the provider declares `modelSwitch` / `modeSwitch`, refuse a closed or stopping session, and update `view().model` / `view().modeId` with a `session.model_changed` / `session.mode_changed` event; `setMode` says whether the mode applies now, at the next step, or at the next turn. `availableModes()` and `currentMode()` read the provider's modes.

A provider's child agents are session-scoped: their items carry `childId` and the turn that started them, and they keep arriving after that turn ended (a background child), never borrowing a later turn. A provider may start a turn of its own (a background child's result wakes the CLI); it arrives as an ordinary `turn.started` without `startTurn`.

### Records and events

`list`, `describe`, `probe`, `listSessions`, `children`, and `processes` read the in-memory records, and `onUsage` streams usage. The same records are emitted as Cordis events: `brain.session.opened.v1`, `brain.session.closed.v1`, `brain.process.spawned.v1`, `brain.process.exited.v1`, `brain.child.opened.v1`, `brain.child.ended.v1`, `brain.usage.v1`, and `brain.provider.unavailable.v1`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The provider-side interfaces mirror Paseo's `AgentClient` / `AgentSession` so an adapter over migrated Paseo code maps nearly one to one; the data contract is zod, the plugin configuration is schemastery. The registry wraps every provider session in one handle that owns fan-out, turn tracking, permission tracking, usage totals, process records, and child records.

| File | Role |
|---|---|
| [`src/contract.ts`](src/contract.ts) | zod schemas and types: `Meta`, `SessionConfig`, `ResumeHandle`, `TurnInput`, `Usage`, `BrainEvent` |
| [`src/provider.ts`](src/provider.ts) | `BrainProvider`, `BrainProviderSession`, launch and probe contexts |
| [`src/index.ts`](src/index.ts) | `BrainRegistry` (`ctx.brains`), the Cordis events, and the pre-session checks |
| [`src/session.ts`](src/session.ts) | The session handle: fan-out, records, cancel and close semantics |
| [`src/config-dir/`](src/config-dir/index.ts) | Member configuration directories and session homes; each provider writes its own part |
| [`src/process.ts`](src/process.ts) | Process helpers that carry a provider's spawns and probes through the launch context or `ctx.subprocess` |
| [`src/views.ts`](src/views.ts) | Record shapes of providers, processes, sessions, children, and usage |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [@liwa/brain-shared](../brain-shared/README.md) — migrated Paseo provider code that provider packages build on.
- [@liwa/brain-deepseek](../brain-deepseek/README.md) and [@liwa/brain-acp](../brain-acp/README.md) — the providers registered today.
- [@liwa/brain-testkit](../../test-support/brain-testkit/README.md) — the scripted provider and the contract suite every provider passes.
- [@liwa/brain-cli](../../bundle/brain-cli/README.md) — the `liwa brain` command over this service.
- [@liwa/subprocess](../../subprocess/subprocess/README.md) — the process seam every provider spawns through.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the provider plugins: each agent CLI builds its own model requests from the session configuration, and this seam only relays sessions, events, and usage.

#### KV Cache effect

This package adds nothing to any model request; prefix stability belongs to the provider and the CLI it drives.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **In-memory records** — sessions, processes, children, and usage live in memory and in the emitted events; restart recovery and orphan cleanup wait for the experience stream that will persist them.
- **No process ids** — the subprocess seam keeps target identity private, so process records carry the command and an argv hash instead of a pid.
- **Cross-CLI child tasks** — `openChildTask` only reserves the interface until the tasks layer exists.
- **Layer-owned fields** — owner, persona, limits, conclude-on tools, and child policy are supplied by the caller until the member layer, guard, and roster exist; `kernelTools` waits for toolport, and callers pass `mcpServers` meanwhile.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The member configuration writers for Claude Code and Codex move into their provider packages as `writeMemberConfig` when those packages land; the earlier writers are in this package's git history.

</details>
