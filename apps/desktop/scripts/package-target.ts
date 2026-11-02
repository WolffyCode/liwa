/** Build the local Apple Silicon application with matching Electron and liwa architecture. */

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { join, resolve } from 'node:path'
import { resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths, type DesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { createPackagingRun, recordPackagingEvent } from './packaging-run.mjs'
import { packagingErrorDetails, packagingStep } from './packaging-step.mjs'
import { requireDesktopToolchain } from './desktop-toolchain-preflight.ts'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')

/** Concurrent package packs while staging workspace tarballs. */
const PACK_CONCURRENCY = 4

/** Environment names whose values packaging logs redact. */
const CREDENTIAL_NAME = /KEY|SECRET|TOKEN|PASSWORD/iu

/** Signing inputs electron-builder would otherwise discover; the local application carries only an ad-hoc signature. */
const SIGNING_ENVIRONMENT = /^(?:(?:WIN_)?CSC_|APPLE_)/iu

/** Validated packaging request. */
export interface DesktopPackageInvocation {
  /** Stop at the unpacked application without a disk image. */
  readonly directory: boolean
  /** Prepare the runtime and package set without running electron-builder. */
  readonly prepareOnly: boolean
  /** Validate the host and toolchain without building. */
  readonly check: boolean
}

/**
 * Parse the packaging command line and reject hosts that cannot run the packaged runtime.
 * @param argv - Arguments after the script entry point.
 * @param hostPlatform - Build-host Node.js platform.
 * @param hostArch - Build-host Node.js architecture.
 * @returns The validated packaging mode.
 */
export function parseDesktopPackageInvocation(
  argv: readonly string[],
  hostPlatform: NodeJS.Platform = process.platform,
  hostArch: string = process.arch,
): DesktopPackageInvocation {
  const { values } = parseArgs({
    // `pnpm run <script> -- --dir` forwards the separator itself.
    args: argv.filter(argument => argument !== '--'),
    allowPositionals: false,
    options: {
      dir: { type: 'boolean', default: false },
      'prepare-only': { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
    },
  })
  resolveDesktopBuildTarget({}, hostPlatform, hostArch)
  return { directory: values.dir, prepareOnly: values['prepare-only'], check: values.check }
}

/**
 * Replace inherited signing inputs so electron-builder applies only the configured ad-hoc signature.
 * @param environment - Packaging command environment.
 * @returns A copy without certificate or notarization inputs and with identity discovery disabled.
 */
export function adHocSigningEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(environment).filter(([name]) => !SIGNING_ENVIRONMENT.test(name))),
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  }
}

/**
 * Build the electron-builder command arguments for the Desktop target.
 * @param directory - Whether to stop at an unpacked application directory.
 * @returns Arguments that never publish.
 */
export function desktopElectronBuilderArguments(directory: boolean): readonly string[] {
  return [
    'exec',
    'electron-builder',
    '--config',
    'electron-builder.config.mjs',
    '--mac',
    '--arm64',
    '--publish',
    'never',
    ...(directory ? ['--dir'] : []),
  ]
}

function runPnpm(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
  run?: ReturnType<typeof createPackagingRun>,
): Promise<void> {
  const pnpmEntry = process.env.npm_execpath
  if (pnpmEntry === undefined || pnpmEntry === '') {
    throw new Error('desktop package: invoke this script through a pnpm package command')
  }
  if (run !== undefined) return run.run(args.join(' '), process.execPath, [pnpmEntry, ...args], { cwd, env })
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [pnpmEntry, ...args], { cwd, env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`desktop package: pnpm ${args.join(' ')} exited with ${String(code ?? signal)}`))
    })
  })
}

function productVersion(): string {
  const manifest = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error('desktop package: desktop package has no version')
  }
  return manifest.version
}

/**
 * Prepare the runtime from the current workspace and assemble the application without publishing.
 * @param invocation - Validated packaging mode.
 * @param environment - Ad-hoc signing environment shared by every subprocess.
 * @param run - Persistent stage supervisor.
 * @param buildPaths - Target-owned directories; the host's Apple Silicon target by default.
 * @returns Resolves after preparation or complete packaging; any failed stage stops the run.
 */
export async function packageTarget(
  invocation: DesktopPackageInvocation,
  environment: NodeJS.ProcessEnv,
  run: ReturnType<typeof createPackagingRun> | undefined,
  buildPaths: DesktopTargetBuildPaths = resolveDesktopTargetBuildPaths(environment),
): Promise<void> {
  const atRepository = (args: readonly string[]) => runPnpm(args, environment, REPOSITORY_ROOT, run)
  const atApplication = (args: readonly string[]) => runPnpm(args, environment, APP_ROOT, run)
  const packArguments = ['--concurrency', String(PACK_CONCURRENCY)]
  await atRepository(['run', 'build', '--profile', 'official'])
  await atRepository(['exec', 'tsx', 'apps/desktop/scripts/pack-local-packages.ts', '--out', buildPaths.packedLiwa, ...packArguments])
  await atRepository(['--dir', 'apps/desktop-host', 'pack', '--pack-destination', buildPaths.packedLiwa])
  await atRepository(['run', 'release:pack', '--family', 'vendor', '--out', buildPaths.packedVendor, ...packArguments])
  // The flock binding has no registry copy: build it on this Mac and stage its platform package beside the entry.
  await atRepository(['run', 'build:native-system'])
  await atRepository(['--dir', 'native/system', 'run', 'build:ts'])
  rmSync(buildPaths.packedNative, { recursive: true, force: true })
  mkdirSync(buildPaths.packedNative, { recursive: true })
  for (const directory of ['native/system/packages/entry', 'native/system/packages/darwin-arm64']) {
    await atRepository(['--dir', directory, 'pack', '--pack-destination', buildPaths.packedNative])
  }
  await atApplication(['run', 'prepare:runtime'])
  await atApplication(['run', 'prepare:packages'])
  await atApplication(['run', 'prepare:liwa'])
  if (invocation.prepareOnly) return
  await atApplication(desktopElectronBuilderArguments(invocation.directory))
  await atApplication(['exec', 'tsx', 'scripts/smoke-packaged-runtime.ts'])
  if (run !== undefined) recordPackagingEvent(run.directory, { type: 'artifacts', directory: buildPaths.artifacts })
}

async function main(): Promise<void> {
  const invocation = parseDesktopPackageInvocation(process.argv.slice(2))
  const version = productVersion()
  if (invocation.check) {
    await requireDesktopToolchain()
    process.stdout.write(`desktop package: mac-arm64 ${version}; host and toolchain valid\n`)
    return
  }
  const environment = adHocSigningEnvironment(process.env)
  const secrets = Object.entries(environment).filter(([name]) => CREDENTIAL_NAME.test(name)).map(([, value]) => value ?? '')
  const run = createPackagingRun(join(APP_ROOT, '.desktop-build', 'packaging-runs'), {
    target: 'mac-arm64', directory: invocation.directory, prepareOnly: invocation.prepareOnly,
    version, node: process.version,
  }, { parallel: true, secrets })
  console.log(`DESKTOP_PACKAGING_RECORD ${run.directory}`)
  const previousDirectory = process.env.LIWA_DESKTOP_PACKAGING_RUN_DIR
  process.env.LIWA_DESKTOP_PACKAGING_RUN_DIR = run.directory
  environment.LIWA_DESKTOP_PACKAGING_RUN_DIR = run.directory
  let success = false
  try {
    await packagingStep(run.directory, 'toolchain', () => requireDesktopToolchain(), secrets)
    await packagingStep(run.directory, 'macos-package', () => packageTarget(invocation, environment, run), secrets)
    success = true
  } catch (error) {
    process.stderr.write(`${packagingErrorDetails(error, secrets)}\n`)
    process.stderr.write(`desktop package: failed; see ${run.directory}/events.jsonl\n`)
    process.exitCode = 1
  } finally {
    if (previousDirectory === undefined) delete process.env.LIWA_DESKTOP_PACKAGING_RUN_DIR
    else process.env.LIWA_DESKTOP_PACKAGING_RUN_DIR = previousDirectory
    run.finish(success)
  }
  if (!success || invocation.prepareOnly) return
  const paths = resolveDesktopTargetBuildPaths()
  console.log(`App: ${paths.application}`)
  if (!invocation.directory) console.log(`DMG: ${join(paths.artifacts, `liwa-${version}-mac-arm64.dmg`)}`)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) await main()
