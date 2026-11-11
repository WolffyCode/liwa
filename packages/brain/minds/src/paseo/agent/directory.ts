// 来源：paseo-upstream@8018231a packages/server/src/server/agent/directory.ts；Apache-2.0，灵鲸改见 NOTICE。
import type { AgentSnapshotPayload } from "@liwa/brain-shared/paseo/protocol/messages";

import type { AgentManager, ManagedAgent } from "./agent-manager.ts";
import type { AgentStorage, StoredAgentRecord } from "./agent-storage.ts";

/** Public agent discovery merges live and durable records without a workspace registry. */
export class AgentDirectory {
  constructor(
    private readonly deps: {
      manager: Pick<AgentManager, "listAgents">;
      storage: Pick<AgentStorage, "list">;
      projectLive(agent: ManagedAgent): Promise<AgentSnapshotPayload>;
      projectStored(record: StoredAgentRecord): AgentSnapshotPayload;
      isProviderVisible(provider: string): boolean;
      isStoredProviderAvailable(record: StoredAgentRecord): boolean;
    },
  ) {}

  async includes(
    agent: Pick<AgentSnapshotPayload, "internal">,
  ): Promise<boolean> {
    if (agent.internal) return false;
    return true;
  }

  async list(filter?: {
    labels?: Record<string, string>;
    includeArchived?: boolean;
    includeUnavailablePersisted?: boolean;
  }): Promise<AgentSnapshotPayload[]> {
    const live = this.deps.manager.listAgents();
    const liveIds = new Set(live.map((agent) => agent.id));
    const labels = Object.entries(filter?.labels ?? {});

    const matches = (agent: {
      archivedAt?: string | null;
      labels?: Record<string, string>;
    }) =>
      (filter?.includeArchived || !agent.archivedAt) &&
      labels.every(([key, value]) => agent.labels?.[key] === value);
    const stored = (await this.deps.storage.list())
      .filter((record) => !record.internal && !liveIds.has(record.id) && matches(record))
      .filter(
        (record) =>
          filter?.includeUnavailablePersisted || this.deps.isStoredProviderAvailable(record),
      )
      .map((record) => this.deps.projectStored(record));
    const active = await Promise.all(
      live.filter(matches).map((agent) => this.deps.projectLive(agent)),
    );
    return [...active, ...stored]
      .filter(matches)
      .filter((agent) => this.deps.isProviderVisible(agent.provider));
  }
}
