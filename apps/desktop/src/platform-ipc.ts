/** Shared names for the desktop Platform bridge. */
/** Private desktop channels; the Platform renderer receives bootstrap and locale updates. */
export const PLATFORM_IPC = {
  bootstrap: 'liwa-platform:bootstrap',
  localeChanged: 'liwa-platform:locale-changed',
  open: 'liwa-platform:open',
  bounds: 'liwa-platform:bounds',
  close: 'liwa-platform:close',
} as const

/** Resolved Platform language; Desktop resolves the system preference before sending it. */
export type PlatformLocale = 'en_US' | 'zh_CN'
