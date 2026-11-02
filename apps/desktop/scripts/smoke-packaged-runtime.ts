/** Validate the assembled application, including native Office conversion outside ASAR. */
import { join } from 'node:path'
import { desktopTargetPlatform, resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { readDesktopRuntime, verifyDesktopRuntime } from '../src/runtime-tree.ts'
import { smokePreparedRuntime } from './smoke-prepared-runtime.ts'

const paths = resolveDesktopTargetBuildPaths()
const contents = join(paths.application, 'Contents')
const resources = join(contents, 'Resources')
const descriptor = await verifyDesktopRuntime(paths.liwa, readDesktopRuntime(paths.liwa).release.version,
  desktopTargetPlatform(resolveDesktopBuildTarget()))
await smokePreparedRuntime(join(resources, 'app.asar', 'liwa'), join(contents, 'MacOS', 'Liwa'), join(resources, 'runtime'), descriptor)
