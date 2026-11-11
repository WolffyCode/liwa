---
description: "Replaceable idle runtime cleanup policy; B scaffold with copied source and injection contracts, pending business wiring."
kind: "package-reference"
---

# @liwa/minds-idle-cleanup

English | [中文](README.zh.md)

<a id="summary"></a>
## Summary

Replaceable idle runtime cleanup policy. Paseo source is copied from `8018231a` into `src/paseo/`; [NOTICE](NOTICE) records every file and change. The B entry validates deployment configuration. It is not included in a product composition and creates no provider sessions.

<a id="table-of-contents"></a>
## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## Use this package

This package is ready for wiring by the later seam blocks. The package entry corresponds to `src/index.ts`; copied modules use the declared `./paseo/*` exports. Consumers use these exports across package boundaries. Deployment Config fields follow [01-agent-cli section 4.9](../../../docs/liwa/architecture/modules/01-agent-cli.md#49-包划分与进程模型); fields without an agreed default require an explicit value.

`idleAfterMs`, `sweepIntervalMs`, `probeTimeoutMs`.

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/paseo/` keeps upstream style and compiles through `tsconfig.paseo.json`. The main project checks Liwa-owned `src/index.ts` and `src/seams/`, when present, under the full repository options. Pure type seams imported by copied code are also listed as inputs to the Paseo project; the main project still checks them strictly. No verification exemption is added.

| Path | Responsibility |
| --- | --- |
| [src/index.ts](src/index.ts) | Config and B plugin scaffold |
| `src/paseo/` | Copied source owned by this package, enumerated in NOTICE |
| [NOTICE](NOTICE) | Fixed source, license and per-file changes |
| [tests/scaffold.spec.ts](tests/scaffold.spec.ts) | Configuration and load/disposal checks, separate from business acceptance |

<a id="model-experience"></a>
## Model Experience

### B′

#### What the model sees

The B entry at `src/index.ts` registers no prompts, tools or model calls. Copied business paths are not wired. Callers must wait for the owning seam block before using runtime capabilities.

#### Token effect

Loading the current entry creates no model request and adds zero direct tokens.

#### KV Cache effect

The current entry assembles or replaces no request prefix. Wiring a later seam must update this section for its actual inputs.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Seams pending wiring** — This package is at B with type-only injection contracts. Storage (C), providers (D), JSONL (E), tool catalogs/tokens (F) and delivery/generations (G) remain to be wired; the current package does not claim those capabilities work.
- **Upstream tests deferred** — Each owning seam block copies, adapts and runs its tests and required fixtures. B copies no upstream tests and runs no real CLI or e2e.

<a id="dev-note"></a>
### Dev Note

Basis: [package boundaries](../../../docs/liwa/architecture/modules/01-agent-cli.md#49-包划分与进程模型) and [implementation blocks](../../../docs/liwa/architecture/modules/01-brain-host.md#93-分块实施与重点评审).
