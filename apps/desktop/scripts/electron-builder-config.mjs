import { officePackageDirectories } from '../../../scripts/libreoffice-packages.mjs'
import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { desktopTargetBuildPaths, desktopTargetPlatform, resolveDesktopBuildTarget } from './desktop-build-paths.mjs'

/** Bundle identifier of the locally built application; it never matches another vendor's client. */
export const DESKTOP_APP_ID = 'com.wolffycode.liwa'

/** Link scheme the application registers; `liwa://open` brings the existing window forward. */
export const DESKTOP_LINK_SCHEME = 'liwa'

/**
 * Create the electron-builder configuration of the local Apple Silicon application.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @param {NodeJS.Platform} hostPlatform - Build-host platform, which must be macOS.
 * @param {string} hostArch - Build-host architecture, which must be arm64.
 * @returns {object} electron-builder configuration.
 */
export function createElectronBuilderConfig(env = process.env, hostPlatform = process.platform, hostArch = process.arch) {
  const target = resolveDesktopBuildTarget(env, hostPlatform, hostArch)
  const { platform, arch } = desktopTargetPlatform(target)
  const buildPaths = desktopTargetBuildPaths(target, env)
  const productVersion = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version
  return {
    appId: DESKTOP_APP_ID,
    protocols: [{ name: 'Liwa', schemes: [DESKTOP_LINK_SCHEME] }],
    productName: 'Liwa',
    // The default copyright uses author.name; this line names the product instead.
    copyright: `Copyright © ${new Date().getFullYear()} \${productName}`,
    artifactName: 'liwa-${version}-${os}-${arch}.${ext}',
    directories: { output: buildPaths.artifacts },
    asar: true,
    electronDist: buildPaths.electron,
    electronFuses: { runAsNode: true },
    files: [
      'lib/main.js',
      'lib/operation-report-worker.js',
      'lib/welcome/**/*',
      'lib/preload-app.cjs',
      'lib/preload-platform-account.cjs',
      'lib/preload-update-dialog.cjs',
      'lib/preload-welcome.cjs',
      'renderer/**/*',
      'package.json',
      '!node_modules/**/*.{js,cjs,mjs,ts,cts,mts,css}.map',
      '!node_modules/**/*.tsbuildinfo',
      { from: buildPaths.liwa, to: 'liwa', filter: ['**/*'] },
      // electron-builder excludes a source directory's root node_modules.
      { from: join(buildPaths.liwa, 'node_modules'), to: 'liwa/node_modules', filter: ['**/*'] },
    ],
    asarUnpack: ['**/*.{node,dylib,dll,so,exe}', '**/*.so.*', '**/spawn-helper', '**/@vscode/ripgrep-*/bin/rg',
      `**/node_modules/@deepseek-ai/libreoffice-kit-${platform}-${arch}/**/*`],
    extraResources: [
      { from: buildPaths.runtime, to: 'runtime' },
      // The About panel icon for platforms that do not read it from the application bundle.
      { from: fileURLToPath(new URL('../resources/icon-windows.png', import.meta.url)), to: 'icon.png' },
    ],
    mac: {
      icon: fileURLToPath(new URL('../resources/icon-macos.png', import.meta.url)),
      category: 'public.app-category.developer-tools',
      // macOS matches the application locale against this bundle, not Electron Framework resources.
      extendInfo: {
        CFBundleLocalizations: ['en', 'zh_CN', 'ja', 'es', 'fr', 'de', 'ru', 'pt'],
        NSMicrophoneUsageDescription: 'Liwa uses your microphone to transcribe speech into message drafts.',
      },
      // Ad-hoc signing keeps the modified Electron executable runnable without a Developer ID.
      identity: '-',
      forceCodeSigning: false,
      hardenedRuntime: true,
      entitlements: fileURLToPath(new URL('./macos-entitlements.plist', import.meta.url)),
      entitlementsInherit: fileURLToPath(new URL('./macos-entitlements.plist', import.meta.url)),
      // Prepared runtime files keep their own signatures; PAK resources are sealed by their enclosing bundle.
      signIgnore: ['/Contents/Resources/app\\.asar\\.unpacked/liwa(?:/|$)', '/Contents/Resources/runtime/primary-runtime(?:/|$)', '\\.pak$'],
      notarize: false,
      target: ['dmg'],
    },
    dmg: {
      format: 'ULMO',
      sign: false,
      writeUpdateInfo: false,
    },
    beforePack: async (context) => {
      const office = await officePackageDirectories(buildPaths.liwa, { platform, arch })
      const patterns = office.map(directory => `**/${relative(buildPaths.liwa, directory).split(sep).join('/')}/**/*`)
      const existing = context.packager.config.asarUnpack ?? []
      context.packager.config.asarUnpack = [...(typeof existing === 'string' ? [existing] : existing), ...patterns]
    },
    afterPack: async () => {
      const { verifyDesktopRuntime } = await import('../lib/types/runtime-tree.js')
      await verifyDesktopRuntime(buildPaths.liwa, productVersion, { platform, arch })
    },
    publish: null,
  }
}
