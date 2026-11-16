// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { HostProjectListItem } from "@/projects/host-projects";
import { NO_PROJECT_OPTION_ID, useNewWorkspaceProjectPicker } from "./project-picker";

function project(input: {
  viewKey: string;
  projectKey: string | null;
  projectId: string;
  projectName: string;
}): HostProjectListItem {
  return {
    ...input,
    projectKind: "git",
    iconWorkingDir: `/work/${input.projectId}`,
    hosts: [
      {
        serverId: "host",
        projectId: input.projectId,
        iconWorkingDir: `/work/${input.projectId}`,
        worktreeSupport: "supported",
      },
    ],
    workspaceKeys: [],
  };
}

describe("useNewWorkspaceProjectPicker", () => {
  it("preserves a manual choice when the routed project hydrates", () => {
    const routePlacement = project({
      viewKey: '["host","route-local"]',
      projectKey: null,
      projectId: "route-local",
      projectName: "Route project",
    });
    const hydratedRouteProject = project({
      viewKey: "remote:github.com/acme/route",
      projectKey: "remote:github.com/acme/route",
      projectId: "route-local",
      projectName: "Route project",
    });
    const manualProject = project({
      viewKey: "remote:github.com/acme/manual",
      projectKey: "remote:github.com/acme/manual",
      projectId: "manual-local",
      projectName: "Manual project",
    });
    const { result, rerender } = renderHook(
      ({ routeProject, projects }) =>
        useNewWorkspaceProjectPicker({
          selectedServerId: "host",
          projects,
          routeProject,
          routeProjectContextViewKey: routePlacement.viewKey,
          allowAllProjects: true,
        }),
      {
        initialProps: {
          routeProject: routePlacement,
          projects: [routePlacement, manualProject],
        },
      },
    );

    const manualOption = result.current.projectPickerOptions.find(
      (option) => option.label === manualProject.projectName,
    );
    expect(manualOption).toBeDefined();
    act(() => result.current.handleSelectProjectOption(manualOption!.id));
    expect(result.current.selectedProject).toEqual(manualProject);

    rerender({
      routeProject: hydratedRouteProject,
      projects: [hydratedRouteProject, manualProject],
    });

    expect(result.current.selectedProject).toEqual(manualProject);
  });

  it("offers no directory first and keeps that choice when a routed project hydrates", () => {
    const routed = project({
      viewKey: "remote:github.com/acme/route",
      projectKey: "remote:github.com/acme/route",
      projectId: "route-local",
      projectName: "Route project",
    });
    const { result, rerender } = renderHook(
      ({ projects }) =>
        useNewWorkspaceProjectPicker({
          selectedServerId: "host",
          projects,
          routeProject: routed,
          routeProjectContextViewKey: routed.viewKey,
          allowAllProjects: true,
        }),
      { initialProps: { projects: [routed] } },
    );

    expect(result.current.selectedProject).toEqual(routed);
    expect(result.current.projectPickerOptions[0]?.id).toBe(NO_PROJECT_OPTION_ID);
    act(() => result.current.handleSelectProjectOption(NO_PROJECT_OPTION_ID));
    expect(result.current.selectedProject).toBeNull();
    expect(result.current.selectedProjectOptionId).toBe(NO_PROJECT_OPTION_ID);

    rerender({ projects: [routed, { ...routed, viewKey: "other", projectName: "Other" }] });
    expect(result.current.selectedProject).toBeNull();
  });

  it("starts a global entry without a directory even when projects exist", () => {
    const listed = project({
      viewKey: "remote:github.com/acme/listed",
      projectKey: "remote:github.com/acme/listed",
      projectId: "listed-local",
      projectName: "Listed project",
    });
    const { result } = renderHook(
      ({ projects }) =>
        useNewWorkspaceProjectPicker({
          selectedServerId: "host",
          projects,
          routeProject: null,
          routeProjectContextViewKey: null,
          allowAllProjects: true,
        }),
      { initialProps: { projects: [listed] } },
    );

    expect(result.current.selectedProject).toBeNull();
    expect(result.current.selectedSourceDirectory).toBeNull();
    act(() => result.current.selectProject(listed));
    expect(result.current.selectedProject).toEqual(listed);
  });
});
