---
kind: upgrade-guide
description: "The bundle lists and profile templates move from @liwa/app-boot to @liwa/official-bundles."
---

# Import bundle lists from `@liwa/official-bundles`

English | [中文](guide.zh.md)

## Change

`@liwa/app-boot` no longer exports `PROFILE_TEMPLATES`, `ProfileTemplate`, `DEFAULT_PROFILE_BUNDLES`, `OPTIONAL_BUNDLES`, `ON_DEMAND_BUNDLES`, `OFFICIAL_ON_DEMAND_CATALOG`, or `OfficialBundleCatalogEntry`. The new published package `@liwa/official-bundles` exports them with unchanged values and types. Code that imports any of these names from `@liwa/app-boot` fails to compile or load. The `liwa` launcher, profiles, and bundle selection behave as before.

## Migration

1. Add `@liwa/official-bundles` to the `dependencies` of each package that imports one of these names.
2. Change those imports from `@liwa/app-boot` to `@liwa/official-bundles`, for example `import { PROFILE_TEMPLATES } from '@liwa/official-bundles'`. Keep importing every other name, such as `initProfile` or `loadProfile`, from `@liwa/app-boot`.
3. Run your type check or build; it succeeds when no import of a moved name from `@liwa/app-boot` remains. See the [package README](../../../../packages/util/official-bundles/README.md) for each list.
