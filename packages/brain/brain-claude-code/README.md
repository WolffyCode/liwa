---
description: "The Claude Code brain provider: official SDK, locally installed CLI, isolated member configuration, and Paseo-style plaintext env per instance for key and endpoint."
kind: "package-reference"
---

# @liwa/brain-claude-code

English | [中文](README.zh.md)

## Summary

Connects the locally installed Claude Code CLI to `ctx.brains` through the official SDK pinned to 0.3.263. Each plugin row is an independent provider with its own model list, endpoint and plaintext env (as in a Paseo custom provider). Sessions share only their member/impl native transcript root. The first version accepts `work`; `instance`, `think`, `own` and `tidy` fail with `invalid_input` until real CLI tool and compaction isolation pass A2. Basis: [adaptation assessment](../../../docs/liwa/research/2026-11-05-claude-code-adaptation.md), sections 4–8; implementation: [`src/provider.ts`](src/provider.ts), [`src/config.ts`](src/config.ts).

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

The `brain-cli`, `web-app` and `headless` bundles include disabled example rows. One row is one instance; like a Paseo custom provider, the key and endpoint go straight into `env`. Several rows of the same plugin are several providers, for example one Claude routed through reclaude and one GLM on the z.ai endpoint:

```yaml
- id: brain-claude-code
  name: '@liwa/brain-claude-code'
  config:
    impl: claude-reclaude
    label: Claude via reclaude
    env:
      ANTHROPIC_API_KEY: replace-with-the-reclaude-key
      ANTHROPIC_BASE_URL: http://127.0.0.1:8080
    models:
      - id: sonnet
        label: Sonnet
        isDefault: true
        thinkingOptions:
          - { id: high, label: High, isDefault: true }
          - { id: off, label: Off }
      - { id: opus, label: Opus }
    skills: /srv/liwa/claude-skills
    mcpServers:
      docs:
        type: http
        url: https://mcp.example.test/docs
    plugins: [/srv/liwa/claude-plugins/review]
    hooks:
      PreToolUse:
        - matcher: Bash
          hooks: [{ type: command, command: /srv/liwa/hooks/audit-bash.sh }]
- id: brain-claude-code-glm
  name: '@liwa/brain-claude-code'
  config:
    impl: claude-glm
    label: GLM via Claude Code
    env:
      ANTHROPIC_AUTH_TOKEN: replace-with-the-zai-key
      ANTHROPIC_BASE_URL: https://api.z.ai/api/anthropic
      API_TIMEOUT_MS: "3000000"
    disallowedTools: [WebSearch]
    models:
      - { id: glm-5-turbo, label: GLM 5 Turbo, isDefault: true }
      - { id: glm-5.1, label: GLM 5.1 }
```

`liwa brain run --provider claude-glm "task"` uses that instance's default model. Exactly one model must be the default; duplicate or unknown ids are rejected before execution. `probe` resolves the selected executable and only runs its `--version`; the SDK receives the same absolute path. `binaryArgs` are fixed arguments placed right after the executable, before the SDK's own (a wrapper script or container entry point); the probe passes them too. The first protocol baseline is 2.1.318.

`env` holds plaintext deployment variables for the child process and, like Paseo, accepts anything. Exactly one of `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` is required; they map to the CLI's x-api-key and Bearer headers, so pick the one your endpoint expects. `ANTHROPIC_BASE_URL` is optional and must be HTTP(S) without credentials. Model aliases (`ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_*_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL`), `API_TIMEOUT_MS`, `MAX_THINKING_TOKENS` and any other deployment variable are written as they are. HOME/USERPROFILE, temporary and XDG roots, config/secure-storage paths, process loaders, runtime-owned Claude flags and session safety switches (including DISABLE_COMPACT and ENABLE_TOOL_SEARCH) cannot be overridden and fail at load. Only OS executable-search and locale/display basics survive from the parent environment. Authentication values and `ANTHROPIC_CUSTOM_HEADERS` are removed from stderr (including split chunks), diagnostics, logs and native control errors. The key is stored in plaintext in the configuration and the web configuration page shows it as is; credential-service and login-based authentication are left for later.

Each row can also carry its own skills directory (`skills`), MCP servers (`mcpServers`, merged with the session's; `liwa` is reserved for kernel tools and a name used by both fails at open), local plugin directories (`plugins`, each with `.claude-plugin/plugin.json`), settings-format command hooks (`hooks`, handed to the CLI through its `--settings` layer) and per-model `thinkingOptions` (`off`, `low`, `medium`, `high`, `xhigh`, `max`, `ultracode`; a session picks one with `--thinking`, otherwise the model's default option applies and a model without options leaves thinking to the CLI; `setThinking` changes it between turns by restarting the query, and a model switch keeps an explicitly chosen option or refuses when the new model lacks it). Paths must be absolute and are checked at load; the CLI's own global and project configuration still never loads. A session's own `plugins`, `hooks` and `instructions` (from the global agent configuration set, see `@liwa/brain`) are added to the row's: plugin directories append, hooks are grouped per event with the session's (global set) first and the row's after, and the instructions go after the rules and before the repository `CLAUDE.md`. Session modes are `default`, `plan`, `acceptEdits` and `auto`; `bypassPermissions` stays unavailable.

`CLAUDE_CONFIG_DIR` points to the generated member/impl root; `HOME` is an empty directory below it. Inherited authentication, config overrides and `CLAUDE_SECURESTORAGE_CONFIG_DIR` are removed. No default login is consulted. Empty `settingSources`, strict MCP and explicit plugin/skill snapshots prevent ambient configuration selection. `projectDocs: true` reads only `<cwd>/CLAUDE.md` as text into the system prompt; it never enables project settings or hooks. Missing documents are optional; unreadable or oversized instructions fail. `instructionsMaxBytes`, `probeTimeoutMs`, `controlTimeoutMs` and `graceMs` are configurable.

## Understand the implementation

Paseo's Claude session and task observation sources are modified in place under `src/paseo/`; [`NOTICE`](NOTICE) records every file. The strict adapter owns process bridging, configuration, answer encoding, usage and budget policy. The official SDK handles stream-json; every child starts through `launch.spawn` and disposal waits for the managed process range. Model and mode changes report events after success. Modes are `default` and `plan`; approving a plan returns to `default` without granting edit bypass.

Permission requests preserve tool input and child ownership. Exact MCP tools can be allowed for the session; permanent rules and broad directory/mode suggestions are not offered. Question answers are keyed by exact question text. Single selections, unambiguous multiple selections and free text are supported. Duplicate text/labels, comma ambiguity and selection-plus-notes are refused while the request remains answerable. The latter needs real CLI annotations verification.

`next_step` uses SDK priority `next`; `next_turn` returns `unsupported`. Cancellation withdraws unread input first, then interrupts and waits for the result. Failed control requests propagate. Owner, pause, drain and hard-limit cancellation stop known native tasks first; preemption and watchdog cancellation retain background tasks. Native `task_id` maps to Paseo's stable first `tool_use_id`; permission callbacks wait for the corresponding task declaration, and denies the native approval if that declaration times out. It publishes no substitute child ID; native task IDs stay in diagnostics. Abort and close end the wait immediately.

`modelUsage` and estimated cost are cumulative per Query. The adapter differences each model snapshot, includes cache reads and writes separately, and resets the baseline for a fresh Query or native clear. Completed, interrupted and failed turns settle known consumption once through G1. Child detail is not added again; `task_notification.total_tokens` is context size and is not reported as child spending. Crash/startup error results with zeroed counters preserve their original failure and leave spending unknown without resetting the valid cumulative baseline. Other regressing snapshots fail loudly. Context snapshots remain separate from consumption.

Resume handles bind the original member/impl root and a full UUID. Missing native JSONL transcripts fail with `not_found`; unreadable or damaged transcripts fail with `unavailable`. Cross-root paths and symlink escapes fail before opening. UI replay tolerance is separate from resume admission. When the CLI later reports that the conversation does not exist (No conversation found), this generation and its handle are invalidated; restore the data and open a new session. Other first-turn failures are ordinary turn failures and keep the handle.

`maxTurns` bounds the main loop. Successful parent MCP calls matching `concludeOn` are recorded by `PostToolUse`; `PostToolUseFailure` removes success, and `PostToolBatch` returns `continue: false` before another model step. Child tools, failed calls and unconfigured MCP servers cannot conclude the parent. Kernel permission mode forces approval through a `PreToolUse` ask decision. Compaction off sets both `autoCompactEnabled: false` and `DISABLE_COMPACT=1`.

## Model Experience

### Work session instructions and tools

#### What the model sees

The CLI receives its work preset with stable persona, explicit rules, optional project document and notes appended. JPEG, PNG, GIF and WebP images travel as SDK content blocks; other image types are rejected. Only session-supplied MCP servers and explicit member skill snapshots are available; tools can be disabled entirely, or limited to Read/Glob/Grep for readonly sessions. Native children require worktree policy.

#### Token effect

The appended instructions and configured tool definitions occupy context on each request; images and tool results consume model tokens according to the selected endpoint. The complete instruction block is bounded by `instructionsMaxBytes`.

#### KV Cache effect

Stable instructions precede changing notes. Claude owns prompt assembly and caching; usage reports cache reads and writes without assuming a hit rate.

## Known Limitations and Deferred Work

- Real CLI compatibility, file access isolation, annotations and compaction pressure still require the separately authorized A2. Fake CLI tests exercise the official SDK and process ownership, not the model or filesystem behavior of a real Claude process.
- The provider has no next-turn queue, rollback, quota lookup or strict total tool-call budget. `maxTurns` is not a global bound on native child/helper inference. Depth and concurrency limits for native children are not guaranteed.
- Background spending without an attributable result, and consumption lost before a terminal result, remain unknown. No zero is fabricated. Session-wide background attribution is outside G1.
- Exact MCP tool session rules are supported; broader native shell/file rules are deferred. Selection-plus-notes stays rejected pending A2. Project document inheritance and recursive project skill discovery are not implemented.

### Dev Note

This package follows the [brain contract](../brain/README.md) and [shared session mapping](../brain-shared/README.md). The capability declaration is `CLAUDE_META`; instance admission remains separate from the compaction switch declaration.
