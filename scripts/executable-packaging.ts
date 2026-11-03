/** Production-deploy preparation for the SSH helper executable carrier. */
import { existsSync } from 'node:fs'
import { glob, readFile, rm, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

/**
 * Entries pnpm writes into an installed `node_modules` tree at any depth: command shims and install
 * records. The records name the install's source and target by absolute path, and no runtime reads
 * them, so packaged runtimes omit them.
 */
export const PACKAGE_MANAGER_RECORDS: readonly string[] = ['.bin', '.pnpm', '.modules.yaml', '.pnpm-workspace-state-v1.json']

/** Files `pnpm deploy` writes beside the deployed manifest to describe its own install. */
const DEPLOY_ROOT_RECORDS = ['pnpm-lock.yaml', 'pnpm-workspace.yaml']

/** Manifest fields whose values `pnpm deploy` rewrites to absolute `file:` specifiers. */
const DEPLOYED_DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'devDependencies'] as const

/** A deploy-written local specifier, either bare (`file:…`) or aliased (`@scope/name@file:…`). */
const LOCAL_SPECIFIER = /^(?:(?:@[^/@]+\/)?[^/@]+@)?(?:file|link):/u

/** pkg reads this file beside the input manifest in place of the manifest's `pkg` field. */
export const PKG_CONFIG_FILE = '.pkgrc.json'

/** Checkout source trees a payload staged inside the checkout can reach through module resolution. */
const CHECKOUT_SOURCE_TREES = ['packages', 'apps', 'vendor', 'native', 'scripts']

/**
 * Resolve pnpm without invoking a command shell, including Windows shims.
 * @param args - pnpm arguments.
 * @returns the executable and its argument vector.
 */
export function pnpmInvocation(args: string[]): [command: string, args: string[]] {
  const entrypoint = process.env.npm_execpath?.trim()
  if (entrypoint !== undefined && entrypoint !== '') {
    const extension = extname(entrypoint).toLowerCase()
    if (extension === '.js' || extension === '.cjs' || extension === '.mjs') {
      return [process.execPath, [entrypoint, ...args]]
    }
    if (extension !== '.cmd') return [entrypoint, args]
  }
  const home = process.env.PNPM_HOME?.trim()
  if (home !== undefined && home !== '') {
    const packageBin = resolve(home, '..', 'pnpm', 'bin')
    for (const filename of ['pnpm.mjs', 'pnpm.cjs']) {
      const candidate = resolve(packageBin, filename)
      if (existsSync(candidate)) return [process.execPath, [candidate, ...args]]
    }
  }
  if (process.platform === 'win32') {
    throw new Error('executable-packaging: pnpm must expose a JavaScript entrypoint through npm_execpath or PNPM_HOME on Windows.')
  }
  return ['pnpm', args]
}

/**
 * Build the pnpm arguments that deploy a workspace package's production closure into a flat tree.
 * The lockfile deploy installs exactly the versions in `pnpm-lock.yaml`; `--legacy` under the hoisted
 * linker ignores the lockfile and re-resolves every range from the registry.
 * @param packageName - workspace package whose production dependencies define the payload.
 * @param target - empty or absent directory that receives the deployed tree.
 * @returns the arguments following the pnpm executable.
 */
export function productionDeployArguments(packageName: string, target: string): string[] {
  return [
    '--filter',
    packageName,
    'deploy',
    '--prod',
    '--config.node-linker=hoisted',
    // Deploy names workspace packages by absolute file URLs, which allowBuilds cannot list. Their only
    // install script restores node-pty's spawn-helper mode, and each carrier copies and marks that
    // helper itself; third-party builds keep the workspace's reviewed allowBuilds decisions.
    '--config.strict-dep-builds=false',
    target,
  ]
}

/**
 * Build a pkg configuration that also ignores the checkout around a staged payload. pkg resolves a
 * module missing from the payload by climbing into ancestor `node_modules`, so a payload staged
 * inside the checkout would embed development packages such as tsx. pkg matches ignores against
 * absolute paths, so payload-relative ignores are anchored at the payload here, and callers write
 * the result to {@link PKG_CONFIG_FILE}: pkg embeds the manifest.
 * @param checkout - repository root whose dependencies and sources stay out of the executable.
 * @param payload - staged payload root that pkg packages.
 * @param assets - pkg asset globs relative to the payload.
 * @param ignore - pkg ignore globs relative to the payload.
 * @returns the configuration object pkg reads from {@link PKG_CONFIG_FILE}.
 */
export function pkgConfigExcludingCheckout(
  checkout: string, payload: string, assets: readonly string[], ignore: readonly string[],
): { pkg: { assets: string[]; ignore: string[] } } {
  const root = checkout.replaceAll('\\', '/')
  const payloadRoot = payload.replaceAll('\\', '/')
  return { pkg: { assets: [...assets], ignore: [
    ...ignore.map(glob => `${payloadRoot}/${glob}`),
    // picomatch's `**` skips dot directories, so pnpm's virtual store needs its own pattern.
    `${root}/node_modules/**`, `${root}/node_modules/.pnpm/**`,
    ...CHECKOUT_SOURCE_TREES.map(tree => `${root}/${tree}/**`),
    `${root}/tsconfig*.json`,
  ] } }
}

/**
 * Delete pnpm's install records from a deployed payload: the lockfile and workspace settings beside
 * its manifest, and every {@link PACKAGE_MANAGER_RECORDS} entry below `node_modules`.
 * @param staging - deployed payload root.
 */
export async function removePackageManagerRecords(staging: string): Promise<void> {
  // Collect before deleting so removal never races the directory walk.
  const records = [...DEPLOY_ROOT_RECORDS]
  for await (const record of glob(`node_modules/**/{${PACKAGE_MANAGER_RECORDS.join(',')}}`, { cwd: staging })) records.push(record)
  for (const record of records) {
    await rm(join(staging, record), { recursive: true, force: true })
  }
}

/**
 * Replace the absolute `file:` specifiers `pnpm deploy` writes into the deployed manifest with the
 * versions installed beside it, as publishing does for `workspace:` ranges, so the manifest still
 * names every deployed dependency without naming the checkout.
 * @param staging - deployed payload root whose `package.json` and `node_modules` pnpm wrote.
 * @throws when a locally specified dependency is not installed in the payload.
 */
export async function pinStagedDependencyVersions(staging: string): Promise<void> {
  const manifestPath = join(staging, 'package.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { [field in typeof DEPLOYED_DEPENDENCY_FIELDS[number]]?: Record<string, string> }
  for (const field of DEPLOYED_DEPENDENCY_FIELDS) {
    const dependencies = manifest[field] ?? {}
    for (const [name, specifier] of Object.entries(dependencies)) {
      if (!LOCAL_SPECIFIER.test(specifier)) continue
      const installedManifest = join(staging, 'node_modules', name, 'package.json')
      if (!existsSync(installedManifest)) {
        throw new Error(`executable-packaging: ${field}.${name} names ${specifier}, but ${installedManifest} is missing.`)
      }
      const installed = JSON.parse(await readFile(installedManifest, 'utf8')) as { version: string }
      dependencies[name] = installed.version
    }
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}
