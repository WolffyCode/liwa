/** The bundle package names the liwa installation selects, offers, installs on demand, or retires. */

/** Installation-owned defaults used when a shipped profile is first opened. */
export interface ProfileTemplate {
  /** Ordered bundle layer list. */
  bundles: readonly string[]
}

/** The shipped profile templates auto-initialized on first use, by name. */
export const PROFILE_TEMPLATES: Record<string, ProfileTemplate> = {
  acp: {
    bundles: ['@liwa/base', '@liwa/acp-app'],
  },
  web: {
    bundles: ['@liwa/base', '@liwa/web-app'],
  },
  headless: {
    bundles: ['@liwa/base', '@liwa/headless'],
  },
  sdk: {
    bundles: ['@liwa/base', '@liwa/sdk-app'],
  },
  'sdk-minimal': {
    bundles: ['@liwa/sdk-minimal'],
  },
  brain: {
    bundles: ['@liwa/base', '@liwa/brain-cli'],
  },
  deepseek: {
    bundles: ['@liwa/base', '@liwa/deepseek-app'],
  },
}

/**
 * Installation-owned bundle tuples that an earlier release wrote into a shipped profile; app-boot replaces an exact
 * match with the {@link PROFILE_TEMPLATES} entry of the same name and leaves every other list untouched.
 */
export const INSTALLATION_OWNED_PROFILE_TUPLES: Readonly<Record<string, readonly string[]>> = {
  headless: ['@liwa/base', '@liwa/web-app', '@liwa/headless'],
}

/** Bundles an earlier release shipped and the installation no longer carries; app-boot removes them from profiles. */
export const RETIRED_BUNDLES: ReadonlySet<string> = new Set([
  // The Web composition mounts Schedule itself
  // ([upgrade guide](../../../../docs/upgrade-guide/v0.2.0-rc.2/schedule-bundle-retired/guide.md)).
  '@liwa/experimental-schedule-bundle',
])

/** The bundle list a `liwa plugin` init uses for a name with no shipped template. */
export const DEFAULT_PROFILE_BUNDLES: readonly string[] = ['@liwa/base']

/**
 * The bundles the liwa installation ships for a person to switch on: each a
 * runtime dependency of the installation that declares `liwa.bundle.patch`,
 * an `icon`, and `./locale/*.json` display metadata, selected by no shipped
 * template, and offered switched off by the plugin manager except persistent
 * terminals, which have no page switch
 * ([rationale](../../../../.agents/notes/implemented/process/2026-09-15-shipped-optional-bundles.md),
 * [admission](../../../../.agents/notes/implemented/architecture/2026-09-21-experimental-capabilities-as-optional-bundles.md)).
 */
export const OPTIONAL_BUNDLES: readonly string[] = [
  '@liwa/personalized-recommendations',
  '@liwa/cua-bundle',
  '@liwa/experimental-session-search',
  '@liwa/experimental-ralph-bundle',
  '@liwa/experimental-terminal-bundle',
  '@liwa/experimental-badge-skill-bundle',
  '@liwa/experimental-session-titles-bundle',
  '@liwa/experimental-agent-team-profile',
  '@liwa/experimental-voice-input-bundle',
  '@liwa/experimental-cot-translation-bundle',
  '@liwa/experimental-auto-review',
  '@liwa/experimental-inspector-profile',
  '@liwa/experimental-liveshare',
  '@liwa/experimental-plugin-market-bundle',
  '@liwa/experimental-tool-worktree',
  '@liwa/experimental-forge-bundle',
]

/** Public Liwa release members available through the ordinary on-demand bundle installer. */
export const ON_DEMAND_BUNDLES: readonly string[] = [
  '@liwa/subagent-claude-code',
  '@liwa/subagent-codex',
]
