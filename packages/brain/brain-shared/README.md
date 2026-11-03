---
description: "Paseo provider code shared by the Liwa brain providers (agent contract types, protocol files, provider utilities, subagent store, MCP injection) plus its bridge to the subprocess seam."
kind: "package-library"
---

# @liwa/brain-shared

English | [中文](README.zh.md)

## Summary

Brain provider packages build their Claude Code, Codex, and ACP clients on Paseo's code. This library holds the Paseo files those clients share, copied in place from one fixed commit, plus the bridge that sends their process work through `ctx.subprocess`. Provider packages import a migrated module by its upstream-shaped subpath. The package registers nothing and owns no provider; `NOTICE` records the origin and every in-place change.

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

Provider packages (`brain-acp`, `brain-deepseek`, `brain-claude`, `brain-codex`) import it while adapting their own copied Paseo client: the shared agent contract, the protocol helpers, the provider utilities, the provider subagent store, and runtime MCP configuration all live here once, so no provider copies them again.

### Entry point

```text
import type { AgentSession, AgentStreamEvent } from '@liwa/brain-shared/paseo/agent/agent-sdk-types'
import { checkProviderLaunchAvailable, resolveProviderLaunch } from '@liwa/brain-shared/paseo/agent/provider-launch-config'
import { spawnProviderProcess } from '@liwa/brain-shared'

const launch = await resolveProviderLaunch({ defaultBinary: 'claude' })
const { available } = await checkProviderLaunchAvailable(launch, ctx.subprocess)
const child = spawnProviderProcess(launchContext, launch.command, launch.args, { cwd, graceMs: 5_000 })
```

The package root exports the bridge: `findProviderExecutable` (resolved path or `null`), `execProviderCommand` (collected output, or a `ProviderCommandError` with exit facts), and `spawnProviderProcess` (piped stdio, terminated through the handle). Pass a brain session's launch context as the host so the session records the process.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Each file under `src/paseo/` is upstream Paseo source with a first-line origin comment; changed lines are edited in place and marked, with no mapping layer. The package compiles `src/paseo/` with Paseo's own strictness (no `noUncheckedIndexedAccess` or `exactOptionalPropertyTypes`), and lint, export-documentation, cast, duplication, and coverage gates treat `src/paseo/` like `vendor/`.

| Path | Role |
|---|---|
| [`src/paseo/agent/`](src/paseo/agent/agent-sdk-types.ts) | Agent contract, launch configuration, provider options and notices, refresh deadline, session import, timeline helpers, subagent store, runtime MCP configuration |
| [`src/paseo/agent/providers/`](src/paseo/agent/providers/provider-runner.ts) | Provider runner, tool-call mapping helpers, diagnostics, image output, JSONL framing |
| [`src/paseo/protocol/`](src/paseo/protocol/agent-types.ts) | Protocol types, provider configuration schemas, tool names, paths, tool-call display |
| [`src/paseo/utils/`](src/paseo/utils/path.ts) | Timeouts, path equivalence, string-command shells |
| [`src/process.ts`](src/process.ts) | The bridge from Paseo process calls to the subprocess seam |
| [`NOTICE`](NOTICE) | Upstream commit, license, and the per-file change list |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [@liwa/brain](../brain/README.md) — the contract the provider adapters map these types onto.
- [@liwa/subprocess](../../subprocess/subprocess/README.md) — the process seam the bridge targets.
- [Third-party notices](../../../THIRD_PARTY_NOTICES.md) — the repository-wide record of copied source.

-----

<a id="model-experience"></a>
## Model Experience

None, as this library only supplies provider-side code; each provider package owns what its CLI sends to a model.

#### KV Cache effect

Nothing here builds a model request, so it cannot invalidate a cached prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Paseo product chains stay behind** — attachments, Paseo's own tool catalog and presentation, the provider snapshot manager, the OpenCode bridge, and AgentManager glue were not copied; the affected types and branches were cut in place.
- **Upstream sync is manual** — updating to a newer Paseo commit means re-copying the files and re-applying the changes `NOTICE` lists.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
