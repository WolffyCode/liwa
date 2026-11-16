/**
 * The daemon reads a chat agent's cwd relative to the chat's private directory, which it
 * allocates; "." is that directory.
 */
export const CHAT_AGENT_CWD = ".";

export type IndependentChatBlocker = "host-disconnected" | "update-host" | "enter-message";

/**
 * Why a New conversation without a workspace directory cannot be sent, or null when it can. A
 * chosen directory keeps the ordinary workspace rules, including empty workspaces. A
 * disconnected host reports no features, so it is not mistaken for one that needs an update.
 */
export function resolveIndependentChatBlocker(input: {
  hasDirectory: boolean;
  connected: boolean;
  supportsIndependentChats: boolean;
  isEmptySubmission: boolean;
}): IndependentChatBlocker | null {
  if (input.hasDirectory) return null;
  if (!input.connected) return "host-disconnected";
  if (!input.supportsIndependentChats) return "update-host";
  if (input.isEmptySubmission) return "enter-message";
  return null;
}
