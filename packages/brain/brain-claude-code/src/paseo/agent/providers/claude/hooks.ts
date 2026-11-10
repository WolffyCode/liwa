// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/server/src/server/agent/providers/claude/hooks.ts；改动见包内 NOTICE。
import type { ClaudeOptions } from "./query.ts";

type ClaudeHooks = NonNullable<ClaudeOptions["hooks"]>;

/**
 * Combine Paseo's observation hooks with any the user configured, per event.
 *
 * Neither side wins: Claude Code runs every matcher registered for an event, so appending keeps
 * a user's hooks working while Paseo keeps observing. Assigning either one would silently drop
 * the other, and the failure would be invisible — effort would simply stop appearing.
 */
export function mergeClaudeHooks(own: ClaudeHooks, extra: unknown): ClaudeHooks {
  if (!extra || typeof extra !== "object") return own;
  const merged: ClaudeHooks = { ...own };
  for (const [event, matchers] of Object.entries(extra as Record<string, unknown>)) {
    if (!Array.isArray(matchers)) continue;
    const key = event as keyof ClaudeHooks;
    merged[key] = [...(merged[key] ?? []), ...matchers] as ClaudeHooks[typeof key];
  }
  return merged;
}
