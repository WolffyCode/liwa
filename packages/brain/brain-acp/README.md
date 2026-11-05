---
description: "The generic Agent Client Protocol brain provider: Paseo's ACP client, moved to ACP SDK 1.4, registered into ctx.brains for any ACP agent CLI, with Paseo's vendor shims as configuration."
kind: "package-reference"
---

# @liwa/brain-acp

English | [中文](README.zh.md)

## Summary

Connects any agent CLI that speaks the Agent Client Protocol (Gemini CLI, OpenCode, Copilot, Cursor, Kimi, Kiro, Trae…) to `ctx.brains` as a brain provider. The client is Paseo's `ACPAgentClient`, copied in place and moved from ACP SDK 0.17 to 1.4; Paseo's vendor shims are a `vendor` setting. One plugin row is one provider; mount the plugin several times with different rows to connect several CLIs. The same client is the base of the `deepseek` provider.

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

### Configure a provider

The Liwa-process bundles (`web`, `headless`, `brain`) carry a switched-off `brain-acp` row. Enable it and name the CLI's command; add another row with another `impl` for each further CLI:

```yaml
- id: brain-acp
  name: '@liwa/brain-acp'
  config:
    impl: gemini
    command: [gemini, --experimental-acp]
    env: {}
    vendor: generic
```

| Field | Default | Meaning |
|---|---|---|
| `impl` | `acp` | Provider name in `ctx.brains` |
| `command` | — | The CLI's argv; never shell-interpreted. Required except for `copilot` (`copilot --acp`) |
| `env` | `{}` | Environment entries given to the CLI explicitly, past the subprocess scrub |
| `vendor` | `generic` | Paseo shim: `generic`, `copilot`, `cursor`, `kimi`, `kiro`, `trae` |
| `label` | — | Display name in diagnostics |

The [configuration catalog](../../../docs/config-catalog.md#liwabrain-acp) is the exhaustive source.

### What a session does

A session starts one CLI process through the session's launch context (so `ctx.brains` records it), runs `initialize` and `session/new` with the session's MCP servers (the toolport endpoint and any servers the caller gave), streams `session/update` as `BrainEvent`s, answers `session/request_permission` through `permission.request` (one-shot options only; permanent kinds stay hidden unless the CLI offers nothing else; the request's own tool facts — title, kind, raw input, and its text as `description` — take precedence over an earlier snapshot, so a call the CLI never streamed, such as a child's, is still described), answers a form `elicitation/create` through a `question` request whose structured `answers` fill the form (selections in each question's field, custom text in its "other" field; an answer the form cannot hold is refused, never dropped), and resumes through `session/load` or `session/resume`. The model goes through standard `session/set_config_option`, the mode through `session/set_mode` (a `modeId` the session does not offer fails `createSession`), images go as ACP image blocks, and `SessionConfig.env` reaches the CLI process. `cancel` waits for the cancelled prompt to return, because `session/cancel` is only a notification. A generic CLI declares no next-step delivery (`deliver(next_step)` is `unsupported`), native tools that cannot be removed, and always-on compaction; ACP cannot say `alwaysLoad`, so an MCP server marked so is refused unless the provider knows its CLI never defers tools (`defersMcpTools: false`).

### Build another provider on it

`AcpBrainProvider` wraps any `ACPAgentClient`; a subclass overrides `sessionConfig`, `launchContext`, or `wrap` and gives `AcpBrainSession` (or its own subclass) the session. `ACPAgentClient.sessionExtension` attaches a per-session `ACPMetaExtension`: `_meta` for outgoing requests and an observer that sees each raw incoming message before Paseo translates it. `ACPAgentSession.requestExtension` calls a `_`-prefixed method on the session.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`src/paseo/agent/providers/` holds Paseo's ACP client and its vendor shims, copied from one fixed commit and changed in place (`NOTICE` lists every change). The ACP SDK moved from 0.17 to 1.4 there: `ClientSideConnection` became `client()` plus `connect(ndJsonStream(...))`, every call became `connection.agent.request(methods.agent.…)`, cancellation a `notify`, and extension notifications are registered by name. Processes go through `@liwa/brain`'s process helpers and subprocess handles instead of `node:child_process` and `tree-kill`. A runtime that exits between turns is reported the way Paseo's Claude adapter reports it: a `turn_failed` with no turn id. `src/adapter.ts` only maps types, and `src/elicitation.ts` reads a form into questions and fills answers back; the copied client only wires an elicitation through. The event translation itself is `@liwa/brain-shared`'s `PaseoBrainSession`. `src/paseo/` is a separate TypeScript project with Paseo's compiler options; `src/*.ts` compiles under the repository's full strictness.

| Path | Role |
|---|---|
| [`src/paseo/agent/providers/acp-agent.ts`](src/paseo/agent/providers/acp-agent.ts) | Paseo's ACP client and session (SDK 1.4) |
| [`src/paseo/agent/providers/generic-acp-agent.ts`](src/paseo/agent/providers/generic-acp-agent.ts) | The command-configured generic client |
| [`src/adapter.ts`](src/adapter.ts) | Contract configuration, launch context, permission options; `AcpBrainProvider` |
| [`src/elicitation.ts`](src/elicitation.ts) | Form elicitation ↔ contract questions and structured answers |
| [`src/index.ts`](src/index.ts) | The plugin: vendor selection and registration |
| [`NOTICE`](NOTICE) | Upstream commit, license, and the per-file change list |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [@liwa/brain](../brain/README.md) — the provider contract and `ctx.brains`.
- [@liwa/brain-shared](../brain-shared/README.md) — the shared Paseo code and the session mapping.
- [@liwa/brain-deepseek](../brain-deepseek/README.md) — Liwa's own agent on this client, with the `_liwa` extension.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the ACP agent CLI it drives, which builds every model request from the prompts and MCP servers the session gives it.

#### KV Cache effect

The provider adds nothing to a request; the CLI's own prompt assembly decides what stays cached.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Only `deepseek` is accepted against a real CLI** — the vendor shims are migrated as configuration; Gemini CLI, OpenCode, Copilot, and the others have not been run end to end yet.
- **No steering and no model catalog** — ACP has no next-step delivery; Paseo's catalog, import, and diagnostic methods are migrated but nothing in `ctx.brains` calls them yet.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
