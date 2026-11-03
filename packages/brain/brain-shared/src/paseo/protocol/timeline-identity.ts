// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/protocol/src/timeline-identity.ts；原地改动见包内 NOTICE。
import type { AgentTimelineItem } from "./agent-types.ts";

export function timelineItemIdentity(item: AgentTimelineItem): string | null {
  if (item.type === "tool_call") return item.callId;
  if (item.type === "plugin") return `${item.pluginId}/${item.id}`;
  return null;
}
