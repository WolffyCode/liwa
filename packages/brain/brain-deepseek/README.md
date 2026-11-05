---
description: "The deepseek brain provider: Liwa's own agent as one liwa --profile deepseek process per session, driven over ACP with the _liwa extension (steering, usage, child agents) and registered into ctx.brains."
kind: "package-reference"
---

# @liwa/brain-deepseek

English | [中文](README.zh.md)

## Summary

Registers the provider `deepseek` into `ctx.brains`: Liwa's own agent, run as a separate CLI process like any other agent CLI. Each session starts one `liwa --profile deepseek` process (`@liwa/deepseek-app`) of the same installation, with `LIWA_HOME` set to that session's own directory under the member's configuration directory. The client is a subclass of `@liwa/brain-acp`'s ACP client that adds the `_liwa` extension: next-step steering, server-side usage, child-agent records, and the session's kind, budgets, notes, and model in `session/new`'s `_meta.liwa`.

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

### Where it is mounted

The `web`, `headless`, and `brain` bundles carry a `brain-deepseek` row; the `deepseek` profile itself does not, so a session process never registers providers. Disable the row to remove the provider; replace it to point at another installation:

```text
liwa brain probe deepseek
liwa brain run --provider deepseek --cwd <dir> "<prompt>"
```

`probe` reports the installation's version and whether the API key is configured; an installation that cannot start `liwa` (no built `lib/bin.js` and no source entry, as in the browser-worker preview) still registers the provider, which then probes unavailable and refuses sessions with `unavailable`. Without `--model`, the session runs on the default model selection of the `deepseek` profile.

| Field | Default | Meaning |
|---|---|---|
| `impl` | `deepseek` | Provider name in `ctx.brains` |
| `launcher` | `[]` | argv that starts `liwa` (without `--profile`); empty means the installation this process runs from, then `liwa` on `PATH` |
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | Name of the key; the value comes from the credential store (or the launch environment) and reaches the process under this name only |
| `forwardEnv` | `[DEEPSEEK_BASE_URL]` | Variables passed through from the launch environment when set |
| `provider` | `deepseek-official` | Model route written into the session patch when a model is given |
| `presetPrefix` | `deepseek-` | Preset id prefix; the session kind `work` uses `deepseek-work` |

The [configuration catalog](../../../docs/config-catalog.md#liwabrain-deepseek) is the exhaustive source.

### What a session does

| Contract | `deepseek` |
|---|---|
| Home | `<member>/brains/deepseek/<sessionId>/` per session (`sessionHome: 'per-session'`); the resume handle keeps it |
| Persona, model, preset | A home-level `cordis.patch.yml` written before each launch: `personaPrefix` with `includeLiwaIdentity: false`, the default preset, and the model when one is given |
| Session policy | The same patch: `agent-instructions` reads the repository's `AGENTS.md` / `CLAUDE.md` only with `projectDocs`, and the member `rules` (written as `$LIWA_HOME/AGENTS.md`); `skill-filesystem` + `skill` read `skillsDir` (plus the repository's skills with `projectDocs`); `compaction: 'off'` unmounts the compactor and the tool-result pruner. `LIWA_AGENTS_HOME` points into the session home, so the owner's `~/.agents` is never read |
| Native tools | `_meta.liwa.nativeToolPolicy`: `none` leaves only the MCP kernel tools, `readonly` only the read-only native tools; combinations the process cannot honour (skills or native children without native tools) fail `createSession` |
| `session/new` | `_meta.liwa`: `mindKind`, `owner`, `notes`, `version`, `limits`, `concludeOn`, `model`, `childPolicy`, `nativeToolPolicy` (the server also accepts a session-wide `keepQueue`) |
| `deliver(next_step)` | `_liwa/steer` (text and images); reaches the running turn at its next step |
| `cancel({ reason, keepQueue })` | Standard `session/cancel` with `_meta.liwa.keepQueue`; `pause`, `drain`, and `owner` also stop running child agents (`stopChildren`), `preempt` and `watchdog` leave background children running |
| Questions | The process's `ask_user_question` and plan review arrive as `question` requests over form elicitation |
| Child approvals | A child agent's escalation reaches the owner as a `permission.request` with its `childId` and what it asks for — the tool, the call's arguments (target path, content, requested sandbox) as `args`, the escalation reason as `description` (the process forwards delegated approvals); the parent agent never answers it |
| Model, mode | `setModel` through `session/set_config_option` within the current route; `setMode` between `default` and `plan` (work sessions, which mount plan mode); a switch during a turn applies at the next step |
| Turns of its own | When a background child's result wakes the session between prompts, the server reports that turn (`_meta.liwa.turn`) and it streams like any other |
| Resume | A new process in the same home, then `session/resume` |
| Usage | The server's per-prompt `_meta.liwa.usage` (children included), `_liwa/usage` for the session totals |
| Children | `child.started` / `child.ended` from `session_info_update` with `_meta.liwa.child`; `_liwa/children` lists them |
| Close | The process exits with the session; on timeout its process group is killed |

What the provider cannot honor is declared false in `DEEPSEEK_META` and answers `unsupported`: `deliver(next_turn)` (the delivery queue fills it at turn boundaries).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`DeepseekACPAgentClient` extends Paseo's generic ACP client from `@liwa/brain-acp`. Before each launch the provider prepares a `LiwaChannel` for the session id: it supplies `_meta.liwa` for `session/new` and `session/resume`, arms the next `session/cancel` with `keepQueue`, and buffers each raw incoming message (prompt responses, `session_info_update`, permission requests) until the wrapped session subscribes. `DeepseekBrainSession` overrides `PaseoBrainSession`'s hooks: usage from `_meta.liwa`, tool names from the ACP title, the conclude tool on `turn.completed`, the child id on a child's permission request, and steering through `requestExtension`. The `_liwa` wire format is exported by `@liwa/deepseek-app` (its `src/protocol.ts`), the one place both ends import.

The launcher follows the running installation: the built `lib/bin.js`, or from a source checkout the TypeScript entry through `tsx` with the source-mode overlay. The key is resolved per launch and given to the subprocess as an explicit environment entry after the parent environment is scrubbed; it is never written into the session home.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | The plugin: launcher, credentials, registration |
| [`src/provider.ts`](src/provider.ts) | `DEEPSEEK_META`, `_meta.liwa`, per-session home and launch |
| [`src/client.ts`](src/client.ts) | `LiwaChannel` and the ACP client subclass |
| [`src/session.ts`](src/session.ts) | `DeepseekBrainSession`: the `_liwa` mapping |
| [`src/session-patch.ts`](src/session-patch.ts) | The home-level session patch |
| [`src/launcher.ts`](src/launcher.ts) | How to start `liwa` from the running installation |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [@liwa/deepseek-app](../../bundle/deepseek-app/README.md) — the process side: the `_liwa` extension and the presets.
- [@liwa/brain-acp](../brain-acp/README.md) — the ACP client this provider extends.
- [@liwa/brain](../brain/README.md) — the provider contract and member configuration directories.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `liwa --profile deepseek` process, whose agent builds every model request from the session preset, the persona prefix, and the session notes this provider sends.

#### KV Cache effect

The persona prefix and the session notes are fixed for a session's lifetime, so they stay in the cached prefix; a new persona version takes effect at the next session generation.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No child timeline** — a child agent reports its start, end, usage, and permission requests; its own messages and tool calls are not streamed item by item (its result reaches the parent turn).
- **No model listing** — the provider does not list the models of its route; `brain run` without `--model` uses the profile's default selection.
- **One process per session** — about 0.75 seconds and 300 MB per session process when run from source.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`tests/deepseek.e2e.ts` runs against the real model only with `DEEPSEEK_API_KEY` set and `LIWA_BRAIN_E2E=1`; every other test drives real `liwa --profile deepseek` processes against a scripted Messages endpoint.

</details>
