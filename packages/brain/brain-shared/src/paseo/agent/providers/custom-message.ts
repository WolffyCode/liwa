// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/server/src/server/agent/providers/custom-message.ts；原地改动见包内 NOTICE。
import type { AgentTimelineItem } from "../agent-sdk-types.ts";

/** Preserve extension context as an expandable tool row instead of assistant speech. */
export function mapCustomMessageToToolCall(
  message: { role: "custom"; customType?: unknown; details?: unknown },
  text: string,
  callId: string,
): Extract<AgentTimelineItem, { type: "tool_call" }> {
  const customType =
    typeof message.customType === "string" && message.customType.trim()
      ? message.customType
      : "custom-message";
  return {
    type: "tool_call",
    callId,
    name: customType,
    status: "completed",
    detail: { type: "plain_text", text },
    metadata: {
      synthetic: true,
      customType,
      ...(message.details === undefined ? {} : { details: message.details }),
    },
    error: null,
  };
}
