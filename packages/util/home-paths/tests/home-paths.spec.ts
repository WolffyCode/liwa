import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENTS_HOME_DIR_NAME,
  DEFAULT_AGENTS_HOME_DISPLAY,
  DEFAULT_LIWA_HOME_DISPLAY,
  LIWA_HOME_DIR_NAME,
  agentsHomeDisplay,
  canonicalizeWatchPath,
  defaultAgentsHome,
  defaultLiwaHome,
  liwaCachePath,
  liwaHomeDisplay,
  liwaHomePath,
  expandHomePath,
  resolveAgentsHome,
  resolveLiwaHome,
} from '@liwa/home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('liwa path helpers', () => {
  it('owns the shared default Liwa home directory name', () => {
    expect(LIWA_HOME_DIR_NAME).toBe('.liwa')
    expect(DEFAULT_LIWA_HOME_DISPLAY).toBe('~/.liwa')
    expect(defaultLiwaHome()).toBe(join(homedir(), '.liwa'))
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.liwa')).toBe(join(homedir(), '.liwa'))
    expect(expandHomePath('~\\.liwa')).toBe(join(homedir(), '.liwa'))
    expect(expandHomePath('/tmp/.liwa')).toBe('/tmp/.liwa')
    expect(expandHomePath('~other/.liwa')).toBe('~other/.liwa')
  })

  it('resolves explicit path before LIWA_HOME and the default', () => {
    const envHome = join(homedir(), 'env-liwa')

    expect(resolveLiwaHome('/tmp/explicit-liwa', { LIWA_HOME: '~/env-liwa' })).toBe(resolve('/tmp/explicit-liwa'))
    expect(resolveLiwaHome(undefined, { LIWA_HOME: '~/env-liwa' })).toBe(envHome)
    expect(resolveLiwaHome(undefined, {})).toBe(defaultLiwaHome())
  })

  it('treats an empty or whitespace-only LIWA_HOME as unset', () => {
    expect(resolveLiwaHome(undefined, { LIWA_HOME: '' })).toBe(defaultLiwaHome())
    expect(resolveLiwaHome(undefined, { LIWA_HOME: '   ' })).toBe(defaultLiwaHome())
  })

  it('joins child segments onto the resolved LIWA_HOME', () => {
    vi.stubEnv('LIWA_HOME', '~/env-liwa')
    expect(liwaHomePath()).toBe(join(homedir(), 'env-liwa'))
    expect(liwaHomePath('storages', 'cache')).toBe(join(homedir(), 'env-liwa', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(liwaHomeDisplay(resolve(defaultLiwaHome()))).toBe('~/.liwa')
    expect(liwaHomeDisplay('/some/other/root')).toBe('$LIWA_HOME')
  })

  it('owns the shared default agents home directory name', () => {
    expect(AGENTS_HOME_DIR_NAME).toBe('.agents')
    expect(DEFAULT_AGENTS_HOME_DISPLAY).toBe('~/.agents')
    expect(defaultAgentsHome()).toBe(join(homedir(), '.agents'))
  })

  it('resolves an explicit agents home before LIWA_AGENTS_HOME and the default', () => {
    const envHome = join(homedir(), 'env-agents')

    expect(resolveAgentsHome('/tmp/explicit-agents', { LIWA_AGENTS_HOME: '~/env-agents' })).toBe(resolve('/tmp/explicit-agents'))
    expect(resolveAgentsHome(undefined, { LIWA_AGENTS_HOME: '~/env-agents' })).toBe(envHome)
    expect(resolveAgentsHome(undefined, {})).toBe(defaultAgentsHome())
  })

  it('treats an empty or whitespace-only LIWA_AGENTS_HOME as unset', () => {
    expect(resolveAgentsHome(undefined, { LIWA_AGENTS_HOME: '' })).toBe(defaultAgentsHome())
    expect(resolveAgentsHome(undefined, { LIWA_AGENTS_HOME: '   ' })).toBe(defaultAgentsHome())
  })

  it('labels a resolved agents home by whether it is the default root', () => {
    expect(agentsHomeDisplay(resolve(defaultAgentsHome()))).toBe('~/.agents')
    expect(agentsHomeDisplay('/some/other/root')).toBe('$LIWA_AGENTS_HOME')
  })

  it.each([
    [undefined, join(homedir(), '.liwa')],
    ['', join(homedir(), '.liwa')],
    ['   ', join(homedir(), '.liwa')],
    ['~/env-liwa', join(homedir(), 'env-liwa')],
    ['./relative-liwa', resolve('./relative-liwa')],
  ] as const)('resolves cache paths with LIWA_HOME=%j', (home, expectedHome) => {
    vi.stubEnv('LIWA_HOME', home)
    try {
      expect(liwaCachePath()).toBe(join(expectedHome, 'cache'))
      expect(liwaCachePath('models', 'index.json')).toBe(join(expectedHome, 'cache', 'models', 'index.json'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('resolves configured cache homes before the environment', () => {
    vi.stubEnv('LIWA_HOME', '~/env-liwa')
    try {
      expect(liwaCachePath({ liwaHome: '~/explicit-liwa' })).toBe(join(homedir(), 'explicit-liwa', 'cache'))
      expect(liwaCachePath({ liwaHome: './explicit-liwa' }, 'attachments', 'request-images'))
        .toBe(resolve('./explicit-liwa/cache/attachments/request-images'))
      expect(liwaCachePath({}, 'attachments')).toBe(join(homedir(), 'env-liwa', 'cache', 'attachments'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('canonicalizes a watcher ancestor while preserving a missing suffix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'liwa-watch-path-'))
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    try {
      await mkdir(target)
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(canonicalizeWatchPath(alias)).resolves.toBe(await realpath(target))
      await expect(canonicalizeWatchPath(join(alias, 'later', 'config.yml'))).resolves.toBe(
        join(await realpath(target), 'later', 'config.yml'),
      )
      const file = join(root, 'file')
      await writeFile(file, 'not a directory')
      await expect(canonicalizeWatchPath(join(file, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
