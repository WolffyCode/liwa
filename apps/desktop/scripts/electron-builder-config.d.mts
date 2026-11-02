import type { BeforePackContext } from 'app-builder-lib'

/** Bundle identifier of the locally built application. */
export declare const DESKTOP_APP_ID: 'com.wolffycode.liwa'

/** Link scheme the application registers. */
export declare const DESKTOP_LINK_SCHEME: 'liwa'

/** Electron-builder fields asserted by the Desktop packaging tests. */
export interface DesktopElectronBuilderConfig {
  readonly appId: typeof DESKTOP_APP_ID
  readonly protocols: readonly [{ readonly name: 'Liwa'; readonly schemes: readonly [typeof DESKTOP_LINK_SCHEME] }]
  readonly productName: 'Liwa'
  readonly copyright: string
  readonly artifactName: string
  readonly directories: {
    readonly output: string
  }
  readonly files: readonly [
    ...string[],
    { readonly from: string, readonly to: 'liwa', readonly filter: readonly ['**/*'] },
    { readonly from: string, readonly to: 'liwa/node_modules', readonly filter: readonly ['**/*'] },
  ]
  readonly asarUnpack: readonly string[]
  readonly extraResources: readonly [
    { readonly from: string, readonly to: 'runtime' },
    { readonly from: string, readonly to: 'icon.png' },
  ]
  readonly mac: {
    readonly extendInfo: {
      readonly CFBundleLocalizations: readonly string[]
      readonly NSMicrophoneUsageDescription: string
    }
    readonly entitlements: string
    readonly entitlementsInherit: string
    readonly identity: '-'
    readonly forceCodeSigning: false
    readonly notarize: false
    readonly signIgnore: readonly string[]
    readonly target: readonly ['dmg']
  }
  readonly dmg: {
    readonly format: 'ULMO'
    readonly sign: false
    readonly writeUpdateInfo: false
  }
  readonly beforePack: (context: BeforePackContext) => Promise<void>
  readonly afterPack: () => Promise<void>
  readonly publish: null
}

/**
 * Create the electron-builder configuration of the local Apple Silicon application.
 * @param env - Packaging environment.
 * @param hostPlatform - Build-host platform, which must be macOS.
 * @param hostArch - Build-host architecture, which must be arm64.
 * @returns electron-builder configuration.
 */
export function createElectronBuilderConfig(
  env?: NodeJS.ProcessEnv,
  hostPlatform?: NodeJS.Platform,
  hostArch?: string,
): DesktopElectronBuilderConfig
