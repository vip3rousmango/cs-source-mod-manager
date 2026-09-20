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
import { CommunityNewsService } from './services/community-news'
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
let appContext: AppContext | undefined

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
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
  return window
}

async function loadWindow(window: BrowserWindow): Promise<void> {
  const devServerUrl = getDevServerUrl()
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
    const operationId = appContext?.operationId
    mainWindow?.webContents.send('progress', operationId ? Object.assign({}, event, { operationId }) : event)
  }
  const deployment = new DeploymentService(stateRoot, emit)
  const serverCache = new ServerCacheService()
  const providerCache = new ProviderCacheService(join(libraryRoot, 'provider-cache'))
  const communityNews = new CommunityNewsService()
  const providers: AppContext['providers'] = new Map()
  providers.set('gamebanana', new GameBananaProvider())
  await deployment.recover()
  const window = createWindow()
  const context: AppContext = { window, store, steam, catalog, deployment, providers, serverCache, providerCache, communityNews, libraryRoot, emit }
  appContext = context
  registerIpc(context)
  await loadWindow(window)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const nextWindow = createWindow()
      if (appContext) appContext.window = nextWindow
      void loadWindow(nextWindow)
    }
  })
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
void bootstrap().catch((error) => {
  console.error('Fatal application startup error:', error)
  app.exit(1)
})
