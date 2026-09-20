import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { StateStore } from './services/state-store'
import { SteamDiscoveryService } from './services/steam-discovery'
import { CatalogService } from './services/catalog'
import { DeploymentService } from './services/deployment'
import { registerIpc, type AppContext } from './ipc'

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
declare const MAIN_WINDOW_VITE_NAME: string

let mainWindow: BrowserWindow | undefined

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true }
  })
  mainWindow = window
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('http://localhost:5173')) event.preventDefault() })
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') console.error(`[renderer] ${details.message} (${details.sourceId}:${details.lineNumber})`)
  })
  if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' && MAIN_WINDOW_VITE_DEV_SERVER_URL) await window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  else await window.loadFile(join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`))
}

async function bootstrap(): Promise<void> {
  await app.whenReady()
  const contentSecurityPolicy = app.isPackaged
    ? "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:"
    : "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: http://localhost:5173; img-src 'self' data:"
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [contentSecurityPolicy] } })
  })
  const stateRoot = join(app.getPath('userData'), 'state')
  const libraryRoot = join(stateRoot, 'library')
  await mkdir(libraryRoot, { recursive: true })
  const store = new StateStore(join(stateRoot, 'state.json'))
  await store.load()
  const steam = new SteamDiscoveryService()
  const catalogPath = join(app.isPackaged ? process.resourcesPath : process.cwd(), 'catalog', 'manifest.json')
  const catalog = new CatalogService(catalogPath)
  await catalog.load()
  const emit = (event: Parameters<NonNullable<Parameters<BrowserWindow['webContents']['send']>[1]>>[0]): void => {
    mainWindow?.webContents.send('progress', event)
  }
  const deployment = new DeploymentService(stateRoot, emit)
  await deployment.recover()
  await createWindow()
  const context: AppContext = { window: mainWindow!, store, steam, catalog, deployment, libraryRoot, emit }
  registerIpc(context)
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
void bootstrap().catch((error) => {
  console.error('Fatal application startup error:', error)
  app.exit(1)
})
