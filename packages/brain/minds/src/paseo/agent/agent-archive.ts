// 来源：paseo-upstream@8018231a packages/server/src/server/agent/agent-archive.ts；Apache-2.0，灵鲸改见 NOTICE。
import type { StoredAgentRecord } from "./agent-storage.ts";

export type ArchivedStoredAgentRecord = StoredAgentRecord & { archivedAt: string };

interface BuildArchivedAgentRecordOptions {
  archivedAt?: string;
  updatedAt?: string;
}

export function buildArchivedAgentRecord(
  record: StoredAgentRecord,
  options?: BuildArchivedAgentRecordOptions,
): ArchivedStoredAgentRecord {
  const archivedAt = options?.archivedAt ?? new Date().toISOString();
  return {
    ...record,
    archivedAt,
    updatedAt: options?.updatedAt ?? record.updatedAt,
    lastStatus: normalizeArchivedStatus(record.lastStatus),
    requiresAttention: false,
    attentionReason: null,
    attentionTimestamp: null,
  };
}

function normalizeArchivedStatus(
  status: StoredAgentRecord["lastStatus"],
): StoredAgentRecord["lastStatus"] {
  return status === "running" || status === "initializing" ? "idle" : status;
}
