import type { Href } from "expo-router";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { buildHostRootRoute, buildNewWorkspaceRoute } from "@/utils/host-routes";
import { resolveWorkspaceRouteId } from "@/utils/workspace-identity";

export function buildWorkspaceArchiveRedirectRoute(input: {
  serverId: string;
  archivedWorkspaceId: string;
  workspaces: Iterable<WorkspaceDescriptor>;
}): Href {
  const archivedWorkspaceId = resolveWorkspaceRouteId({
    routeWorkspaceId: input.archivedWorkspaceId,
  });
  if (!archivedWorkspaceId) {
    return buildHostRootRoute(input.serverId);
  }

  const archivedWorkspace =
    Array.from(input.workspaces).find((workspace) => workspace.id === archivedWorkspaceId) ?? null;
  // A chat's backing directory is private, so archiving one returns to a New conversation
  // without a directory rather than to its backing project.
  if (archivedWorkspace?.purpose === "chat") {
    return buildNewWorkspaceRoute({ serverId: input.serverId });
  }
  const sourceDirectory =
    archivedWorkspace?.projectRootPath || archivedWorkspace?.workspaceDirectory;
  if (!sourceDirectory) {
    return buildHostRootRoute(input.serverId);
  }

  return buildNewWorkspaceRoute({
    serverId: input.serverId,
    sourceDirectory,
    displayName: archivedWorkspace.projectDisplayName,
    projectId: archivedWorkspace.projectId,
  });
}
