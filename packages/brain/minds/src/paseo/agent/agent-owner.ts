// 来源：paseo-upstream@8018231a packages/server/src/server/agent/agent-owner.ts；Apache-2.0，灵鲸改见 NOTICE。
import { z } from "zod";

export const AgentOwnerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("daemon"),
    daemonId: z.string(),
    executionId: z.string(),
  }),
]);

export type AgentOwner = z.infer<typeof AgentOwnerSchema>;
export type DaemonAgentOwner = Extract<AgentOwner, { kind: "daemon" }>;

export function daemonExecutionKey(owner: DaemonAgentOwner): string {
  return `${owner.daemonId}\0${owner.executionId}`;
}
