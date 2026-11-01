/** Dependency-free IPC names shared with the sandboxed mandatory-update preload. */
export const MANDATORY_IPC = {
  status: 'liwa-desktop:mandatory-status', state: 'liwa-desktop:mandatory-state', action: 'liwa-desktop:mandatory-action',
} as const
