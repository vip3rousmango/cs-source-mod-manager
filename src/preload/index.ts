import { contextBridge, ipcRenderer } from 'electron'
import type { IPCAPI, ModProfile, ProgressEvent } from '../shared/contracts'

const api: IPCAPI = {
  getSnapshot: () => ipcRenderer.invoke('getSnapshot'),
  discoverGame: () => ipcRenderer.invoke('discoverGame'),
  chooseGameDirectory: () => ipcRenderer.invoke('chooseGameDirectory'),
  refreshCatalog: () => ipcRenderer.invoke('refreshCatalog'),
  installCatalogMod: (id) => ipcRenderer.invoke('installCatalogMod', id),
  importLocalMod: () => ipcRenderer.invoke('importLocalMod'),
  createProfile: (name) => ipcRenderer.invoke('createProfile', name),
  updateProfile: (profile: ModProfile) => ipcRenderer.invoke('updateProfile', profile),
  previewProfile: (profileId) => ipcRenderer.invoke('previewProfile', profileId),
  deployProfile: (profileId, confirmConflicts) => ipcRenderer.invoke('deployProfile', { profileId, confirmConflicts }),
  removeInstalledMod: (modId) => ipcRenderer.invoke('removeInstalledMod', modId),
  openManagedFolder: () => ipcRenderer.invoke('openManagedFolder'),
  subscribeToProgress: (listener: (event: ProgressEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: ProgressEvent): void => listener(value)
    ipcRenderer.on('progress', wrapped)
    return () => ipcRenderer.removeListener('progress', wrapped)
  }
}

contextBridge.exposeInMainWorld('csmm', api)
