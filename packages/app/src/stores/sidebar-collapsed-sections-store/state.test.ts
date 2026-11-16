import { describe, expect, it } from "vitest";
import {
  type CollapsedProjectsState,
  mergePersistedCollapsedProjects,
  serializeCollapsedProjects,
  setProjectCollapsed,
  toggleChatsCollapsed,
  togglePinnedCollapsed,
  toggleProjectCollapsed,
  toggleProjectsSectionCollapsed,
  toggleWorkspaceGroupCollapsed,
} from "@/stores/sidebar-collapsed-sections-store/state";

function emptyState(): CollapsedProjectsState {
  return {
    collapsedProjectKeys: new Set(),
    collapsedWorkspaceGroupKeys: new Set(),
    collapsedPinned: false,
    collapsedProjects: false,
    collapsedChats: false,
  };
}

describe("sidebar collapsed projects transitions", () => {
  it("tracks collapsed project keys as a Set", () => {
    let state = emptyState();

    state = setProjectCollapsed(state, "project-a", true);
    state = toggleProjectCollapsed(state, "project-b");
    state = toggleProjectCollapsed(state, "project-a");
    state = toggleWorkspaceGroupCollapsed(state, "running");

    expect(Array.from(state.collapsedProjectKeys)).toEqual(["project-b"]);
    expect(Array.from(state.collapsedWorkspaceGroupKeys)).toEqual(["running"]);
  });

  it("serializes collapsed project keys for preference storage", () => {
    const state: CollapsedProjectsState = {
      collapsedProjectKeys: new Set(["project-a", "project-b"]),
      collapsedWorkspaceGroupKeys: new Set(["running"]),
      collapsedPinned: true,
      collapsedProjects: true,
      collapsedChats: true,
    };

    expect(serializeCollapsedProjects(state)).toEqual({
      collapsedProjectKeys: ["project-a", "project-b"],
      collapsedWorkspaceGroupKeys: ["running"],
      collapsedPinned: true,
      collapsedProjects: true,
      collapsedChats: true,
    });
    expect(
      mergePersistedCollapsedProjects(serializeCollapsedProjects(state), emptyState()),
    ).toEqual(state);
  });

  it("collapses Projects and Conversations independently and keeps each project's own state", () => {
    let state = setProjectCollapsed(emptyState(), "project-a", true);
    state = toggleProjectsSectionCollapsed(state);
    expect(state).toMatchObject({ collapsedProjects: true, collapsedChats: false });
    state = toggleChatsCollapsed(state);
    state = toggleProjectsSectionCollapsed(state);
    expect(state).toMatchObject({ collapsedProjects: false, collapsedChats: true });
    expect(Array.from(state.collapsedProjectKeys)).toEqual(["project-a"]);
  });

  it("toggles and restores the pinned section collapse flag", () => {
    const toggled = togglePinnedCollapsed(emptyState());
    expect(toggled.collapsedPinned).toBe(true);

    const restored = mergePersistedCollapsedProjects({ collapsedPinned: true }, emptyState());
    expect(restored.collapsedPinned).toBe(true);
    expect(restored.collapsedProjects).toBe(false);
    expect(restored.collapsedChats).toBe(false);
  });

  it("rejects the complete value when a persisted project key is invalid", () => {
    const restored = mergePersistedCollapsedProjects(
      { collapsedProjectKeys: ["project-a", "project-b", 42] },
      emptyState(),
    );

    expect(Array.from(restored.collapsedProjectKeys)).toEqual([]);
    expect(Array.from(restored.collapsedWorkspaceGroupKeys)).toEqual([]);
  });

  it("keeps the existing state object when persisted preferences do not change collapsed keys", () => {
    const currentState = emptyState();

    expect(mergePersistedCollapsedProjects(undefined, currentState)).toBe(currentState);
    expect(mergePersistedCollapsedProjects({}, currentState)).toBe(currentState);
    expect(mergePersistedCollapsedProjects({ collapsedProjectKeys: [] }, currentState)).toBe(
      currentState,
    );
  });
});
