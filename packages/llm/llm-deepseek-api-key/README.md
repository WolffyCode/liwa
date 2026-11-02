---
description: "DeepSeek API-key authentication, model discovery, and the official model listing."
kind: "package-reference"
---

# @liwa/llm-deepseek-api-key

English | [中文](README.zh.md)

## Summary

Register authentication, model discovery, and the official model listing for `deepseek-official`. This plugin shares the [Messages transport](../llm-deepseek/README.md) and owns credential resolution, catalog availability, and model admission.

Authentication resolution returns the validated API key in `x-api-key` for both Messages and Files requests.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="use-this-package"></a>
## Use this package

`apiKeyEnv` defaults to `DEEPSEEK_API_KEY` and resolves per request and model discovery. When the credentials service exists, its precedence applies; only compositions without that service read the launch environment directly. Requests with missing credentials fail with `MISSING_CREDENTIAL`; malformed credentials fail with `INVALID_CREDENTIAL`. Model discovery returns an empty catalog when the credential is missing, hiding the route from model selectors while retaining its settings entry. Malformed credentials and other lookup failures propagate. Adding or removing a key affects the next discovery call.

```yaml
- id: llm-deepseek
  name: '@liwa/llm-deepseek-api-key'
  config:
    reasoningEffort: high
    apiKeyEnv: DEEPSEEK_API_KEY
```

The endpoint and credential reference come from one configuration resolution. In-flight requests retain that snapshot; subsequent updates affect subsequent calls.

`models` is an independently configurable catalog for this provider; defaults and protocol capabilities come from the shared transport. While `models` equals the built-in catalog and the Messages origin is the official API, `https://api.deepseek.com`, the route serves the official `GET https://api.deepseek.com/models` listing instead. Listing requests carry the API key in `x-api-key` and Liwa `User-Agent`, and reject redirects; without an API key the route requests nothing. Any other endpoint, including one named by `baseURL` or `$DEEPSEEK_BASE_URL`, serves `models` and requests no listing. Discovery does not probe inference endpoints.

The first access waits for the listing up to `modelsTimeoutMs`. After first use, the Host refreshes automatically every `modelsMaxAgeMs` (ten minutes by default), including while the page is idle. Later accesses return the cached listing while a refresh runs. A failed or empty listing retains the previous listing, including badges; before any listing loads, the route serves the built-in catalog of the current version (`deepseek-flash` and `deepseek-v4-pro`). A listing HTTP 401 fails only that load. Each loaded listing, the first failure of a failing streak with the catalog it falls back to, each listing entry hidden because its declarations are unreadable or unusable, and each dropped badge are written to stderr with the `[llm-deepseek-api-key]` tag; stdout remains available for protocol messages, and secrets are never logged. Changed listings emit `llm/models-updated`, so open selectors reload without a page refresh. Omitted or `null` badge metadata clears a previous badge; no separate clear operation is needed. Plugin disposal stops refreshes and waits for active loads.

A listed model is offered only when the current Liwa version can serve it. A model that declares `client_requirements["deepseek-harness"].min_version` is offered when the current version is at least that version in semantic-version order, including prerelease tags such as `0.2.0-alpha.1` and `0.2.0-rc.1`. A prerelease orders below its release: `min_version: 0.2.1` refuses `0.2.1-alpha.2`, so a listing that admits prereleases declares the earliest one it admits, such as `0.2.1-alpha.0`. A model without that declaration is offered only when the built-in catalog knows its id; other listed models stay hidden. A request for a listed model the current version cannot serve fails before network I/O with `CLIENT_UPGRADE_REQUIRED`, which names the required and current versions, or with `MODEL_UNSUPPORTED`. Model ids the listing does not name pass through unchanged.

Offered models take the listing's name, `context_window`, input modalities, and Messages system prompt and tool update modes (`api_capabilities.anthropic_messages.system_prompt_update` and `tool_update`) over the bundled entry for the same id, which keeps its image budgets and description. A mode the listing omits or sets to `null` keeps the bundled one; any value other than the modes this build reads (`in-history` for system prompts; `in-history` or `addition-only` for tools) reads as `leading-only`, which removes the bundled mode. `max_output_tokens` bounds the request default: a request that names no cap sends the smaller of `maxTokens` and that capability. The listing's effort levels are not read; every model offers `off`, `low`, `high`, and `max`.

An offered model shows the badge its listing entry declares under `client_metadata["deepseek-harness"].badge` beside its name in the Web model selector. `client_metadata` holds client-specific data that any build may ignore; unlike `client_requirements`, nothing under it hides a model. `badge.text` is a string, or an object keyed by lowercase language ids such as `en`, `zh`, and `ja` that includes `en`; the selector shows the active language's text and otherwise English. Each text is trimmed and must be 1 to 12 characters on one line; an emoji or a letter with combining marks counts as one character. `badge.tone` is `neutral`, `info`, `success`, or `warning`; an absent or other value shows `neutral`. An absent or `null` value at any level of that path shows no badge, because this build has no badge of its own to fall back on. When a level is not an object or the badge is unreadable, the badge is dropped while its model stays offered. Badges are display data: model requests, Session events, and model-facing tools never carry them.

A `models` list that differs from the built-in catalog replaces the catalog and stops listing requests; the Models page stores an edited catalog there. Removing that list, as **Restore defaults** on the Models page does, returns the route to the listing, and the next access loads the listing again even when the cached one is still fresh. A list identical to the built-in catalog counts as uncustomized.

| Field | Default | Meaning |
|---|---|---|
| `modelsTimeoutMs` | `5,000` | Deadline of one listing request and of a first-access wait |
| `modelsMaxAgeMs` | `600,000` | Automatic refresh interval after first use, also used after failure; `0` refreshes on access only |

The settings namespace is the Cordis entry id, or the plugin name without an entry. Product profiles retain the official entry id `llm-deepseek`.

<a id="understand-the-implementation"></a>
## Understand the implementation

Registrations and listeners dispose with the plugin, and disposal aborts an in-flight listing request. Shared Host wiring supplies attachments, request extensions, anonymous identity, and atomic retry-policy updates; this plugin registers only its own route and uses the transport's `connect` and `admit` hooks for the listed catalog and the gate. The listing request, its cache, and catalog resolution come from the shared transport; the cache lives in memory and is keyed by endpoint and a SHA-256 of the key, so another key loads its own listing. A `loader/volatile-update` listener discards the cached listing whenever the route starts or stops following it.

<a id="further-exploration"></a>
## Further Exploration

[LLM streaming](../../../docs/subsystems/llm-streaming.md) · [Messages](../llm-deepseek/README.md) · [Official listing decision](../../../.agents/notes/implemented/architecture/2026-10-22-deepseek-official-model-listing.md)

<a id="model-experience"></a>
## Model Experience

### Authenticated model requests

#### What the model sees

Requests on `deepseek-official` add no model-visible text from this plugin; the shared Messages transport serializes requests.

#### Token effect

Authentication, discovery, and the listing add no input tokens. The followed listing sets each model's context window and default output cap, which each request's logged context and header record.

#### KV Cache effect

Credentials and catalog availability do not enter model input; the protocol transport owns request-prefix serialization. A listing change to a model's system prompt or tool update mode changes how later system prompt or tool updates are serialized.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- A configured catalog is configuration metadata, not remote validation that a model is accepted; actual calls can still fail.
- The Models page shows the built-in catalog while the route follows the listing, so a model only the listing offers appears only in model selectors. Editing that catalog on the page stores the rows the page shows, which drops such a model until **Restore defaults**.
- A customized catalog does not receive models the listing adds later.
- Customization is judged against the running version's built-in catalog, so a saved `models` list equal to an earlier version's built-in catalog counts as customized once the built-in catalog changes and stops following the listing until **Restore defaults**.
- The listing cache lives in memory; a start without network serves the built-in catalog until a listing loads.
- A listing change during a running process reaches the Web model picker at its next catalog refresh; the plugin does not announce it.
- When the current version can serve no listed model, the route offers no models.

<a id="dev-note"></a>
### Dev Note

Registration and authentication tests also cover the Loader composition in the shared transport package.
