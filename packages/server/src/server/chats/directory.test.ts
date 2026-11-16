import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { allocateChatDirectory, ChatDirectoryUnavailableError } from "./directory.js";

const roots: string[] = [];

function createPaseoHome(): string {
  const root = mkdtempSync(path.join(tmpdir(), "chat-directory-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("allocateChatDirectory", () => {
  test("creates an owner-only directory per chat under the host's chats root", async () => {
    const paseoHome = createPaseoHome();

    const first = await allocateChatDirectory({ paseoHome, workspaceId: "wks_0000000000000001" });
    const second = await allocateChatDirectory({ paseoHome, workspaceId: "wks_0000000000000002" });

    expect(first).toEqual({
      rootPath: path.join(paseoHome, "chats"),
      cwd: path.join(paseoHome, "chats", "wks_0000000000000001"),
    });
    expect(second.rootPath).toBe(first.rootPath);
    expect(second.cwd).not.toBe(first.cwd);
    expect(statSync(first.cwd).isDirectory()).toBe(true);
    expect(statSync(first.cwd).mode & 0o777).toBe(0o700);
  });

  test("reports a typed rejection when the directory cannot be created", async () => {
    const paseoHome = createPaseoHome();
    writeFileSync(path.join(paseoHome, "chats"), "not a directory");

    const allocation = allocateChatDirectory({ paseoHome, workspaceId: "wks_0000000000000001" });

    await expect(allocation).rejects.toBeInstanceOf(ChatDirectoryUnavailableError);
    await expect(allocation).rejects.toMatchObject({
      code: "chat_directory_unavailable",
      cwd: path.join(paseoHome, "chats", "wks_0000000000000001"),
    });
  });
});
