// 来源：paseo-upstream@8018231a packages/server/src/server/agent/create-agent/intent.ts；Apache-2.0，灵鲸改见 NOTICE。
import { PARENT_AGENT_ID_LABEL } from "@liwa/brain-shared/paseo/protocol/agent-labels";

export interface CreateAgentCaller {
  id: string;
}

export interface CreateAgentIntent {
  cwd: string;
  parentAgentId: string | null;
  labels: Record<string, string>;
}

export async function resolveCreateAgentIntent(input: {
  cwd: string;
  caller: CreateAgentCaller | null;
  labels?: Record<string, string>;
  childAgentDefaultLabels?: Record<string, string>;
  legacyDetached?: boolean;
}): Promise<CreateAgentIntent> {
  const parentAgentId = input.legacyDetached ? null : (input.caller?.id ?? null);

  const labels = {
    ...input.childAgentDefaultLabels,
    ...input.labels,
    ...(parentAgentId ? { [PARENT_AGENT_ID_LABEL]: parentAgentId } : {}),
  };

  // COMPAT(detachedCreate): legacy callers may still request detached creation.
  // Added in v0.2.0; remove after 2027-01-17 once detached creation is outside the floor.
  // The delete also strips a parent label injected through input.labels.
  if (input.legacyDetached) {
    delete labels[PARENT_AGENT_ID_LABEL];
  }

  return { cwd: input.cwd, parentAgentId, labels };
}
