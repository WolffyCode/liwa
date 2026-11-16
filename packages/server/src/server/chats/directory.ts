import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const CHATS_DIRECTORY_NAME = "chats";
// Chat directories hold whatever the agent writes during a conversation; keep them owner-only.
const CHAT_DIRECTORY_MODE = 0o700;

export interface ChatDirectory {
  /** `$PASEO_HOME/chats`: the root of the private project that backs every chat on this host. */
  rootPath: string;
  /** The chat's own working directory, named by its workspace id. */
  cwd: string;
}

/**
 * The directory could not be created, so nothing was registered. Creation treats this as a
 * rejection before provisioning, which lets the same operation be retried.
 */
export class ChatDirectoryUnavailableError extends Error {
  readonly code = "chat_directory_unavailable";
  constructor(
    readonly cwd: string,
    cause: unknown,
  ) {
    super(`Chat directory unavailable: ${cwd}`, { cause });
    this.name = "ChatDirectoryUnavailableError";
  }
}

export async function allocateChatDirectory(input: {
  paseoHome: string;
  workspaceId: string;
}): Promise<ChatDirectory> {
  const rootPath = resolve(input.paseoHome, CHATS_DIRECTORY_NAME);
  const cwd = resolve(rootPath, input.workspaceId);
  try {
    await mkdir(cwd, { recursive: true, mode: CHAT_DIRECTORY_MODE });
  } catch (error) {
    throw new ChatDirectoryUnavailableError(cwd, error);
  }
  return { rootPath, cwd };
}
