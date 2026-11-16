import { useCallback } from "react";
import { router } from "expo-router";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionId } from "@/keyboard/keyboard-action-dispatcher";
import { useHosts } from "@/runtime/host-runtime";
import {
  useActiveWorkspaceSelection,
  useLastWorkspaceSelection,
} from "@/stores/navigation-active-workspace-store";
import { generateDraftId } from "@/stores/draft-keys";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";

const NEW_CHAT_ACTIONS: readonly KeyboardActionId[] = ["workspace.new"];

/**
 * Opens a fresh New conversation draft on the host the user is working on. It carries no
 * directory: the user picks one for a project conversation or sends without one for a chat.
 * Returns false when there is no host to create on.
 */
export function useOpenNewChat(): () => boolean {
  const hosts = useHosts();
  const activeSelection = useActiveWorkspaceSelection();
  const lastSelection = useLastWorkspaceSelection();
  const preferredServerId = activeSelection?.serverId ?? lastSelection?.serverId;
  const serverId = hosts.find((host) => host.serverId === preferredServerId)?.serverId;
  const hasHosts = hosts.length > 0;
  return useCallback(() => {
    if (!hasHosts) return false;
    router.navigate(buildNewWorkspaceRoute({ serverId, draftId: generateDraftId() }));
    return true;
  }, [hasHosts, serverId]);
}

/** The app-wide New conversation shortcut. Screens that own a draft register a higher priority. */
export function useGlobalNewChatAction(): void {
  const openNewChat = useOpenNewChat();
  const hosts = useHosts();
  useKeyboardActionHandler({
    handlerId: "chat-new-global",
    actions: NEW_CHAT_ACTIONS,
    enabled: hosts.length > 0,
    priority: 0,
    handle: openNewChat,
  });
}
