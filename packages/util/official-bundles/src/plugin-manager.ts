/** The package names the plugin manager protects, hides, orders, or marks experimental. */

/**
 * Plugin packages the plugin manager refuses to disable or remove, because management itself needs them; a bundle that
 * contains one is read-only as well. Removing a name drops only this `management-required` refusal; the manager's own
 * entry, installation-carried bundles, and unaddressable rows stay protected by their own rules.
 */
export const PROTECTED_PLUGINS: ReadonlySet<string> = new Set([
  '@liwa/plugin-manager', '@liwa/cordis-plugin-loader',
  '@liwa/cordis-plugin-include', '@liwa/api-gateway',
  '@liwa/host-webserver', '@liwa/client-modules',
  '@liwa/client-ui-settings-plugin-inventory', '@liwa/client-ui-plugin-manager',
  '@liwa/host-plugin-inventory', '@liwa/typert-registry',
  '@liwa/api-remotes', '@liwa/api-remote-access',
  '@liwa/cordis-plugin-timer', '@liwa/client-connection',
  '@liwa/host-frontend-static', '@liwa/tools',
  '@liwa/hmr',
])

/**
 * Built-in profile bundles and persistent terminals, which have no plugin manager page.
 * Their Host availability and activation stay intact.
 */
export const HIDDEN_BUNDLES: ReadonlySet<string> = new Set([
  '@liwa/base',
  '@liwa/web-app',
  '@liwa/headless',
  '@liwa/sdk-app',
  '@liwa/acp-app',
  '@liwa/sdk-minimal',
  '@liwa/experimental-terminal-bundle',
])

/**
 * The optional bundles the plugin manager's main and More lists rank first, in this order. {@link MORE_BUNDLES}, not
 * this list, decides whether a bundle appears on the main list.
 */
export const EXTENSION_BUNDLES: readonly string[] = [
  '@liwa/experimental-agent-team-profile',
  '@liwa/experimental-voice-input-bundle',
  '@liwa/experimental-plugin-market-bundle',
  '@liwa/experimental-auto-review',
]

/**
 * The optional bundles the plugin manager's main list leaves out until the profile enables them; its More list,
 * which includes every eligible bundle, ranks them last in this order.
 */
export const MORE_BUNDLES: readonly string[] = [
  '@liwa/personalized-recommendations',
  '@liwa/experimental-inspector-profile',
  '@liwa/cua-bundle',
  '@liwa/experimental-tool-worktree',
  '@liwa/experimental-cot-translation-bundle',
  '@liwa/experimental-session-search',
  '@liwa/experimental-session-titles-bundle',
  '@liwa/experimental-badge-skill-bundle',
  '@liwa/experimental-ralph-bundle',
  '@liwa/subagent-codex',
  '@liwa/subagent-claude-code',
]

/** Official bundles the plugin manager marks with the Experimental badge. */
export const EXPERIMENTAL_BUNDLES: ReadonlySet<string> = new Set([
  '@liwa/personalized-recommendations',
  '@liwa/cua-bundle',
  '@liwa/experimental-agent-team-profile',
  '@liwa/experimental-voice-input-bundle',
  '@liwa/experimental-auto-review',
  '@liwa/experimental-inspector-profile',
  '@liwa/experimental-forge-bundle',
  '@liwa/experimental-tool-worktree',
  '@liwa/experimental-cot-translation-bundle',
  '@liwa/experimental-session-search',
  '@liwa/experimental-session-titles-bundle',
  '@liwa/experimental-badge-skill-bundle',
  '@liwa/experimental-ralph-bundle',
  '@liwa/experimental-plugin-market-bundle',
  '@liwa/experimental-liveshare',
])
