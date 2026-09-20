import { app, BrowserWindow, session } from 'electron'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { StateStore } from './services/state-store'
import { SteamDiscoveryService } from './services/steam-discovery'
import { CatalogService } from './services/catalog'
import { DeploymentService } from './services/deployment'
import { registerIpc, type AppContext } from './ipc'
import { ServerCacheService } from './services/server-cache'
import { ProviderCacheService } from './services/provider-cache'
import { GameBananaProvider } from './providers/gamebanana'

function getDevServerUrl(): string | undefined {
  if (app.isPackaged || !process.env.CSMM_DEV_SERVER_URL) return undefined
  try {
    const url = new URL(process.env.CSMM_DEV_SERVER_URL)
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1') && !url.username && !url.password ? url.href : undefined
  } catch {
    return undefined
  }
}

let mainWindow: BrowserWindow | undefined

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false }
  })
  mainWindow = window
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-attach-webview', (event) => { event.preventDefault() })
  const devServerUrl = getDevServerUrl()
  window.webContents.on('will-navigate', (event, url) => {
    let allowed = false
    try { allowed = typeof devServerUrl === 'string' && new URL(url).origin === new URL(devServerUrl).origin } catch { allowed = false }
    if (!allowed) event.preventDefault()
  })
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') console.error(`[renderer] ${details.message} (${details.sourceId}:${details.lineNumber})`)
  })
  if (devServerUrl) await window.loadURL(devServerUrl)
  else await window.loadFile(join(__dirname, '../renderer/main_window/index.html'))
}

async function bootstrap(): Promise<void> {
  const testUserDataPath = process.env.CSMM_TEST_USER_DATA
  if (!app.isPackaged && testUserDataPath) app.setPath('userData', testUserDataPath)
  await app.whenReady()
  const usingViteDevServer = Boolean(getDevServerUrl())
  const contentSecurityPolicy = usingViteDevServer
    ? "default-src 'self'; base-uri 'none'; object-src 'none'; frame-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self' ws: http://localhost:5173; img-src 'self' data: https://images.gamebanana.com"
    : "default-src 'self'; base-uri 'none'; object-src 'none'; frame-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data: https://images.gamebanana.com"
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [contentSecurityPolicy] } })
  })
  const stateRoot = join(app.getPath('userData'), 'state')
  const libraryRoot = join(stateRoot, 'library')
  await mkdir(libraryRoot, { recursive: true })
  const store = new StateStore(join(stateRoot, 'state.json'))
  await store.load()
  const steam = new SteamDiscoveryService()
  const catalogPath = app.isPackaged
    ? join(process.resourcesPath, 'catalog', 'manifest.json')
    : process.env.CSMM_TEST_CATALOG_PATH ?? join(process.cwd(), 'catalog', 'manifest.json')
  const catalog = new CatalogService(catalogPath)
  await catalog.load()
  const emit = (event: Parameters<NonNullable<Parameters<BrowserWindow['webContents']['send']>[1]>>[0]): void => {
    mainWindow?.webContents.send('progress', event)
  }
  const deployment = new DeploymentService(stateRoot, emit)
  const serverCache = new ServerCacheService()
  const providerCache = new ProviderCacheService(join(libraryRoot, 'provider-cache'))
  const providers: AppContext['providers'] = new Map()
  providers.set('gamebanana', new GameBananaProvider())
  await deployment.recover()
  await createWindow()
  const context: AppContext = { window: mainWindow!, store, steam, catalog, deployment, providers, serverCache, providerCache, libraryRoot, emit }
  registerIpc(context)
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
void bootstrap().catch((error) => {
  console.error('Fatal application startup error:', error)
  app.exit(1)
})
