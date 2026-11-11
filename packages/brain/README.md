---
description: "Brain capability packages: the agent CLI contract and ctx.brains, plus the Paseo provider code the CLI providers share."
kind: "package-group"
---

# packages/brain

English | [中文](README.zh.md)

## Summary

Brain providers connect agent CLIs — the deepseek agent process, Claude Code, Codex, and generic ACP agents — to Liwa as one session contract. This group owns that contract and the `ctx.brains` service, plus the Paseo provider code the CLI providers share. Each CLI provider ships as its own package that registers into `ctx.brains`.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Mount `brain` once; provider packages build on `brain-shared` and register into it.

| Package | Role | ctx key |
|---|---|---|
| [`brain`](brain/README.md) | Brain-provider contract, provider registration, and wrapped sessions | `ctx.brains` |
| [`brain-shared`](brain-shared/README.md) | Paseo provider code shared by the CLI providers, and the Paseo-session-to-contract mapping | — (library) |
| [`brain-acp`](brain-acp/README.md) | Generic ACP agent CLI provider on Paseo's ACP client | registers into `ctx.brains` |
| [`brain-deepseek`](brain-deepseek/README.md) | The `deepseek` provider: one `liwa --profile deepseek` process per session | registers into `ctx.brains` |
| [`brain-claude-code`](brain-claude-code/README.md) | Locally installed Claude Code through the official SDK, isolated per member and provider | registers into `ctx.brains` |
| [`minds`](minds/README.md) | Agent session runtime and provider catalog; B seams not wired | `ctx.minds` |
| [`toolport`](toolport/README.md) | Kernel MCP endpoint and tool serialization; B seams not wired | `ctx.toolport` |
| [`toolport-minds`](toolport-minds/README.md) | Agent tool handler contribution; B seams not wired | `—` |
| [`minds-restart-recovery`](minds-restart-recovery/README.md) | Replaceable restart recovery policy; B seams not wired | `—` |
| [`minds-idle-cleanup`](minds-idle-cleanup/README.md) | Replaceable idle runtime cleanup policy; B seams not wired | `—` |
| [`minds-structured-generation`](minds-structured-generation/README.md) | Structured generation loop and provider selection; B seams not wired | `ctx.structuredGeneration` |

<a id="related-documentation"></a>
## Related documentation

- [Brain providers](../../docs/subsystems/brain.md) — the contract, session handles, and the versioned records.
- [Brain test kit](../test-support/brain-testkit/README.md) — the scripted provider and the contract suite.
- [Brain command](../bundle/brain-cli/README.md) — `liwa brain list|probe|run`.

<a id="dev-note"></a>
## Dev Note

None.
