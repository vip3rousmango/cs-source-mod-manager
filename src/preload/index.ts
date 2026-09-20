import { contextBridge, ipcRenderer } from 'electron'
import type { IPCAPI, ModPackEntry, ModProfile, ProgressEvent, ProviderBrowseRequest } from '../shared/contracts'

const api: IPCAPI = {
  getSnapshot: () => ipcRenderer.invoke('getSnapshot'),
  toggleFullscreen: () => ipcRenderer.invoke('toggleFullscreen'),
  discoverGame: () => ipcRenderer.invoke('discoverGame'),
  chooseGameDirectory: () => ipcRenderer.invoke('chooseGameDirectory'),
  refreshCatalog: () => ipcRenderer.invoke('refreshCatalog'),
  installCatalogMod: (id) => ipcRenderer.invoke('installCatalogMod', id),
  browseProvider: (request: ProviderBrowseRequest) => ipcRenderer.invoke('browseProvider', request),
  getProviderMod: (provider, remoteModId, gameId) => ipcRenderer.invoke('getProviderMod', { provider, remoteModId, gameId }),
  installProviderMod: (provider, remoteModId, remoteFileId) => ipcRenderer.invoke('installProviderMod', { provider, remoteModId, remoteFileId }),
  createModPack: (name: string, entries: ModPackEntry[]) => ipcRenderer.invoke('createModPack', { name, entries }),
  installModPack: (packId: string) => ipcRenderer.invoke('installModPack', packId),
  importLocalMod: (kind) => ipcRenderer.invoke('importLocalMod', kind),
  createProfile: (name) => ipcRenderer.invoke('createProfile', name),
  updateProfile: (profile: ModProfile) => ipcRenderer.invoke('updateProfile', profile),
  previewProfile: (profileId) => ipcRenderer.invoke('previewProfile', profileId),
  deployProfile: (profileId, confirmConflicts) => ipcRenderer.invoke('deployProfile', { profileId, confirmConflicts }),
  removeInstalledMod: (modId) => ipcRenderer.invoke('removeInstalledMod', modId),
  openInstalledModFolder: (modId) => ipcRenderer.invoke('openInstalledModFolder', modId),
  shareInstalledMod: (modId) => ipcRenderer.invoke('shareInstalledMod', modId),
  cancelOperation: (operationId) => ipcRenderer.invoke('cancelOperation', operationId),
  openManagedFolder: () => ipcRenderer.invoke('openManagedFolder'),
  getServerCache: () => ipcRenderer.invoke('getServerCache'),
  cleanServerCache: (confirm) => ipcRenderer.invoke('cleanServerCache', confirm),
  getCommunityNews: (forceRefresh = false) => ipcRenderer.invoke('getCommunityNews', forceRefresh),
  getCommunityNewsArticle: (id: string) => ipcRenderer.invoke('getCommunityNewsArticle', id),
  openExternal: (url) => ipcRenderer.invoke('openExternal', url),
  subscribeToProgress: (listener: (event: ProgressEvent) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: ProgressEvent): void => listener(value)
    ipcRenderer.on('progress', wrapped)
    return () => ipcRenderer.removeListener('progress', wrapped)
  },
  subscribeToFullscreen: (listener: (fullscreen: boolean) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, value: boolean): void => listener(value)
    ipcRenderer.on('fullscreen-changed', wrapped)
    return () => ipcRenderer.removeListener('fullscreen-changed', wrapped)
  }
}

contextBridge.exposeInMainWorld('csmm', api)
