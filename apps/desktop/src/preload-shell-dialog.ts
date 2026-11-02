/** Isolated response-only bridge for shell-owned update dialogs. */
import { contextBridge, ipcRenderer } from 'electron'
import { SHELL_DIALOG_IPC, type ShellDialogApi, type ShellDialogView } from './shell-dialog.ts'

const api: ShellDialogApi = {
  status: () => ipcRenderer.invoke(SHELL_DIALOG_IPC.status) as Promise<ShellDialogView | null>,
  respond: (revision, index) => ipcRenderer.invoke(SHELL_DIALOG_IPC.respond, revision, index) as Promise<void>,
  subscribe: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, view: ShellDialogView | null): void => { listener(view) }
    ipcRenderer.on(SHELL_DIALOG_IPC.changed, receive)
    return () => { ipcRenderer.removeListener(SHELL_DIALOG_IPC.changed, receive) }
  },
}
if (location.href === 'liwa-app://shell/shell-dialog.html') contextBridge.exposeInMainWorld('liwaShellDialog', api)
