/**
 * `deepseek` 提供方拉起的 CLI 是"同一个安装里的 `liwa`"：本体从哪个灵鲸安装启动，`liwa --profile deepseek`
 * 就从那里起，版本永远一致。安装位置是启动器给的事实（`profileContext.installAnchor`）；构建产物在就用
 * `lib/bin.js`，从源码跑的本体（开发时）就用源码入口加 tsx，与 SDK 客户端的规则相同。
 * @module @liwa/brain-deepseek/launcher
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { BrainError } from '@liwa/brain'

/** 起一个 `liwa` 进程的办法（不含 `--profile` 及之后的参数）。 */
export interface LiwaLauncher {
  /** 可执行文件与它的前置参数，例如 `[node, <安装>/lib/bin.js]`。 */
  argv: [string, ...string[]]
  /** 起在 `--profile` 之后的 `--patch` 层（源码入口在没构建的检出里要的兼容层）。 */
  patches: string[]
  /** 这个入口要的环境项。 */
  env: Record<string, string>
  /** 安装的版本（读安装的 package.json）。 */
  version: string | undefined
}

/**
 * 按安装位置给出起 `liwa` 的办法。
 * @param installAnchor - 安装的 `package.json`（`@liwa/cli`）的绝对路径。
 * @param fromSource - 本体是不是从源码入口跑的；是就让子进程也从源码跑。
 * @param tsxLoader - 源码入口要的 tsx ESM 加载器（绝对 URL）；只在从源码起时求值。
 * @returns 起法。
 * @throws {BrainError} `unavailable`：安装里既没有构建产物也没有源码入口。
 */
export function resolveLiwaLauncher(installAnchor: string, fromSource: boolean, tsxLoader: () => string): LiwaLauncher {
  const dir = dirname(installAnchor)
  const version = readVersion(installAnchor)
  const built = join(dir, 'lib', 'bin.js')
  const source = join(dir, 'src', 'bin.ts')
  if (!fromSource && existsSync(built)) return { argv: [process.execPath, built], patches: [], env: {}, version }
  if (!existsSync(source)) {
    throw new BrainError('unavailable', 'brain.liwa_launcher_missing', `the Liwa installation at ${dir} has neither ${built} nor ${source}`)
  }
  // 没构建过的源码检出里没有 Typert 生成的模块；SDK 客户端也这样补一层。
  const sourcePatch = join(dir, 'src', 'sdk-source.cordis.patch.yml')
  return {
    argv: [process.execPath, '--import', tsxLoader(), source],
    patches: existsSync(sourcePatch) ? [sourcePatch] : [],
    env: { TSX_TSCONFIG_PATH: join(dir, 'tsconfig.json') },
    version,
  }
}

/**
 * 本体是不是从这个安装的源码入口跑的。
 * @param installAnchor - 安装的 `package.json`。
 * @param entry - 本体进程的入口脚本（`process.argv[1]`）。
 * @returns 入口就是 `<安装>/src/bin.ts` 时为 true。
 */
export function runsFromSource(installAnchor: string, entry: string | undefined): boolean {
  return entry !== undefined && resolve(entry) === join(dirname(installAnchor), 'src', 'bin.ts')
}

/**
 * 读安装的版本号。
 * @param installAnchor - 安装的 `package.json`。
 * @returns 版本；读不到时为 `undefined`。
 */
function readVersion(installAnchor: string): string | undefined {
  try {
    const manifest: unknown = JSON.parse(readFileSync(installAnchor, 'utf8'))
    const version: unknown = manifest !== null && typeof manifest === 'object' ? Reflect.get(manifest, 'version') : undefined
    return typeof version === 'string' ? version : undefined
  } catch (_unreadable) {
    // 版本只是展示；读不到不影响拉起。
    return undefined
  }
}
