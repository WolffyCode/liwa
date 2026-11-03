// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/protocol/src/agent-message.ts；原地改动见包内 NOTICE。
import { z } from "zod";

/** Semantic provenance, independent of provider envelopes and timeline presentation. */
export const AgentMessageSchema = z.object({
  event: z.enum(["message", "finished", "errored", "permission-required", "closed"]),
  sender: z.object({
    id: z.string().min(1),
    serverId: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
  }),
  text: z.string(),
});

export type AgentMessage = z.infer<typeof AgentMessageSchema>;
