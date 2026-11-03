// 来源：getpaseo/paseo@8018231a00a6b45ed6cda1856f954ba14b4824c0（Apache-2.0）packages/server/src/server/agent/provider-history-timestamps.ts；原地改动见包内 NOTICE。
export function normalizeProviderReplayTimestamp(value: unknown): string | null {
  if (typeof value === "string") {
    const timestamp = value.trim();
    if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
      return null;
    }
    return timestamp;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const timestampMs = value > 1_000_000_000_000 ? value : value * 1000;
  const date = new Date(timestampMs);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
