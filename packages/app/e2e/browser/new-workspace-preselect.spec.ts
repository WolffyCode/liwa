import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { getE2EDaemonPort } from "../support/helpers/daemon-port";
import { openGlobalNewWorkspaceComposer } from "../support/helpers/new-workspace";
import { seedWorkspace, type SeededWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { seedSavedSettingsHosts } from "../support/helpers/settings";
import { LAST_WORKSPACE_SELECTION_STORAGE_KEY } from "@/stores/last-workspace-selection";
import { buildHostWorkspaceRoute, buildNewWorkspaceRoute } from "@/utils/host-routes";
import {
  switchWorkspaceViaSidebar,
  waitForSidebarHydration,
} from "../support/helpers/workspace-ui";

const OFFLINE_SERVER_IDS = [
  "srv_e2e_preselect_offline_1",
  "srv_e2e_preselect_offline_2",
  "srv_e2e_preselect_offline_3",
];

// Global New conversation keeps the host decision of the form context but never carries a
// directory: leaving it empty creates an independent chat. A plain /new must not let a stale
// remembered offline host steal the initial host when there is exactly one online saved host.

async function pressNewWorkspaceShortcut(page: import("@playwright/test").Page): Promise<void> {
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${modifier}+n`);
  await expect(page).toHaveURL(/\/new(?:\?.*)?$/, { timeout: 30_000 });
}

async function expectNoDirectoryWithin(
  page: import("@playwright/test").Page,
  timeout = 30_000,
): Promise<void> {
  await expect(page.getByRole("button", { name: "Workspace directory" })).toContainText(
    "Workspace directory (optional)",
    { timeout },
  );
  const url = new URL(page.url());
  expect(url.searchParams.has("dir")).toBe(false);
  expect(url.searchParams.has("projectId")).toBe(false);
}

async function openColdRestoredWorkspaceWithOfflineHostFirst(
  page: import("@playwright/test").Page,
  workspace: SeededWorkspace,
): Promise<void> {
  const connectedServerId = getServerId();
  await seedSavedSettingsHosts(page, [
    ...OFFLINE_SERVER_IDS.map((serverId, index) => ({
      serverId,
      label: `Offline host ${index + 1}`,
      endpoint: `127.0.0.1:${index + 1}`,
    })),
    {
      serverId: connectedServerId,
      label: "Connected host",
      endpoint: `127.0.0.1:${getE2EDaemonPort()}`,
    },
  ]);
  await page.evaluate(
    ({ storageKey, serverId, workspaceId }) => {
      localStorage.setItem(storageKey, JSON.stringify({ serverId, workspaceId }));
    },
    {
      storageKey: LAST_WORKSPACE_SELECTION_STORAGE_KEY,
      serverId: connectedServerId,
      workspaceId: workspace.workspaceId,
    },
  );

  await page.goto("/");
  await expect(page).toHaveURL(buildHostWorkspaceRoute(connectedServerId, workspace.workspaceId), {
    timeout: 60_000,
  });
  await waitForSidebarHydration(page);
}

async function openNewWorkspaceWithStaleOfflineSelection(
  page: import("@playwright/test").Page,
): Promise<void> {
  const connectedServerId = getServerId();
  await seedSavedSettingsHosts(page, [
    ...OFFLINE_SERVER_IDS.map((serverId, index) => ({
      serverId,
      label: `Offline host ${index + 1}`,
      endpoint: `127.0.0.1:${index + 1}`,
    })),
    {
      serverId: connectedServerId,
      label: "Connected host",
      endpoint: `127.0.0.1:${getE2EDaemonPort()}`,
    },
  ]);
  await page.evaluate(
    ({ storageKey, serverId }) => {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ serverId, workspaceId: "wks_stale_offline" }),
      );
    },
    {
      storageKey: LAST_WORKSPACE_SELECTION_STORAGE_KEY,
      serverId: OFFLINE_SERVER_IDS[0]!,
    },
  );

  await page.goto(buildNewWorkspaceRoute());
  await expect(page.getByTestId("host-picker-trigger")).toBeVisible({ timeout: 60_000 });
}

async function seedOfflineHostsWithStaleSelection(
  page: import("@playwright/test").Page,
): Promise<void> {
  const connectedServerId = getServerId();
  await seedSavedSettingsHosts(page, [
    ...OFFLINE_SERVER_IDS.map((serverId, index) => ({
      serverId,
      label: `Offline host ${index + 1}`,
      endpoint: `127.0.0.1:${index + 1}`,
    })),
    {
      serverId: connectedServerId,
      label: "Connected host",
      endpoint: `127.0.0.1:${getE2EDaemonPort()}`,
    },
  ]);
  await page.evaluate(
    ({ storageKey, serverId }) => {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ serverId, workspaceId: "wks_stale_offline" }),
      );
    },
    {
      storageKey: LAST_WORKSPACE_SELECTION_STORAGE_KEY,
      serverId: OFFLINE_SERVER_IDS[0]!,
    },
  );
}

test.describe("New conversation keeps its host without selecting a directory", () => {
  test.describe.configure({ timeout: 240_000 });

  let projectA: SeededWorkspace;
  let projectB: SeededWorkspace;

  test.beforeEach(async () => {
    projectA = await seedWorkspace({ repoPrefix: "preselect-a-" });
    projectB = await seedWorkspace({ repoPrefix: "preselect-b-" });
  });

  test.afterEach(async () => {
    await projectA?.cleanup();
    await projectB?.cleanup();
  });

  test("Cmd+N opens a conversation with no directory from either project", async ({ page }) => {
    await gotoAppShell(page);
    await waitForSidebarHydration(page);

    await switchWorkspaceViaSidebar({
      page,
      serverId: getServerId(),
      workspaceId: projectB.workspaceId,
    });
    await pressNewWorkspaceShortcut(page);
    await expectNoDirectoryWithin(page);

    await switchWorkspaceViaSidebar({
      page,
      serverId: getServerId(),
      workspaceId: projectA.workspaceId,
    });
    await pressNewWorkspaceShortcut(page);
    await expectNoDirectoryWithin(page);
  });

  test("New conversation opens with no directory from either project", async ({ page }) => {
    await gotoAppShell(page);
    await waitForSidebarHydration(page);

    await switchWorkspaceViaSidebar({
      page,
      serverId: getServerId(),
      workspaceId: projectB.workspaceId,
    });
    await openGlobalNewWorkspaceComposer(page);
    await expectNoDirectoryWithin(page);

    await switchWorkspaceViaSidebar({
      page,
      serverId: getServerId(),
      workspaceId: projectA.workspaceId,
    });
    await openGlobalNewWorkspaceComposer(page);
    await expectNoDirectoryWithin(page);
  });

  test("Cmd+N keeps the connected host and leaves the directory empty", async ({ page }) => {
    await openColdRestoredWorkspaceWithOfflineHostFirst(page, projectB);

    await pressNewWorkspaceShortcut(page);

    await expect(page.getByTestId("host-picker-trigger")).toContainText("Connected host", {
      timeout: 8_000,
    });
    await expectNoDirectoryWithin(page, 8_000);
  });

  test("New conversation keeps the connected host and leaves the directory empty", async ({
    page,
  }) => {
    await openColdRestoredWorkspaceWithOfflineHostFirst(page, projectB);

    await openGlobalNewWorkspaceComposer(page);

    await expect(page.getByTestId("host-picker-trigger")).toContainText("Connected host", {
      timeout: 8_000,
    });
    await expectNoDirectoryWithin(page, 8_000);
  });

  test("plain /new ignores stale remembered offline hosts when only one saved host is connected", async ({
    page,
  }) => {
    await openNewWorkspaceWithStaleOfflineSelection(page);

    await expect(page.getByTestId("host-picker-trigger")).toContainText("Connected host", {
      timeout: 8_000,
    });
    await expectNoDirectoryWithin(page, 8_000);
  });

  test("stale remembered offline host heals after visiting the connected workspace", async ({
    page,
  }) => {
    const connectedServerId = getServerId();
    await seedOfflineHostsWithStaleSelection(page);

    await page.goto(buildHostWorkspaceRoute(connectedServerId, projectB.workspaceId));
    await expect(page).toHaveURL(buildHostWorkspaceRoute(connectedServerId, projectB.workspaceId), {
      timeout: 60_000,
    });
    await waitForSidebarHydration(page);

    await openGlobalNewWorkspaceComposer(page);

    await expect(page.getByTestId("host-picker-trigger")).toContainText("Connected host", {
      timeout: 8_000,
    });
    await expectNoDirectoryWithin(page, 8_000);
  });
});
