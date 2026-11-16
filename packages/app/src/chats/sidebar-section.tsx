import { useCallback, useState, type ReactNode } from "react";
import { SquarePen } from "lucide-react-native";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { SidebarChatsEmptyState } from "@/components/sidebar/empty-states";
import { SidebarGroupToggleRow } from "@/components/sidebar/sidebar-group-toggle-row";
import type { SidebarGroupVisibilityPolicy } from "@/components/sidebar/sidebar-group-visibility";
import {
  SidebarSectionAction,
  SidebarSectionHeader,
} from "@/components/sidebar/sidebar-section-header";
import { useLimitedSidebarGroup } from "@/components/sidebar/use-limited-sidebar-group";
import type { SidebarWorkspacePlacement } from "@/hooks/use-sidebar-workspaces-list";
import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";
import { useSidebarCollapsedSectionsStore } from "@/stores/sidebar-collapsed-sections-store";
import { useOpenNewChat } from "./new-chat";

/**
 * The sidebar's Conversations section: independent chats, below Projects in every grouping mode.
 * Pinned chats are not passed in; they sit in Pinned, once.
 */
export function SidebarChatsSection({
  chats,
  hasPinnedChats,
  selection,
  visibilityPolicy,
  renderChat,
  onBeforeNavigate,
}: {
  chats: SidebarWorkspacePlacement[];
  /** Pinned chats mean the user already has conversations, so the empty state stays away. */
  hasPinnedChats: boolean;
  /** The workspace rows highlight as selected; null where no row can be selected. */
  selection: ActiveWorkspaceSelection | null;
  visibilityPolicy: SidebarGroupVisibilityPolicy<SidebarWorkspacePlacement>;
  renderChat: (chat: SidebarWorkspacePlacement) => ReactNode;
  onBeforeNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const openNewChat = useOpenNewChat();
  const collapsed = useSidebarCollapsedSectionsStore((state) => state.collapsedChats);
  const toggleCollapsed = useSidebarCollapsedSectionsStore((state) => state.toggleChatsCollapsed);
  const [expanded, setExpanded] = useState(false);
  const toggleExpanded = useCallback(() => setExpanded((current) => !current), []);
  const { leadingItem, visibleItems, canToggle } = useLimitedSidebarGroup({
    items: chats,
    selection,
    expanded,
    policy: visibilityPolicy,
  });
  const startNewChat = useCallback(() => {
    onBeforeNavigate?.();
    openNewChat();
  }, [onBeforeNavigate, openNewChat]);

  return (
    <View testID="sidebar-chats-section">
      <SidebarSectionHeader
        title={t("sidebar.conversations.title")}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        testID="sidebar-chats-section-header"
      >
        <SidebarSectionAction
          icon={SquarePen}
          label={t("newWorkspace.title")}
          onPress={startNewChat}
          testID="sidebar-chats-new"
        />
      </SidebarSectionHeader>
      {collapsed ? null : (
        <View testID="sidebar-chats-list">
          {leadingItem ? renderChat(leadingItem) : null}
          {visibleItems.map(renderChat)}
          {chats.length === 0 && !hasPinnedChats ? (
            <SidebarChatsEmptyState onNewChat={startNewChat} />
          ) : null}
          {canToggle ? (
            <SidebarGroupToggleRow
              expanded={expanded}
              onPress={toggleExpanded}
              testID="sidebar-chats-show-more"
            />
          ) : null}
        </View>
      )}
    </View>
  );
}
