// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/server/src/server/agent/providers/acp-options.ts；原地改动见包内 NOTICE。
import { z } from "zod";

export const ACPProviderOptionsSchema = z
  .object({
    supportsMcpServers: z.boolean().optional(),
    clientCapabilities: z
      .object({
        fs: z
          .object({
            readTextFile: z.boolean().optional(),
            writeTextFile: z.boolean().optional(),
          })
          .optional(),
        terminal: z.boolean().optional(),
      })
      .optional(),
  })
  .passthrough();
