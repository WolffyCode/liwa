/** Prepare pinned, relocatable script interpreters without installing into the build host. */

import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import extractZip from 'extract-zip'
import { x as extractTar } from 'tar'
import { copyPrimaryRuntime, parsePrimaryRuntime, workspaceDependencyPaths, type PrimaryRuntimeManifest } from '@liwa/tool-workspace-dependencies'
import { acceptsNpmPlatform } from '../npm-platform.ts'
import lock from './lock.json' with { type: 'json' }
import { prunePrimaryRuntimePythonTests } from './prune-python-tests.ts'

/**
 * Download or reuse an archive only when its bytes match the release lock.
 * @param url - Locked archive URL.
 * @param sha256 - Expected hexadecimal SHA-256 digest.
 * @param cache - Download cache directory.
 * @returns Verified local archive path.
 */
export async function downloadPrimaryRuntimeAsset(url: string, sha256: string, cache: string): Promise<string> {
  mkdirSync(cache, { recursive: true })
  const destination = join(cache, sha256)
  let bytes: Buffer
  let cached = true
  try { bytes = readFileSync(destination) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    cached = false
    const timeout = Number(process.env.LIWA_RESOURCE_DOWNLOAD_TIMEOUT_MS ?? '300000')
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) throw new Error('LIWA_RESOURCE_DOWNLOAD_TIMEOUT_MS must be an integer from 1 to 2147483647')
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout) })
    if (!response.ok) throw new Error(`primary runtime download: ${String(response.status)} ${url}`)
    bytes = Buffer.from(await response.arrayBuffer())
  }
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
    rmSync(destination, { force: true })
    throw new Error(`primary runtime download: checksum mismatch for ${url}`)
  }
  if (cached) return destination
  const temporary = join(cache, `.${randomUUID()}`)
  try {
    writeFileSync(temporary, bytes)
    renameSync(temporary, destination)
  } finally {
    rmSync(temporary, { force: true })
  }
  return destination
}

/**
 * Prepare the locked standalone Node independently of Python and pnpm.
 * @param target - Target interpreter platform.
 * @param destination - Directory receiving bin/node and LICENSE.
 * @param cache - Verified archive cache.
 * @returns Resolves after extracting the interpreter.
 */
async function downloadNodeRuntime(target: PrimaryRuntimeTarget, destination: string, cache: string): Promise<void> {
  const artifact = lock.targets[target]
  const filename = `node-v${lock.nodeVersion}-${artifact.nodeArchive}`
  const archive = await downloadPrimaryRuntimeAsset(`https://nodejs.org/dist/v${lock.nodeVersion}/${filename}`, artifact.nodeSha256, cache)
  const staging = mkdtempSync(join(tmpdir(), 'liwa-node-'))
  try {
    if (target === 'win-x64') await extractZip(archive, { dir: staging })
    else await extractTar({ file: archive, cwd: staging })
    const source = join(staging, filename.replace(/\.(?:zip|tar\.gz)$/u, ''))
    mkdirSync(join(destination, 'bin'), { recursive: true })
    cpSync(join(source, ...(target === 'win-x64' ? ['node.exe'] : ['bin', 'node'])),
      join(destination, 'bin', target === 'win-x64' ? 'node.exe' : 'node'))
    cpSync(join(source, 'LICENSE'), join(destination, 'LICENSE'))
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

async function pythonArchive(target: keyof typeof lock.targets, cache: string): Promise<string> {
  const artifact = lock.targets[target]
  const filename = `cpython-${lock.pythonVersion}+${lock.pythonRelease}-${artifact.pythonTarget}-install_only_stripped.tar.gz`
  return downloadPrimaryRuntimeAsset(`https://github.com/astral-sh/python-build-standalone/releases/download/${lock.pythonRelease}/${encodeURIComponent(filename)}`, artifact.pythonSha256, cache)
}

/**
 * Identify the inputs that assemble one target's payload, excluding unrelated target locks.
 * @param target - Runtime target whose archives are installed.
 * @param runtimeLock - Locked interpreter and wheel inputs.
 * @param pnpmVersion - Package-manager version copied into the payload.
 * @returns SHA-256 payload identity for installation reuse.
 */
export function primaryRuntimePayloadDigest(
  target: keyof typeof lock.targets, runtimeLock: typeof lock, pnpmVersion: string,
): string {
  const { pythonVersion, pythonRelease, nodeVersion, wheels, pythonPackages } = runtimeLock
  // Identity preserves key order within the selected target, wheel records and distribution map, plus wheel-entry order.
  // Bump format when extraction or assembly changes payload bytes without changing locked inputs.
  return createHash('sha256').update(JSON.stringify({
    format: 8, target, pythonVersion, pythonRelease, nodeVersion,
    artifact: runtimeLock.targets[target], wheels, pythonPackages, pnpm: pnpmVersion,
  })).digest('hex')
}

/**
 * Unpack a locked library wheel, retaining auxiliary scripts in its distribution data directory.
 * @param archive - Hash-verified wheel archive.
 * @param destination - Absolute site-packages directory.
 * @returns Resolves after extraction without command wrappers; rejects other wheel installation schemes.
 */
export async function unpackPrimaryRuntimeWheel(archive: string, destination: string): Promise<void> {
  await extractZip(archive, {
    dir: destination,
    onEntry: (entry) => {
      const [directory, scheme] = entry.fileName.split('/')
      if (directory?.endsWith('.data') && scheme !== '' && scheme !== 'scripts') {
        throw new Error(`primary runtime: wheel requires unsupported installation paths: ${entry.fileName}`)
      }
    },
  })
}

/**
 * Remove packages bundled directly under pnpm's dist/node_modules whose npm `os`/`cpu` fields exclude the target.
 * The pnpm tarball carries every platform's optional native packages, such as `@reflink/reflink-darwin-x64`.
 * Nested node_modules and the `libc` field are not inspected; pnpm 11 bundles neither nested native packages nor Linux variants.
 * @param pnpm - Unpacked pnpm package directory.
 * @param platform - Target Node.js platform.
 * @param arch - Target Node.js architecture.
 * @throws When a bundled package manifest is missing or has invalid `os`/`cpu` fields.
 */
export function prunePnpmForeignNativePackages(pnpm: string, platform: NodeJS.Platform, arch: NodeJS.Architecture): void {
  const modules = join(pnpm, 'dist', 'node_modules')
  const directories = (parent: string): string[] => readdirSync(parent, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== '.bin').map(entry => join(parent, entry.name))
  for (const directory of directories(modules).flatMap(entry => basename(entry).startsWith('@') ? directories(entry) : [entry])) {
    const { os, cpu } = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { os?: unknown; cpu?: unknown }
    let admitted: boolean
    try { admitted = acceptsNpmPlatform(os, platform) && acceptsNpmPlatform(cpu, arch) } catch (error) {
      throw new Error(`primary runtime: ${directory}/package.json: ${(error as Error).message}`, { cause: error })
    }
    if (!admitted) rmSync(directory, { recursive: true })
  }
}

/**
 * Copy the skill package's complete asset tree to ordinary filesystem resources.
 * @param source - The package's assets directory.
 * @param destination - External Office skill resource directory.
 * @returns Resolves after replacing the external assets with the complete package tree.
 */
export async function prepareOfficeSkillAssets(source: string, destination: string): Promise<void> {
  rmSync(destination, { recursive: true, force: true })
  await cp(source, destination, { recursive: true, dereference: true })
}

/** A locked interpreter and wheel target. */
export type PrimaryRuntimeTarget = keyof typeof lock.targets

/** Resource preparation inputs for one build-host target. */
export interface PreparePrimaryRuntimeOptions {
  /** Target whose archives and wheels are downloaded. */
  readonly target: PrimaryRuntimeTarget
  /** Resource directory receiving primary-runtime/ and office-skills/. */
  readonly output: string
  /** SHA-256-addressed archive cache. */
  readonly cache: string
  /** Carrier release recorded in the legacy desktopVersion manifest field. */
  readonly version: string
}

/**
 * Materialize locked interpreters, libraries and Office resources without executing target code.
 * @param options - Explicit target and carrier-owned output locations.
 * @returns Resolves after the complete payload and skills have been copied to the output directory.
 */
export async function preparePrimaryRuntime(options: PreparePrimaryRuntimeOptions): Promise<void> {
  const { target } = options
  const paths = { runtime: resolve(options.output), downloads: resolve(options.cache) }
  mkdirSync(paths.runtime, { recursive: true })
  mkdirSync(paths.downloads, { recursive: true })
  const staging = mkdtempSync(join(tmpdir(), 'liwa-primary-'))
  try {
    const output = join(staging, 'payload')
    const dependencies = join(output, 'dependencies')
    mkdirSync(dependencies, { recursive: true })
    const platform = target === 'win-x64' ? 'win32' : target.startsWith('linux-') ? 'linux' : 'darwin'
    const arch = target.endsWith('-arm64') ? 'arm64' : 'x64'
    const node = join(dependencies, 'node')
    await downloadNodeRuntime(target, node, paths.downloads)
    mkdirSync(join(node, 'node_modules'))
    writeFileSync(join(node, 'node_modules', 'README.txt'), 'Reserved for bundled Node packages. pnpm uses its default installation directories.\n')
    const pnpmManifest = createRequire(import.meta.url).resolve('pnpm')
    const pnpmVersion = (JSON.parse(readFileSync(pnpmManifest, 'utf8')) as { version: string }).version
    await cp(dirname(pnpmManifest), join(dependencies, 'pnpm'), { recursive: true, dereference: true })
    prunePnpmForeignNativePackages(join(dependencies, 'pnpm'), platform, arch)
    await extractTar({ file: await pythonArchive(target, paths.downloads), cwd: dependencies })
    const manifest: PrimaryRuntimeManifest = {
      desktopVersion: options.version,
      platform,
      arch,
      payloadDigest: primaryRuntimePayloadDigest(target, lock, pnpmVersion),
      python: lock.pythonVersion,
      node: lock.nodeVersion,
      pnpm: pnpmVersion,
      pythonPackages: lock.pythonPackages,
    }
    const entries = workspaceDependencyPaths(output, manifest)
    for (const wheel of [...lock.targets[target].wheels, ...lock.wheels]) {
      await unpackPrimaryRuntimeWheel(await downloadPrimaryRuntimeAsset(wheel.url, wheel.sha256, paths.downloads), entries.pythonPackages)
    }
    prunePrimaryRuntimePythonTests(entries.pythonPackages)
    writeFileSync(join(output, 'runtime.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
    const destination = join(paths.runtime, 'primary-runtime')
    rmSync(destination, { recursive: true, force: true })
    await copyPrimaryRuntime(output, destination, manifest)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  const assets = join(dirname(createRequire(import.meta.url).resolve('@liwa/skill-office/package.json')), 'assets')
  await prepareOfficeSkillAssets(assets,
    join(paths.runtime, 'office-skills'))
}

/**
 * Execute the native payload's interpreters, package manager and Python libraries.
 * @param root - Final payload directory, including any platform signatures.
 * @param environment - Scrubbed subprocess environment; defaults to excluding credential-shaped names.
 */
export function smokePrimaryRuntime(root: string, environment: NodeJS.ProcessEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !/(?:KEY|SECRET|TOKEN|PASSWORD)/iu.test(name)),
)): void {
  const manifest = parsePrimaryRuntime(JSON.parse(readFileSync(join(root, 'runtime.json'), 'utf8')))
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) return
  if (Object.keys(manifest.pythonPackages).length === 0) throw new Error('primary runtime: missing Python distribution versions; prepare the payload before running its smoke checks.')
  const entries = workspaceDependencyPaths(root, manifest)
  if (manifest.platform !== 'win32') {
    const interpreter = `python${manifest.python.split('.').slice(0, 2).join('.')}`
    for (const name of ['python', 'python3']) {
      const path = join(dirname(entries.python), name)
      if (!lstatSync(path).isSymbolicLink() || readlinkSync(path) !== interpreter) {
        throw new Error(`primary runtime: Python commands must be relative aliases of ${interpreter}`)
      }
    }
    if (!lstatSync(join(dirname(entries.python), interpreter)).isFile()) throw new Error('primary runtime: versioned Python must be a regular file')
  }
  const options = { stdio: 'inherit', timeout: 120_000, env: environment } as const
  execFileSync(entries.python, ['-I', '-B', '-c', 'import decimal, xml.parsers.expat, lzma, uuid, numpy, pandas; assert numpy.arange(4).sum() == 6; assert pandas.DataFrame({"n": [1, 2]}).n.sum() == 3'], options)
  execFileSync(entries.python, ['-I', '-B', join(import.meta.dirname, 'smoke.py'), JSON.stringify(manifest.pythonPackages),
    manifest.python], options)
  execFileSync(entries.python, ['-I', '-B', '-m', 'pip', 'check'], options)
  if (entries.node !== undefined) execFileSync(entries.node, ['-e', `if (process.versions.node !== ${JSON.stringify(manifest.node)}) process.exit(1)`], options)
  if (entries.pnpm !== undefined && entries.node !== undefined) execFileSync(entries.node, [entries.pnpm, '--version'], options)
}

if (import.meta.main) {
  const { values } = parseArgs({ options: {
    target: { type: 'string' }, output: { type: 'string' }, cache: { type: 'string' },
  } })
  if (!values.target || !Object.hasOwn(lock.targets, values.target) || !values.output) {
    throw new Error(`Usage: pnpm run prepare:primary-runtime --target <${Object.keys(lock.targets).join('|')}> --output <directory> [--cache <directory>]`)
  }
  const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }
  const output = resolve(values.output)
  await preparePrimaryRuntime({
    target: values.target as PrimaryRuntimeTarget, output,
    cache: values.cache ?? join(tmpdir(), 'liwa-primary-runtime-downloads'), version,
  })
  smokePrimaryRuntime(join(output, 'primary-runtime'))
}
