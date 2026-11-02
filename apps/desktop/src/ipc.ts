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
  nativeThemeSet: 'liwa-desktop:native-theme-set',
  windowFullscreen: 'liwa-desktop:window-fullscreen',
  windowsAppearance: 'liwa-desktop:windows-appearance',
  windowsMenu: 'liwa-desktop:windows-menu',
} as const

/** Operations the Desktop preload exposes to the primary product document. */
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
