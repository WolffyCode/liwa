---
kind: upgrade-guide
description: "The `agent-instructions` row no longer accepts `liwaHome`; instruction loading always resolves the Liwa home from `$LIWA_HOME` or `~/.liwa`."
---

# Instruction loading resolves one Liwa home

English | [中文](guide.zh.md)

## Change

`@liwa/agent-instructions` removed its `liwaHome` config field. The plugin resolves the Liwa home through `resolveLiwaHome()` from `@liwa/home-paths`, like every other harness consumer: the home is `$LIWA_HOME` when it is set and non-blank, otherwise `~/.liwa`, with tilde expansion.

A `cordis.yml`, profile patch, or `--patch` overlay that still sets `liwaHome` on the `agent-instructions` row has no effect: the row keeps the stray key and the plugin ignores it, so instruction loading follows the process home. Other providers, such as `liwa-skill-filesystem` and `liwa-shell-env`, keep their own home fields; this removal covers the instruction loader only.

## Migration

1. Delete `liwaHome` from the `agent-instructions` row in `cordis.yml`, `$LIWA_HOME/cordis.patch.yml`, `$LIWA_HOME/profiles/<profile>/cordis.patch.yml`, and any `--patch` overlay.
2. Where the override pointed at a non-default home, export `LIWA_HOME` for the process instead, so every harness consumer reads that home.
3. Confirm with `liwa --profile <profile> --dump-config` that the `agent-instructions` row lists only its remaining fields, and that a new session's first request shows `Instructions from: $LIWA_HOME/AGENTS.md` (or `~/.liwa/AGENTS.md`) when that file exists.
