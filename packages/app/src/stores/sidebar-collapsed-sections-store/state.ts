import { z } from "zod";

export interface CollapsedProjectsState {
  collapsedProjectKeys: Set<string>;
  collapsedWorkspaceGroupKeys: Set<string>;
  collapsedPinned: boolean;
  /** The whole Projects section, independent of each project's own collapse. */
  collapsedProjects: boolean;
  collapsedChats: boolean;
}

export const PersistedCollapsedProjectsSchema = z.strictObject({
  collapsedProjectKeys: z.array(z.string()).optional(),
  collapsedWorkspaceGroupKeys: z.array(z.string()).optional(),
  // COMPAT(sidebarWorkspaceGroupCollapse): added in v0.4.0, remove after 2027-02-14.
  collapsedStatusGroupKeys: z.array(z.string()).optional(),
  collapsedPinned: z.boolean().optional(),
  collapsedProjects: z.boolean().optional(),
  collapsedChats: z.boolean().optional(),
});

export type PersistedCollapsedProjects = z.infer<typeof PersistedCollapsedProjectsSchema>;

export function togglePinnedCollapsed(state: CollapsedProjectsState): CollapsedProjectsState {
  return { ...state, collapsedPinned: !state.collapsedPinned };
}

export function toggleProjectsSectionCollapsed(
  state: CollapsedProjectsState,
): CollapsedProjectsState {
  return { ...state, collapsedProjects: !state.collapsedProjects };
}

export function toggleChatsCollapsed(state: CollapsedProjectsState): CollapsedProjectsState {
  return { ...state, collapsedChats: !state.collapsedChats };
}

export function toggleProjectCollapsed(
  state: CollapsedProjectsState,
  projectKey: string,
): CollapsedProjectsState {
  const next = new Set(state.collapsedProjectKeys);
  if (next.has(projectKey)) {
    next.delete(projectKey);
  } else {
    next.add(projectKey);
  }
  return { ...state, collapsedProjectKeys: next };
}

export function toggleWorkspaceGroupCollapsed(
  state: CollapsedProjectsState,
  workspaceGroupKey: string,
): CollapsedProjectsState {
  const next = new Set(state.collapsedWorkspaceGroupKeys);
  if (next.has(workspaceGroupKey)) {
    next.delete(workspaceGroupKey);
  } else {
    next.add(workspaceGroupKey);
  }
  return { ...state, collapsedWorkspaceGroupKeys: next };
}

export function setProjectCollapsed(
  state: CollapsedProjectsState,
  projectKey: string,
  collapsed: boolean,
): CollapsedProjectsState {
  const next = new Set(state.collapsedProjectKeys);
  if (collapsed) {
    next.add(projectKey);
  } else {
    next.delete(projectKey);
  }
  return { ...state, collapsedProjectKeys: next };
}

export function serializeCollapsedProjects(
  state: CollapsedProjectsState,
): Required<Omit<PersistedCollapsedProjects, "collapsedStatusGroupKeys">> {
  return {
    collapsedProjectKeys: Array.from(state.collapsedProjectKeys),
    collapsedWorkspaceGroupKeys: Array.from(state.collapsedWorkspaceGroupKeys),
    collapsedPinned: state.collapsedPinned,
    collapsedProjects: state.collapsedProjects,
    collapsedChats: state.collapsedChats,
  };
}

export function mergePersistedCollapsedProjects<S extends CollapsedProjectsState>(
  persistedValue: unknown,
  current: S,
): S {
  const result = PersistedCollapsedProjectsSchema.safeParse(persistedValue);
  if (!result.success) {
    return current;
  }
  const persisted = result.data;
  const restoredProjects = deserializeCollapsedKeys(
    persisted.collapsedProjectKeys ?? Array.from(current.collapsedProjectKeys),
  );
  const restoredWorkspaceGroups = deserializeCollapsedKeys(
    persisted.collapsedWorkspaceGroupKeys ??
      persisted.collapsedStatusGroupKeys ??
      Array.from(current.collapsedWorkspaceGroupKeys),
  );
  const restoredPinned = persisted.collapsedPinned ?? current.collapsedPinned;
  const restoredProjectsSection = persisted.collapsedProjects ?? current.collapsedProjects;
  const restoredChats = persisted.collapsedChats ?? current.collapsedChats;
  if (
    areSetsEqual(current.collapsedProjectKeys, restoredProjects) &&
    areSetsEqual(current.collapsedWorkspaceGroupKeys, restoredWorkspaceGroups) &&
    current.collapsedPinned === restoredPinned &&
    current.collapsedProjects === restoredProjectsSection &&
    current.collapsedChats === restoredChats
  ) {
    return current;
  }
  return {
    ...current,
    collapsedProjectKeys: restoredProjects,
    collapsedWorkspaceGroupKeys: restoredWorkspaceGroups,
    collapsedPinned: restoredPinned,
    collapsedProjects: restoredProjectsSection,
    collapsedChats: restoredChats,
  };
}

function deserializeCollapsedKeys(value: string[]): Set<string> {
  return new Set(value);
}

function areSetsEqual(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const key of left) {
    if (!right.has(key)) {
      return false;
    }
  }
  return true;
}
