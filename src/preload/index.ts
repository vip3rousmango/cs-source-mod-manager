import { contextBridge, ipcRenderer } from 'electron'
import type { IPCAPI, ModProfile, ProgressEvent, ProviderBrowseRequest } from '../shared/contracts'

const api: IPCAPI = {
  getSnapshot: () => ipcRenderer.invoke('getSnapshot'),
  discoverGame: () => ipcRenderer.invoke('discoverGame'),
  chooseGameDirectory: () => ipcRenderer.invoke('chooseGameDirectory'),
  refreshCatalog: () => ipcRenderer.invoke('refreshCatalog'),
  installCatalogMod: (id) => ipcRenderer.invoke('installCatalogMod', id),
  browseProvider: (request: ProviderBrowseRequest) => ipcRenderer.invoke('browseProvider', request),
  getProviderMod: (provider, remoteModId) => ipcRenderer.invoke('getProviderMod', { provider, remoteModId }),
  installProviderMod: (provider, remoteModId, remoteFileId) => ipcRenderer.invoke('installProviderMod', { provider, remoteModId, remoteFileId }),
  importLocalMod: () => ipcRenderer.invoke('importLocalMod'),
  createProfile: (name) => ipcRenderer.invoke('createProfile', name),
  updateProfile: (profile: ModProfile) => ipcRenderer.invoke('updateProfile', profile),
  previewProfile: (profileId) => ipcRenderer.invoke('previewProfile', profileId),
  deployProfile: (profileId, confirmConflicts) => ipcRenderer.invoke('deployProfile', { profileId, confirmConflicts }),
  removeInstalledMod: (modId) => ipcRenderer.invoke('removeInstalledMod', modId),
  shareInstalledMod: (modId) => ipcRenderer.invoke('shareInstalledMod', modId),
  getServerCache: () => ipcRenderer.invoke('getServerCache'),
  cleanServerCache: (confirm) => ipcRenderer.invoke('cleanServerCache', confirm),
  openManagedFolder: () => ipcRenderer.invoke('openManagedFolder'),
  subscribeToProgress: (listener: (event: ProgressEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: ProgressEvent): void => listener(value)
    ipcRenderer.on('progress', wrapped)
    return () => ipcRenderer.removeListener('progress', wrapped)
  }
}

contextBridge.exposeInMainWorld('csmm', api)
