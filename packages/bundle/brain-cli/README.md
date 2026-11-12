---
description: "The liwa brain command: list, probe, and try the agent CLI providers of ctx.brains from a terminal, as the shipped brain profile over liwa-base."
kind: "package-bundle"
---

# @liwa/brain-cli

English | [中文](README.zh.md)

## Summary

`liwa brain` lists, probes, and tries the agent CLI providers a profile mounts. The shipped `brain` profile stacks this layer over `liwa-base`, so `liwa brain list` works without setup. `run` opens one session in the process, prints every event as one line, answers permission requests, runs one turn, and closes the session. Providers come from the plugins the profile mounts; the bundle mounts `deepseek` (Liwa's own agent) and a switched-off generic `acp` row.

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

### Install into a profile

The layer is in-box: the shipped `brain` profile (`@liwa/base`, `@liwa/brain-cli`) is created on first use, and `liwa brain <subcommand>` abbreviates `liwa --profile brain <subcommand>`. Provider plugins join that profile like any plugin:

```text
liwa plugin --profile brain add <provider-package>
```

### What you get

```text
liwa brain list [--json]
liwa brain probe <impl> [--json]
liwa brain run --provider <impl> [--model <m>] [--mode <mode>] [--thinking <option>] [--cwd <dir>] [--permit ask|allow-once|allow-session|deny]
               [--image <file>]... [--member <name>] [--mind <kind>] [--json] "<prompt>"
```

`list` probes every registered provider and prints a table; `probe` exits 1 when the provider is unavailable. `run` prepares the member configuration directory, opens a session with the command's values and the runner row's turn budget, prints events to stdout and session notes to stderr, and exits 0 when the turn completes. `--mode` is the provider's session mode, as in `paseo run` (for `deepseek`, `plan` or `default`). `--thinking` picks one of the chosen model's thinking options when the provider lists any. Before opening, `run` reads the global agent configuration set under the row's `agentsRoot` (`$LIWA_HOME/agents`) and the directory file for `--cwd`, selects the entries for the provider, copies the skills into a temporary directory, hands skills, MCP servers, plugins, hooks and instructions to the session, prints one `agent config for <impl>: …` line to stderr, and removes the temporary directory after the session closes. `--permit` answers permission requests and questions: `ask` prompts on the terminal (the default on a terminal), the allow policies answer a question with each question's first option, and `deny` (the default otherwise) declines. `--image` attaches a png, jpeg, webp, or gif file to the prompt. The scripted test provider joins through an explicit overlay:

```text
liwa brain --patch apps/cli/tests/profiles/brain/scripted-provider.patch.yml run --provider fake "hello"
```

-----

<a id="understand-the-implementation"></a>

`liwa brain probe <impl> --check-auth [--json]` explicitly checks provider authentication; Claude runs only auth status in an isolated temporary home. `liwa brain plugin install <plugin>@<marketplace> <source> --provider <impl>`, `plugin list --provider <impl> [--json]`, and `plugin update|remove <plugin>@<marketplace> --provider <impl>` manage the Liwa-owned plugin library. An unsupported provider fails explicitly; sessions never install plugins.

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The patch inserts rows over base: `brains` (`@liwa/brain`, `membersRoot` under the Liwa home), the provider rows `brain-deepseek` and `brain-acp` (disabled until a `command` is set), `brain-cli-startup` (parses the launcher's inner arguments and provides `brainStartup`), and `brain-cli` (runs the command after the loader settles, then requests exit). It disables HMR and the interactive credential store, as the one-shot headless profile does.

| File | Role |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | The layer's rows |
| [`src/startup.ts`](src/startup.ts) | Command grammar and help; publishes `brainStartup` |
| [`src/index.ts`](src/index.ts) | `list`, `probe`, `plugin`, and `run`; event lines and permission answers |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [@liwa/brain](../../brain/brain/README.md) — the service the command drives.
- [Bundle group](../README.md) — the other shipped layers.
- [liwa app](../../../apps/cli/README.md) — how `liwa <name>` selects a profile.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the selected provider: `run` hands the prompt to that provider's CLI, which builds every model request.

#### KV Cache effect

The command adds no model input of its own; caching is the provider's.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One turn per run** — `run` closes its session after the first turn; resident sessions, multi-session management, and reconnects belong to the future gateway.
- **No `sessions` or `children` subcommands** — a one-shot process has no sessions to list beyond its own run.
- **No model listing** — without `--model`, the session carries no model and the provider's CLI uses its own default; the command cannot list a provider's models yet.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
