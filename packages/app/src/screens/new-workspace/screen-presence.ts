import { useGlobalSearchParams, usePathname } from "expo-router";
import { useCallback, useEffect, useRef } from "react";

const NEW_WORKSPACE_PATHNAME = "/new";

export interface NewWorkspaceScreenPresence {
  isMounted: boolean;
  pathname: string;
  draftId: string | null;
  activeDraftId: string | null;
}

/**
 * Workspace creation blocks on a slow daemon RPC, so by the time it resolves the user may have
 * moved on. Popping to a workspace unmounts the screen while its last observed pathname stays
 * "/new", and pushing a route on top of it keeps it mounted underneath. Every New conversation
 * entry opens a fresh draft on the same pathname, so the foreground draft must also be this one.
 */
export function isNewWorkspaceScreenActive(input: NewWorkspaceScreenPresence): boolean {
  return (
    input.isMounted &&
    input.pathname === NEW_WORKSPACE_PATHNAME &&
    input.draftId === input.activeDraftId
  );
}

export function useNewWorkspaceScreenPresence(draftId: string | undefined): () => boolean {
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ draftId?: string }>();
  const activeDraftId = typeof params.draftId === "string" ? params.draftId : null;
  const routeRef = useRef({ pathname, activeDraftId });
  routeRef.current = { pathname, activeDraftId };
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return useCallback(
    () =>
      isNewWorkspaceScreenActive({
        isMounted: isMountedRef.current,
        pathname: routeRef.current.pathname,
        activeDraftId: routeRef.current.activeDraftId,
        draftId: draftId ?? null,
      }),
    [draftId],
  );
}
