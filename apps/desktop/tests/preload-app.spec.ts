// @vitest-environment jsdom
import type { DesktopFileDrag, FileDragHandle, FileDragRequestId } from '@liwa/util-file-drag'
import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { syncWindowsAppearance } from '../src/preload-windows.ts'
import { DESKTOP_IPC, type LiwaDesktopProductApi } from '../src/ipc.ts'

const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), off: vi.fn(), send: vi.fn() },
  webUtils: { getPathForFile: vi.fn() },
}))
vi.mock('electron', () => electron)
vi.mock('../src/preload-platform.ts', () => ({ markDocumentPlatform: vi.fn(), syncWindowFullscreen: vi.fn() }))
vi.mock('../src/preload-theme.ts', () => ({ syncNativeTheme: vi.fn() }))
vi.mock('../src/preload-windows.ts', () => ({ syncWindowsAppearance: vi.fn() }))

beforeEach(() => { vi.stubGlobal('process', { ...process, isMainFrame: true }) })
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules() })

it('gives product documents no plugin, backend, or update operations', async () => {
  vi.stubGlobal('location', new URL('liwa-app://app/index.html'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'liwaDesktop')?.[1] as LiwaDesktopProductApi
  expect(api).not.toHaveProperty('plugins')
  expect(api).not.toHaveProperty('backend')
  expect(api).not.toHaveProperty('updates')
})

it.each(['liwa-app://shell/plugin-manager.html', 'liwa-app://other/index.html', 'https://shell/startup.html', 'http://example.com/'])('exposes only the carrier marker to %s', async (url) => {
  vi.stubGlobal('location', new URL(url))
  await import('../src/preload-app.ts')
  expect(electron.contextBridge.exposeInMainWorld).toHaveBeenCalledWith('liwaDesktop', { protocolVersion: 1 })
  expect(electron.ipcRenderer.on.mock.calls.some(([channel]) => channel === DESKTOP_IPC.browserOpenRequested)).toBe(false)
})

it('exposes asynchronous boot only to the local application document', async () => {
  vi.stubGlobal('location', new URL('liwa-app://app/'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'liwaDesktopBoot')?.[1] as { ready(): Promise<unknown>; failed(message: string): Promise<void> }
  await api.ready()
  await api.failed('client mount failed')
  expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(DESKTOP_IPC.bootFailed, 'client mount failed')
  expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(DESKTOP_IPC.boot)
  vi.resetModules()
  electron.contextBridge.exposeInMainWorld.mockClear()
  vi.stubGlobal('location', new URL('https://other.example/'))
  await import('../src/preload-app.ts')
  expect(electron.contextBridge.exposeInMainWorld.mock.calls.some(([name]) => name === 'liwaDesktopBoot')).toBe(false)
})

it('exposes a directory picker only to the local application document', async () => {
  vi.stubGlobal('location', new URL('liwa-app://app/'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === '__LIWA_DIRECTORY_PICKER__')?.[1] as { pick(): Promise<string | null> }
  electron.ipcRenderer.invoke.mockResolvedValue('/workspace')
  await expect(api.pick()).resolves.toBe('/workspace')
  expect(electron.ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith(DESKTOP_IPC.directoryPick)
  for (const url of ['liwa-app://shell/startup.html', 'https://example.com/']) {
    vi.resetModules()
    electron.contextBridge.exposeInMainWorld.mockClear()
    vi.stubGlobal('location', new URL(url))
    await import('../src/preload-app.ts')
    expect(electron.contextBridge.exposeInMainWorld.mock.calls.some(([name]) => name === '__LIWA_DIRECTORY_PICKER__')).toBe(false)
  }
})

it('reports host paths of picked files only to the local application document', async () => {
  vi.stubGlobal('location', new URL('liwa-app://app/'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === '__LIWA_HOST_PATHS__')?.[1] as { pathFor(file: File): string }
  const picked = new File(['x'], 'notes.md')
  electron.webUtils.getPathForFile.mockReturnValue('/Users/me/notes.md')
  expect(api.pathFor(picked)).toBe('/Users/me/notes.md')
  expect(electron.webUtils.getPathForFile).toHaveBeenCalledExactlyOnceWith(picked)
  for (const url of ['liwa-app://shell/startup.html', 'https://example.com/']) {
    vi.resetModules()
    electron.contextBridge.exposeInMainWorld.mockClear()
    vi.stubGlobal('location', new URL(url))
    await import('../src/preload-app.ts')
    expect(electron.contextBridge.exposeInMainWorld.mock.calls.some(([name]) => name === '__LIWA_HOST_PATHS__')).toBe(false)
  }
})

it.each(['liwa-app://app/', 'liwa-app://shell/plugin-manager.html', 'https://example.com/'])(
  'installs Windows appearance only for the application document (%s)', async (url) => {
    vi.stubGlobal('location', new URL(url))
    await import('../src/preload-app.ts')
    expect(syncWindowsAppearance).toHaveBeenCalledTimes(url === 'liwa-app://app/' ? 1 : 0)
  },
)

it('moves welcome-entry focus to the document without changing keyboard tab order', async () => {
  const dom = new JSDOM('<body><button>Sidebar</button><input></body>')
  try {
    vi.stubGlobal('document', dom.window.document)
    vi.stubGlobal('location', new URL('liwa-app://app/'))
    await import('../src/preload-app.ts')
    const enter = electron.ipcRenderer.on.mock.calls.find(([channel]) => channel === DESKTOP_IPC.enterWorkspace)![1] as () => void
    const button = dom.window.document.querySelector('button')!
    button.focus()
    enter()
    expect(dom.window.document.activeElement).toBe(dom.window.document.body)
    expect(dom.window.document.body.hasAttribute('tabindex')).toBe(false)
    expect(button.tabIndex).toBe(0)
    dom.window.document.body.setAttribute('tabindex', '-1')
    button.focus()
    enter()
    expect(dom.window.document.body.getAttribute('tabindex')).toBe('-1')
  } finally { dom.window.close() }
})

it('exposes constrained shortcut operations and releases configuration subscriptions', async () => {
  vi.stubGlobal('location', new URL('liwa-app://app/'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'liwaDesktop')?.[1] as LiwaDesktopProductApi
  await api.shortcuts.get([])
  expect(api.shortcuts).not.toHaveProperty('reload')
  await api.shortcuts.recording(true)
  expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(DESKTOP_IPC.shortcutsGet, [])
  expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(DESKTOP_IPC.shortcutsRecording, true)
  const listener = vi.fn()
  const off = api.shortcuts.subscribe(listener)
  const handler = electron.ipcRenderer.on.mock.calls.find(([name]) => name === DESKTOP_IPC.shortcutsChanged)![1] as
    (event: unknown, state: unknown) => void
  handler({}, { status: 'ready' })
  expect(listener).toHaveBeenCalledWith({ status: 'ready' })
  off(); expect(electron.ipcRenderer.off).toHaveBeenCalledWith(DESKTOP_IPC.shortcutsChanged, handler)
})

it('withholds the product API from same-origin child frames', async () => {
  vi.stubGlobal('location', new URL('liwa-app://app/'))
  vi.stubGlobal('process', { ...process, isMainFrame: false })
  await import('../src/preload-app.ts')
  expect(electron.contextBridge.exposeInMainWorld).toHaveBeenCalledWith('liwaDesktop', { protocolVersion: 1 })
})

it('forwards only the focused product iframe and releases native input subscriptions', async () => {
  vi.stubGlobal('location', new URL('liwa-app://app/'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'liwaDesktop')?.[1] as LiwaDesktopProductApi
  const listener = vi.fn()
  const off = api.keyboard.subscribe(listener)
  const handler = electron.ipcRenderer.on.mock.calls.find(([name]) => name === DESKTOP_IPC.shortcutsInput)![1] as
    (event: unknown, state: unknown) => void
  const input = { kind: 'iframe', frameName: 'preview', revision: 'current' }
  handler({}, input)
  const frame = document.createElement('iframe')
  document.body.append(frame)
  frame.name = 'preview'
  frame.focus()
  handler({}, input)
  expect(listener).not.toHaveBeenCalled()
  frame.setAttribute('data-html-preview', '')
  handler({}, { ...input, frameName: 'stale' })
  handler({}, { ...input, frameName: '' })
  expect(listener).not.toHaveBeenCalled()
  handler({}, input)
  expect(listener).toHaveBeenCalledExactlyOnceWith(input)
  frame.remove()
  handler({}, input)
  expect(listener).toHaveBeenCalledTimes(1)
  const menu = { kind: 'menu', commandId: 'page.close', revision: 'current' }
  handler({}, menu)
  expect(listener).toHaveBeenLastCalledWith(menu)
  off()
  expect(electron.ipcRenderer.off).toHaveBeenCalledWith(DESKTOP_IPC.shortcutsInput, handler)
})

it('forwards browser guest input only for the focused live webview lease', async () => {
  vi.stubGlobal('location', new URL('liwa-app://app/'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'liwaDesktop')?.[1] as LiwaDesktopProductApi
  const listener = vi.fn()
  const off = api.keyboard.subscribe(listener)
  const handler = electron.ipcRenderer.on.mock.calls.find(([name]) => name === DESKTOP_IPC.shortcutsInput)![1] as
    (event: unknown, state: unknown) => void
  const input = { kind: 'webview', frameName: 'guest', revision: 'current' }
  const frame = document.createElement('webview')
  frame.tabIndex = 0
  frame.setAttribute('name', 'guest')
  document.body.append(frame)
  frame.focus()
  handler({}, input)
  expect(listener).not.toHaveBeenCalled()
  frame.setAttribute('data-sidebar-browser-frame', 'webview')
  handler({}, { ...input, frameName: '' })
  handler({}, { ...input, frameName: 'old' })
  expect(listener).not.toHaveBeenCalled()
  handler({}, input)
  expect(listener).toHaveBeenCalledExactlyOnceWith(input)
  const other = document.createElement('input')
  document.body.append(other)
  other.focus()
  handler({}, input)
  frame.remove()
  handler({}, input)
  expect(listener).toHaveBeenCalledOnce()
  off()
})

it('prepares original image bytes and starts native drags without renderer filesystem paths', async () => {
  vi.stubGlobal('location', new URL('liwa-app://app/'))
  await import('../src/preload-app.ts')
  const api = electron.contextBridge.exposeInMainWorld.mock.calls.find(([name]) => name === 'liwaDesktop')?.[1] as LiwaDesktopProductApi
  const bytes = new Uint8Array([137, 80, 78, 71])
  electron.ipcRenderer.invoke.mockResolvedValueOnce('image-handle').mockResolvedValueOnce(true).mockResolvedValueOnce(undefined)
  await expect(api.fileDrag.prepare({ kind: 'bytes', bytes, name: 'original.png', mediaType: 'image/png' }, 'request' as FileDragRequestId)).resolves.toBe('image-handle')
  await expect(api.fileDrag.start('image-handle' as FileDragHandle)).resolves.toBe(true)
  api.fileDrag.release('image-handle' as FileDragHandle)
  api.fileDrag.cancel('request' as FileDragRequestId)
  expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
    [DESKTOP_IPC.fileDragPrepare, { kind: 'bytes', bytes, name: 'original.png', mediaType: 'image/png' }, 'request'],
    [DESKTOP_IPC.fileDragStart, 'image-handle'],
    [DESKTOP_IPC.fileDragRelease, 'image-handle'],
    [DESKTOP_IPC.fileDragCancel, 'request'],
  ])
})

// The Host and Client compiler faces share no runtime entry; this assignment checks their image protocol.
const imageProtocol = (value: import('../src/ipc.ts').LiwaDesktopProductApi['fileDrag']): DesktopFileDrag => value
const imageProtocolBack = (value: DesktopFileDrag): import('../src/ipc.ts').LiwaDesktopProductApi['fileDrag'] => value
void imageProtocol
void imageProtocolBack
