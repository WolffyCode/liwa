// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/server/src/server/agent/provider-notices.ts；原地改动见包内 NOTICE。
import type { AgentProviderNotice } from "./agent-sdk-types.ts";

export const MODE_APPLIES_NEXT_TURN_NOTICE: AgentProviderNotice = {
  type: "warning",
  message: "Permission mode applies next turn",
};

export const THINKING_APPLIES_NEXT_TURN_NOTICE: AgentProviderNotice = {
  type: "warning",
  message: "Thinking level applies next turn",
};
