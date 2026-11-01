/**
 * Virtual root of the worker host's in-memory filesystem. Kept
 * in one module so the process shim, the path/os shims, and the VFS image
 * collector cannot drift apart.
 */

/** Virtual filesystem root; `process.cwd()` and every absolute path start here. */
export const LIWA_ROOT = '/liwa'

/** `$LIWA_HOME`: durable-state directory inside the image. */
export const LIWA_HOME = `${LIWA_ROOT}/home`

/** Flat, symlink-free package tree resolved by the worker module loader. */
export const LIWA_NODE_MODULES = `${LIWA_ROOT}/node_modules`

/** Image configuration directory: the VFS manifest and the shipped agent presets. */
export const LIWA_CONFIG = `${LIWA_ROOT}/config`

/** Default (empty) workspace directory. */
export const LIWA_WORKSPACE = `${LIWA_ROOT}/workspace`

/** Temporary directory reported by `os.tmpdir()`. */
export const LIWA_TMP = `${LIWA_ROOT}/tmp`
