/** Typed preload operations exposed only by the Electron shell. */

import type { DesktopKeyboardApi, DesktopShortcutsApi } from '@liwa/client-shortcuts/protocol'
import type { IpcMainInvokeEvent } from 'electron'
import type { DesktopBrowserBridge } from '@liwa/client-ui-sidebar-browser/types'
import type { DesktopFileDrag } from '@liwa/util-file-drag'

/** IPC channel names kept private to the desktop application bundle. */
export const DESKTOP_IPC = {
  shortcutsInput: 'liwa-desktop:shortcuts-input',
  shortcutsCloseWindow: 'liwa-desktop:shortcuts-close-window',
  shortcutsGet: 'liwa-desktop:shortcuts-get',
  shortcutsEdit: 'liwa-desktop:shortcuts-edit',
  shortcutsChanged: 'liwa-desktop:shortcuts-changed',
  shortcutsRecording: 'liwa-desktop:shortcuts-recording',
  boot: 'liwa-desktop:boot',
  enterWorkspace: 'liwa-desktop:enter-workspace',
  onboardingActive: 'liwa-desktop:onboarding-active',
  onboardingApiKey: 'liwa-desktop:onboarding-api-key',
  bootFailed: 'liwa-desktop:boot-failed',
  browserAcquire: 'liwa-desktop:browser-acquire',
  browserRelease: 'liwa-desktop:browser-release',
  browserOpenRequested: 'liwa-desktop:browser-open-requested',
  directoryPick: 'liwa-desktop:directory-pick',
  fileDragPrepare: 'liwa-desktop:file-drag-prepare',
  fileDragCancel: 'liwa-desktop:file-drag-cancel',
  fileDragStart: 'liwa-desktop:file-drag-start',
  fileDragRelease: 'liwa-desktop:file-drag-release',
  deviceInfo: 'liwa-desktop:device-info',
  localeBootstrap: 'liwa-desktop:locale-bootstrap',
  localeChanged: 'liwa-desktop:locale-changed',
  updatesStatus: 'liwa-desktop:updates-status',
  updatesOpen: 'liwa-desktop:updates-open',
  updatesPresentation: 'liwa-desktop:updates-presentation',
  nativeThemeSet: 'liwa-desktop:native-theme-set',
  windowFullscreen: 'liwa-desktop:window-fullscreen',
  windowsAppearance: 'liwa-desktop:windows-appearance',
  windowsMenu: 'liwa-desktop:windows-menu',
} as const

/** Desktop release update state rendered by desktop-owned UI. */
export type DesktopUpdatePreparationFailureKind = 'stop-failed' | 'tasks-changed' | 'tasks-unavailable' | 'fullscreen-timeout'

export interface DesktopUpdateState {
  readonly phase: 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'installing' | 'ready' | 'error'
  readonly version?: string
  readonly message?: string
  /** Main-owned diagnostics without subprocess output or credentials; hidden until expanded. */
  readonly technicalDetails?: string
  readonly percent?: number
  readonly failedOperation?: 'check' | 'download' | 'install'
  /** Main-owned preparation cause; UI wording is selected by the active locale. */
  readonly preparationFailure?: DesktopUpdatePreparationFailureKind
}

/** Classified failure copy selected by the Web locale without exposing raw updater diagnostics. */
export type DesktopUpdateFailureKind =
  | 'check'
  | 'check-network'
  | 'download'
  | 'download-network'
  | 'install'
  | 'install-network'
  | 'stop-failed'
  | 'tasks-changed'
  | 'tasks-unavailable'
  | 'fullscreen-timeout'

/** Semantic status content; actions open main-process confirmation dialogs only. */
export interface DesktopUpdatePresentation {
  readonly phase: DesktopUpdateState['phase']
  readonly version?: string
  readonly percent?: number
  readonly failure?: DesktopUpdateFailureKind
}

/** Product documents cannot supply update versions, package URLs, or installation authorization. */
export interface LiwaDesktopProductApi {
  readonly protocolVersion: 1
  readonly browser: DesktopBrowserBridge
  readonly fileDrag: DesktopFileDrag
  readonly keyboard: DesktopKeyboardApi
  readonly shortcuts: DesktopShortcutsApi
  /**
   * Local machine description for the feedback questionnaire.
   * @returns `name=value` fields separated by `; `, with no hostname, user name, or serial number.
   */
  deviceInfo(): Promise<string>
  readonly updates: {
    status(): Promise<DesktopUpdatePresentation>
    open(): Promise<void>
    subscribe(listener: (state: DesktopUpdatePresentation) => void): () => void
  }
}

/** Scheme of Desktop-owned application documents. */
export const SCHEME = 'liwa-app'

/**
 * Reject IPC outside the allowed Desktop document origins.
 * @param event - IPC caller whose frame URL supplies the origin.
 * @param hostnames - Desktop document hosts allowed for this operation.
 */
export function assertDesktopSender(event: IpcMainInvokeEvent, hostnames: readonly string[]): void {
  const senderFrame = event.senderFrame
  if (senderFrame === null) throw new Error('liwa desktop: rejected IPC without a sender frame')
  const url = new URL(senderFrame.url)
  if (url.protocol !== `${SCHEME}:` || !hostnames.includes(url.hostname)) {
    throw new Error('liwa desktop: rejected IPC from an unowned renderer')
  }
}
