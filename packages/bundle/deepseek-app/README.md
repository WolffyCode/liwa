---
description: "The liwa deepseek profile: one Liwa agent session per process over ACP stdio, with Liwa's _liwa extension and one agent preset per session kind — the process the deepseek brain provider starts."
kind: "package-bundle"
---

# @liwa/deepseek-app

English | [中文](README.zh.md)

## Summary

`liwa --profile deepseek` is Liwa's own agent as an agent CLI: the base's standard ACP v1 server on stdio, plus the `_liwa` extension and five agent presets, one per session kind. It opens no port. The `deepseek` brain provider (`@liwa/brain-deepseek`) starts one such process per session with its own `LIWA_HOME`; without the `_liwa` row the process is a plain ACP agent any ACP client can drive. The package root is the `_liwa` extension plugin and also exports the `_liwa` wire format, which the provider imports.

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

### Run it

The shipped `deepseek` profile (`@liwa/base`, `@liwa/deepseek-app`) is created on first use. It serves ACP on stdin and stdout until the client disconnects:

```text
liwa --profile deepseek
```

Normally the `deepseek` provider starts it; it writes a home-level `cordis.patch.yml` into the session's `LIWA_HOME` for the persona prefix, model, and default preset before each launch.

### The `_liwa` extension

| Message | Direction | Meaning |
|---|---|---|
| `session/new`, `session/resume` `_meta.liwa` | client → agent | `mindKind` (picks the preset), `owner`, `notes` (an Agent-scope system prompt section), `version`, `limits` (inferences and tool calls per turn), `concludeOn`, `model`, `keepQueue`, `childPolicy`, `nativeToolPolicy` (`none` keeps only the session's MCP tools, `readonly` only the configured `readonlyTools`) |
| `_liwa/steer` | client → agent | Text and inline images delivered to the running turn (a prompt, or a turn the session started itself) at its next step; `accepted` or `unavailable` |
| `_liwa/usage` | client → agent | Usage since the session opened, children included, with its `mindKind` and `version` |
| `_liwa/children` | client → agent | The session's native child agents and their usage |
| `session/prompt` result `_meta.liwa` | agent → client | `usage` for this prompt, `concludedBy` when a conclude tool ended the turn |
| `session_info_update` `_meta.liwa.child` | agent → client | A child agent started or ended, with its usage |
| `session/request_permission` `_meta.liwa.childId` | agent → client | The child the request comes from (a root-session request carries none) |
| `session/cancel` `_meta.liwa.keepQueue`, `stopChildren` | client → agent | Keep or drop queued input when cancelling; also stop the running child agents |
| `session_info_update` `_meta.liwa.turn` | agent → client | The root session started a turn without a prompt (a background child's result woke it) or ended it, with that turn's usage and stop reason |

The inference budget rejects the next step, so the turn ends normally after the last allowed inference; the tool budget and child policy refuse the tool call with a message to the model. In-process child agents forward their approval asks (`subagent.delegatedApproval: forward`), so a child's escalation reaches the client through the root session with its `childId`; the ACP server asks questions (`ask_user_question`, plan review) through form elicitation and maps plan mode to the session modes `default` and `plan`.

### Presets

| Preset | Session kind | Tools |
|---|---|---|
| `deepseek-instance` | the member's instance | none (kernel tools over MCP) |
| `deepseek-work` (default) | work and research tasks | shell, files, search, background jobs, todo, web, `present`, `ask_user_question`, goals, plan mode, native child agents (`subagent` with child model selection, `subagent_fork`, workflows) |
| `deepseek-think` | thinking tasks | read-only files, search, web |
| `deepseek-own` | her own activity | files, search, web, todo |
| `deepseek-tidy` | the nightly tidy | read-only files and search |

Repository instructions and member rules (`agent-instructions`), skills (`skill-filesystem`, `skill`), and the compactor (`compaction-basic`, `tool-result-pruner`) are host rows here, mounted by default; the `deepseek` provider's session patch switches them per session from `projectDocs`, `rules`, `skillsDir`, and `compaction`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The patch inserts the startup row, the `acp` row (waiting for the startup service and the default model selection), and `deepseek-liwa` (the package root); disables the host's model-facing tool rows, moving them into the presets; and inserts `agent-preset-registry` with `deepseek-work` as the default. `deepseek-liwa` reaches the ACP server only through `ctx.acpExtensions`: per session it mounts the preset on the created agent, adds the notes section, selects the model, and installs the budget and conclude hooks; globally it counts tool calls, tallies assistant usage, and turns `subagent/start` and `subagent/end` into child updates. The presets carry no persona row, because the persona is the session patch's `personaPrefix`.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The profile's rows over base |
| [`presets/`](presets/work.patch.yml) | One agent preset per session kind |
| [`src/index.ts`](src/index.ts) | The `_liwa` extension plugin (the package root), re-exporting the wire format |
| [`src/protocol.ts`](src/protocol.ts) | The `_liwa` wire format (zod schemas) |
| [`src/startup.ts`](src/startup.ts) | Command line, help, and stdin end |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [@liwa/brain-deepseek](../../brain/brain-deepseek/README.md) — the provider that starts this process.
- [@liwa/acp](../../acp/acp/README.md) — the ACP server and its extension seam.
- [Bundle group](../README.md) — the other shipped layers.

-----

<a id="model-experience"></a>
## Model Experience

### Session notes system prompt section

#### What the model sees

When `_meta.liwa.notes` is non-empty, its text becomes the Agent-scope system prompt section `liwa:session-notes` (order `10150`), inserted as given with no template interpolation:

##### Session notes section

```markdown
<the text of _meta.liwa.notes>
```

#### Token effect

The length of the notes, in every request of the session.

#### KV Cache effect

Fixed when the session opens, so it stays inside the cached system prompt prefix; new notes take effect with the next session generation.

### Steering message

#### What the model sees

A `_liwa/steer` arrives as a user message before the running turn's next step, with the text blocks as given:

##### Steered input

```markdown
<the text blocks of the _liwa/steer prompt>
```

#### Token effect

The steered text, appended once to the conversation.

#### KV Cache effect

Append-only; it follows the cached prefix and invalidates nothing.

### Budget and child-policy refusals

#### What the model sees

A refused tool call returns an error tool result with the reason: `Error: the tool-call budget of this turn (<n>) is spent; conclude the turn`, `Error: native child agents are disabled for this session`, `Error: child agents may nest at most <n> level(s)`, or `Error: at most <n> child agent(s) may run at once`.

#### Token effect

One short sentence per refused call.

#### KV Cache effect

Append-only, like any tool result.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Children inherit no approval** — the base pins delegated in-process children to approval `never`, so a child's escalation is refused instead of reaching the client.
- **No `complete` preset step** — a preset has no hook to finish a task with a structured result; tasks end through their conclude tools.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
