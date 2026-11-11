// 来源：paseo-upstream@8018231a packages/protocol/src/agent-lifecycle.ts；Apache-2.0，灵鲸改见 NOTICE。
export const AGENT_LIFECYCLE_STATUSES = [
  "initializing",
  "idle",
  "running",
  "error",
  "closed",
] as const;

export type AgentLifecycleStatus = (typeof AGENT_LIFECYCLE_STATUSES)[number];
