import { existsSync } from "node:fs";
import { realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import {
  closeWorkspaceAgentTab,
  expectSessionRowArchived,
  openSessions,
} from "../support/helpers/archive-tab";
import {
  expectNewWorkspaceDraft,
  fillNewWorkspaceDraft,
  openGlobalNewWorkspaceComposer,
  submitNewWorkspacePrompt,
} from "../support/helpers/new-workspace";
import type { SeedDaemonClient, SeedWorkspaceDescriptor } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import {
  archiveWorkspaceFromSidebar,
  expectWorkspaceAbsentFromSidebar,
  pinWorkspaceFromSidebar,
} from "../support/helpers/sidebar";

// Independent chats: New conversation without a workspace directory. The daemon backs each chat
// with a private directory under $PASEO_HOME/chats; the sidebar lists it under Conversations and
// never shows the backing project among Projects.

const NO_DIRECTORY_LABEL = "Workspace directory (optional)";

function requireWorkerHome(): string {
  const home = process.env.E2E_PASEO_HOME;
  if (!home) throw new Error("E2E_PASEO_HOME is required to locate the chat directories");
  return home;
}

async function listChats(client: SeedDaemonClient): Promise<SeedWorkspaceDescriptor[]> {
  const workspaces = await client.fetchWorkspaces();
  return workspaces.entries.filter((workspace) => workspace.purpose === "chat");
}

async function waitForSingleChat(client: SeedDaemonClient): Promise<SeedWorkspaceDescriptor> {
  await expect.poll(async () => (await listChats(client)).length, { timeout: 30_000 }).toBe(1);
  const [chat] = await listChats(client);
  return chat!;
}

async function expectNewConversationWithoutDirectory(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/new(?:\?.*)?$/, { timeout: 30_000 });
  await expect(page.getByTestId("new-workspace-project-picker-trigger")).toContainText(
    NO_DIRECTORY_LABEL,
    { timeout: 30_000 },
  );
  const url = new URL(page.url());
  expect(url.searchParams.has("dir")).toBe(false);
  expect(url.searchParams.has("projectId")).toBe(false);
}

// On a desktop-width sidebar Rename edits the title in place; Enter saves it.
async function renameChatFromSidebar(page: Page, chatKey: string, title: string): Promise<void> {
  await page.getByTestId(`sidebar-workspace-row-${chatKey}`).hover();
  await page.getByTestId(`sidebar-workspace-kebab-${chatKey}`).click();
  await page.getByTestId(`sidebar-workspace-menu-rename-${chatKey}`).click();
  const input = page.getByTestId(`sidebar-workspace-rename-input-${chatKey}`);
  await expect(input).toBeFocused();
  // The whole title is selected, so typing replaces it.
  await page.keyboard.type(title);
  await page.keyboard.press("Enter");
  await expect(input).toHaveCount(0, { timeout: 15_000 });
}

test("a conversation without a directory lives under Conversations until it is archived into History", async ({
  page,
  e2eWorkerClient,
}) => {
  test.setTimeout(180_000);
  const message = "Independent chat about system design";
  await gotoAppShell(page);

  const pinnedSection = page.getByTestId("sidebar-pinned-section");
  const projectsHeader = page.getByTestId("sidebar-projects-section-header");
  const chatsSection = page.getByTestId("sidebar-chats-section");
  const chatsHeader = page.getByTestId("sidebar-chats-section-header");
  // The worker daemon starts without projects, so the sections, not a project row, mark hydration.
  await expect(chatsSection).toBeVisible({ timeout: 60_000 });
  await expect(pinnedSection).toBeVisible();
  await expect(projectsHeader).toHaveText(/Projects/);
  await expect(chatsSection).toContainText("Conversations");
  const pinnedBox = await pinnedSection.boundingBox();
  const projectsBox = await projectsHeader.boundingBox();
  const chatsBox = await chatsSection.boundingBox();
  expect(pinnedBox!.y).toBeLessThan(projectsBox!.y);
  expect(projectsBox!.y).toBeLessThan(chatsBox!.y);

  await openGlobalNewWorkspaceComposer(page);
  await expectNewConversationWithoutDirectory(page);
  await submitNewWorkspacePrompt(page, message);
  await expect(page).toHaveURL(/\/workspace\//, { timeout: 60_000 });

  const chat = await waitForSingleChat(e2eWorkerClient);
  const chatKey = `${getServerId()}:${chat.id}`;
  const chatRow = page.getByTestId(`sidebar-workspace-row-${chatKey}`);
  try {
    expect(chat.workspaceKind).toBe("directory");
    // Temp homes reach the daemon through symlinked prefixes (/var -> /private/var on macOS).
    expect(await realpath(path.dirname(chat.workspaceDirectory))).toBe(
      await realpath(path.join(requireWorkerHome(), "chats")),
    );
    const chatAgents = (await e2eWorkerClient.fetchAgents()).entries.filter(
      (entry) => entry.agent.workspaceId === chat.id,
    );
    expect(chatAgents.map((entry) => entry.agent.cwd)).toEqual([chat.workspaceDirectory]);
    const agentId = chatAgents[0]!.agent.id;

    await expect(
      page.getByTestId("sidebar-chats-list").getByTestId(`sidebar-workspace-row-${chatKey}`),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page
        .locator('[data-testid^="sidebar-project-row-"]')
        .filter({ hasText: chat.projectDisplayName }),
    ).toHaveCount(0);

    // Closing the agent tab only changes the layout; the conversation and its agent stay.
    // The close button only takes pointer events once its tab is hovered.
    await page
      .getByTestId(`workspace-tab-agent_${agentId}`)
      .filter({ visible: true })
      .first()
      .hover();
    await closeWorkspaceAgentTab(page, agentId);
    const afterClose = (await e2eWorkerClient.fetchAgents()).entries.find(
      (entry) => entry.agent.id === agentId,
    );
    expect(afterClose?.agent.archivedAt ?? null).toBeNull();
    await expect(chatRow).toBeVisible();

    // Each section collapses on its own and stays collapsed after a reload.
    await chatsHeader.click();
    await expect(chatRow).toHaveCount(0);
    await page.reload();
    await expect(chatsHeader).toHaveAttribute("aria-expanded", "false", { timeout: 60_000 });
    await expect(projectsHeader).toHaveAttribute("aria-expanded", "true");
    await expect(chatRow).toHaveCount(0);
    await chatsHeader.click();
    await expect(chatRow).toBeVisible({ timeout: 30_000 });

    // A pinned chat moves to Pinned and appears once.
    await pinWorkspaceFromSidebar(page, chat.id);
    await expect(pinnedSection.getByTestId(`sidebar-workspace-row-${chatKey}`)).toBeVisible({
      timeout: 30_000,
    });
    await expect(chatsSection.getByTestId(`sidebar-workspace-row-${chatKey}`)).toHaveCount(0);
    await pinWorkspaceFromSidebar(page, chat.id);
    await expect(chatsSection.getByTestId(`sidebar-workspace-row-${chatKey}`)).toBeVisible({
      timeout: 30_000,
    });

    await renameChatFromSidebar(page, chatKey, "Design conversation");
    await expect(chatRow).toContainText("Design conversation", { timeout: 30_000 });

    await chatRow.click();
    await expect(page).toHaveURL(/\/workspace\//, { timeout: 30_000 });
    await archiveWorkspaceFromSidebar(page, chat.id);
    await expectWorkspaceAbsentFromSidebar(page, chat.id);
    await expectNewConversationWithoutDirectory(page);
    expect(await listChats(e2eWorkerClient)).toEqual([]);

    const archivedAgent = (
      await e2eWorkerClient.fetchAgents({ filter: { includeArchived: true } })
    ).entries.find((entry) => entry.agent.id === agentId);
    expect(archivedAgent?.agent.archivedAt).toBeTruthy();
    await openSessions(page);
    await expectSessionRowArchived(page, archivedAgent?.agent.title ?? "New session");
  } finally {
    await e2eWorkerClient.archiveWorkspace(chat.id);
  }
});

test("a chat directory that cannot be allocated keeps the draft and the retry creates the chat", async ({
  page,
  e2eWorkerClient,
}) => {
  test.setTimeout(180_000);
  const home = requireWorkerHome();
  const chatsDirectory = path.join(home, "chats");
  const savedDirectory = path.join(home, "chats-before-allocation-failure");
  const hadChatsDirectory = existsSync(chatsDirectory);
  if (hadChatsDirectory) await rename(chatsDirectory, savedDirectory);
  // A file where the chats directory belongs makes the daemon's mkdir fail before registration.
  await writeFile(chatsDirectory, "blocks chat directory allocation");
  let isAllocationBlocked = true;
  const draft = "Keep this draft after a failed create";
  try {
    await gotoAppShell(page);
    await openGlobalNewWorkspaceComposer(page);
    await expectNewConversationWithoutDirectory(page);
    await fillNewWorkspaceDraft(page, draft);
    await page.getByTestId("message-input-root").getByRole("button", { name: "Create" }).click();
    await expect(page.getByTestId("new-workspace-error")).toBeVisible({ timeout: 30_000 });
    await expectNewWorkspaceDraft(page, draft);
    expect(await listChats(e2eWorkerClient)).toEqual([]);

    await rm(chatsDirectory);
    if (hadChatsDirectory) await rename(savedDirectory, chatsDirectory);
    isAllocationBlocked = false;
    await page.getByTestId("message-input-root").getByRole("button", { name: "Create" }).click();
    await expect(page).toHaveURL(/\/workspace\//, { timeout: 60_000 });
    const chat = await waitForSingleChat(e2eWorkerClient);
    await e2eWorkerClient.archiveWorkspace(chat.id);
  } finally {
    if (isAllocationBlocked) {
      await rm(chatsDirectory, { force: true });
      if (hadChatsDirectory) await rename(savedDirectory, chatsDirectory);
    }
  }
});
