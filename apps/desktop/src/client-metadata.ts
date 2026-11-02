/** Desktop client build identity. */

/**
 * Read the client build version inlined by the Desktop build.
 * @returns the version embedded in this application build.
 * @throws Error when the build carries no client version, instead of reporting a guessed one.
 */
export function desktopClientVersion(): string {
  const version = process.env.LIWA_CLIENT_VERSION
  if (version === undefined || version === '') {
    throw new Error('desktop: this application build carries no LIWA_CLIENT_VERSION')
  }
  return version
}
