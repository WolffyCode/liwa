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

The `web`, `headless`, and `brain` profiles mount it; no provider is mounted by default. The optional timeouts (`handshakeTimeoutMs`, `callTimeoutMs`, `closeTimeoutMs`, `probeTimeoutMs`) bound provider calls.

### Register a provider

A provider plugin injects `brains` and calls `ctx.brains.register(provider)` with an object implementing `BrainProvider`: `impl`, `meta`, `probe`, `createSession`, and `resumeSession`. Registration validates `impl` and `meta`, rejects a duplicate name, and is released with the registering plugin; release closes that provider's open sessions. Every process of a session must start through the launch context's `spawn`, which records ownership before handing the spec to `ctx.subprocess`.

### Open a session

```text
const configDir = await ctx.brains.prepareConfigDir(member, impl, { rules, skillsDir, projectDocs, model })
const session = await ctx.brains.createSession(ctx, { impl, cfg: { ...config, configDir } })
session.subscribe(event => { /* BrainEvent */ })
const { turnId } = await session.startTurn({ blocks: [{ kind: 'text', text: 'hello' }] })
```

Before opening, three checks run: a provider whose compaction is `always_on` refuses `compaction: 'off'`; a provider with irremovable native tools (`meta.nativeTools`) refuses `nativeToolPolicy: 'none'`; native child agents are switched off for every kind except `work` and the change is recorded in the session's `adjustments`. The session closes with the context passed as owner.

### Drive and observe it

`deliver` answers `unsupported` for semantics `Meta.delivery` declares false; `cancel` is idempotent, and a cancel the provider does not confirm leaves the session `stopping` until a later cancel succeeds. `respondToPermission` accepts only pending requests. `canStopRuntime` vetoes while a turn, a pending permission, or a running child exists, then asks the provider. `events()` iterates from the call onwards; `usage()`, `children()`, and `pendingPermissions()` read the session's records. `resumeSession` continues a handle from `persistence()` when `Meta.resume` holds. `openChildTask` (cross-CLI child tasks) rejects with `brain.not_implemented` until the tasks layer exists.

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
| [`src/config-dir/`](src/config-dir/index.ts) | Member configuration directories, one writer per CLI |
| [`src/views.ts`](src/views.ts) | Record shapes of providers, processes, sessions, children, and usage |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [@liwa/brain-shared](../brain-shared/README.md) — migrated Paseo provider code that provider packages build on.
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

The configuration writers for Claude Code and Codex hold the minimal files the design lists; the provider packages refine their own writer file.

</details>
