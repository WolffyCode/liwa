// 来源：paseo-upstream@8018231a packages/server/src/server/agent/stale-provider-session-error.ts；Apache-2.0，灵鲸改见 NOTICE。
/** Thrown when a prompt reaches a plugin session whose connection died with its plugin. */
export class StaleProviderSessionError extends Error {
  constructor(sessionId: string) {
    super(`Provider session ${sessionId} is stale after its plugin reloaded`);
    this.name = "StaleProviderSessionError";
  }
}

export function isStaleProviderSessionError(error: unknown): error is StaleProviderSessionError {
  return error instanceof StaleProviderSessionError;
}
