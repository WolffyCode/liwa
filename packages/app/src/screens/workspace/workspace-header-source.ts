import type { WorkspaceDescriptor } from "@/stores/session-store";

export type WorkspaceHeaderCheckoutState =
  | { kind: "pending" }
  | { kind: "error" }
  | { kind: "ready"; checkout: { isGit: boolean; currentBranch: string | null } };

type WorkspaceHeaderRenderState =
  | { kind: "skeleton" }
  | {
      kind: "ready";
      title: string;
      subtitle: string;
      /**
       * Whether the project name says anything the workspace name doesn't. It is the fact, not
       * the verdict: a header that stacks the two lines shows the project either way, and one
       * that sets them side by side drops the repeat.
       */
      isSubtitleDistinct: boolean;
      isGitCheckout: boolean;
      currentBranchName: string | null;
    };

function trimNonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function areHeaderLabelsEquivalent(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const normalizedA = trimNonEmpty(a)?.toLocaleLowerCase();
  const normalizedB = trimNonEmpty(b)?.toLocaleLowerCase();
  if (!normalizedA || !normalizedB) {
    return false;
  }
  return normalizedA === normalizedB;
}

export function resolveWorkspaceHeader(input: { workspace: WorkspaceDescriptor }): {
  title: string;
  subtitle: string;
} {
  // A chat's backing project is private, so its header names only the chat.
  return {
    title: input.workspace.name,
    subtitle: input.workspace.purpose === "chat" ? "" : input.workspace.projectDisplayName,
  };
}

export function resolveWorkspaceHeaderRenderState(input: {
  workspace: WorkspaceDescriptor | null;
  checkoutState: WorkspaceHeaderCheckoutState;
}): WorkspaceHeaderRenderState {
  if (!input.workspace) {
    return { kind: "skeleton" };
  }

  const header = resolveWorkspaceHeader({ workspace: input.workspace });
  // An enclosing repository can answer Git status for a chat directory; it is not the chat's.
  const isChat = input.workspace.purpose === "chat";
  const checkout =
    !isChat && input.checkoutState.kind === "ready" ? input.checkoutState.checkout : null;
  const currentBranchName =
    checkout?.isGit && checkout.currentBranch !== "HEAD"
      ? trimNonEmpty(checkout.currentBranch)
      : null;

  return {
    kind: "ready",
    title: header.title,
    subtitle: header.subtitle,
    isSubtitleDistinct:
      header.subtitle.length > 0 && !areHeaderLabelsEquivalent(header.title, header.subtitle),
    isGitCheckout: checkout?.isGit ?? false,
    currentBranchName,
  };
}

export function shouldRenderMissingWorkspaceDescriptor(input: {
  workspace: WorkspaceDescriptor | null;
  hasHydratedWorkspaces: boolean;
}): boolean {
  return !input.workspace && input.hasHydratedWorkspaces;
}
