import { useTranslation } from "react-i18next";
import { useHostFeature } from "@/runtime/host-features";
import { resolveIndependentChatBlocker } from "./submission";

/**
 * The notice New conversation shows before anything is sent when the chosen host is too old to
 * create a conversation without a workspace directory, or null when nothing needs updating.
 */
export function useIndependentChatUpdateHostNotice(input: {
  serverId: string;
  hasDirectory: boolean;
  connected: boolean;
}): string | null {
  const { t } = useTranslation();
  // COMPAT(independentChats): added after v0.16.0-beta.2, remove gate after 2027-05-15.
  const supportsIndependentChats = useHostFeature(input.serverId, "independentChats");
  const blocker = resolveIndependentChatBlocker({
    hasDirectory: input.hasDirectory,
    connected: input.connected,
    supportsIndependentChats,
    isEmptySubmission: false,
  });
  return blocker === "update-host" ? t("newWorkspace.errors.updateHost") : null;
}
