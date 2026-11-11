// 来源：paseo-upstream@8018231a packages/server/src/server/client-message-id.ts；Apache-2.0，灵鲸改见 NOTICE。
import { randomUUID } from "node:crypto";

export function normalizeClientMessageId(clientMessageId: string | undefined): string | undefined {
  if (typeof clientMessageId !== "string") {
    return undefined;
  }
  const trimmed = clientMessageId.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveClientMessageId(
  clientMessageId: string | undefined,
  generateId: () => string = randomUUID,
): string {
  return normalizeClientMessageId(clientMessageId) ?? generateId();
}
