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
| [`brain-shared`](brain-shared/README.md) | Paseo provider code shared by the CLI providers, and its subprocess bridge | — (library) |

<a id="related-documentation"></a>
## Related documentation

- [Brain providers](../../docs/subsystems/brain.md) — the contract, session handles, and the versioned records.
- [Brain test kit](../test-support/brain-testkit/README.md) — the scripted provider and the contract suite.
- [Brain command](../bundle/brain-cli/README.md) — `liwa brain list|probe|run`.

<a id="dev-note"></a>
## Dev Note

None.
