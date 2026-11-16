import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";

export type CloseAgentTabPolicy = { kind: "archive-on-close" } | { kind: "layout-only" };

export function resolveCloseAgentTabPolicy(input: {
  agent: Pick<Agent, "parentAgentId"> | null | undefined;
  workspace: Pick<WorkspaceDescriptor, "purpose"> | null | undefined;
}): CloseAgentTabPolicy {
  // A chat ends only when it is archived, so its tabs are views of it.
  if (input.workspace?.purpose === "chat" || input.agent?.parentAgentId) {
    return { kind: "layout-only" };
  }

  return { kind: "archive-on-close" };
}
