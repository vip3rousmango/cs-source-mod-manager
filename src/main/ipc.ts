import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve, sep as pathSeparator } from 'node:path'
import { SOURCE_GAMES, type AppState, type GameInstallation, type ModPackEntry, type ModProfile, type ModProviderId, type ProgressEvent, type ProviderBrowseRequest, type ProviderModDetails, type ProviderSearchResult, type Snapshot, type SourceGameId } from '../shared/contracts'
import { parseProfile } from '../shared/validation'
import { AppError, toAppError } from './services/errors'
import { StateStore } from './services/state-store'
import { SteamDiscoveryService } from './services/steam-discovery'
import { CatalogService } from './services/catalog'
import { DeploymentService } from './services/deployment'
import { importArchive, importFolder } from './services/archive-import'
import { ServerCacheService } from './services/server-cache'
import { ProviderCacheService } from './services/provider-cache'
import { GameBananaProvider } from './providers/gamebanana'
import { CommunityNewsService } from './services/community-news'
import type { ModProvider } from './providers/mod-provider'
interface AppContext {
  window: BrowserWindow
  store: StateStore
  steam: SteamDiscoveryService
  catalog: CatalogService
  deployment: DeploymentService
  providers: Map<ModProviderId, ModProvider>
  serverCache: ServerCacheService
  providerCache: ProviderCacheService
  communityNews: CommunityNewsService
  libraryRoot: string
  emit: (event: ProgressEvent) => void
  operationId?: string
  abortController?: AbortController
}

function ensureSender(event: Electron.IpcMainInvokeEvent, context: AppContext): void {
  if (event.sender !== context.window.webContents || event.senderFrame !== context.window.webContents.mainFrame) throw new AppError('INVALID_REQUEST', 'Invalid IPC sender.')
  try {
    const frame = new URL(event.senderFrame.url)
    const expected = new URL(context.window.webContents.getURL())
    if (frame.protocol !== expected.protocol || frame.hostname !== expected.hostname || frame.port !== expected.port || frame.pathname !== expected.pathname) throw new Error('frame location mismatch')
  } catch {
    throw new AppError('INVALID_REQUEST', 'Invalid IPC frame origin.')
  }
}

function snapshot(context: AppContext): Snapshot {
  return { ...context.store.get(), catalog: context.catalog.get(), recoveryRequired: context.store.getRecoveryMessage() }
}
function assertWritable(context: AppContext): void {
  if (context.store.getRecoveryMessage()) throw new AppError('RECOVERY_REQUIRED', context.store.getRecoveryMessage()!)
}

function managedModPath(context: AppContext, mod: AppState['installedMods'][number]): string {
  const storageId = mod.storageId ?? mod.id
  if (!/^[A-Za-z0-9._-]+$/.test(storageId) || storageId === '.' || storageId === '..') throw new AppError('INTERNAL_ERROR', 'Installed mod storage metadata is invalid.')
  return join(context.libraryRoot, 'mods', storageId)
}

function safeManagedContentPath(context: AppContext, mod: AppState['installedMods'][number]): string {
  const root = resolve(join(context.libraryRoot, 'mods'))
  const target = resolve(mod.contentPath)
  if (target !== root && !target.startsWith(`${root}${pathSeparator}`)) throw new AppError('INVALID_REQUEST', 'The installed mod content path is outside the manager library.')
  return target
}

function throwIfCancelled(context: AppContext): void {
  if (context.abortController?.signal.aborted) throw new AppError('OPERATION_CANCELLED', 'Operation cancelled. No managed content was changed.')
}



let mutationTail = Promise.resolve()

function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(operation, operation)
  mutationTail = result.then(() => undefined, () => undefined)
  return result
}
export async function runTrackedMutation<T>(context: AppContext, operation: string, callback: () => Promise<T>): Promise<T> {
  assertWritable(context)
  const id = `${operation}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const startedAt = new Date().toISOString()
  const state = context.store.get()
  await context.store.save({
    ...state,
    activity: [...state.activity.slice(-99), { id, operation, status: 'running', message: `${operation} started.`, startedAt }]
  })
  context.operationId = id
  context.abortController = new AbortController()
  const emit = context.emit
  context.emit = (event) => emit({ ...event, operationId: id })
  try {
    const result = await callback()
    const current = context.store.get()
    await context.store.save({
      ...current,
      activity: current.activity.map((item) => item.id === id ? { ...item, status: 'success', message: `${operation} completed.`, finishedAt: new Date().toISOString() } : item)
    })
    return result
  } catch (error) {
    const appError = toAppError(error)
    const current = context.store.get()
    await context.store.save({
      ...current,
      activity: current.activity.map((item) => item.id === id ? { ...item, status: appError.code === 'OPERATION_CANCELLED' ? 'cancelled' : 'failure', message: appError.message, finishedAt: new Date().toISOString() } : item)
    })
    throw error
  } finally {
    context.emit = emit
    context.operationId = undefined
    context.abortController = undefined
  }
}

function enqueueTrackedMutation<T>(context: AppContext, operation: string, callback: () => Promise<T>): Promise<T> {
  return enqueueMutation(() => runTrackedMutation(context, operation, callback))
}

function parseProviderModRequest(value: unknown): { provider: ModProviderId; remoteModId: string; remoteFileId?: string; gameId?: SourceGameId } {
  if (!value || typeof value !== 'object') throw new AppError('INVALID_REQUEST', 'Invalid provider mod request.')
  const args = value as Partial<{ provider: ModProviderId; remoteModId: string; remoteFileId: string; gameId: SourceGameId }>
  if (args.provider !== 'gamebanana' || !/^\d{1,12}$/.test(args.remoteModId ?? '')) throw new AppError('INVALID_REQUEST', 'Invalid provider mod ID.')
  if (args.remoteFileId !== undefined && !/^\d{1,12}$/.test(args.remoteFileId)) throw new AppError('INVALID_REQUEST', 'Invalid provider file ID.')
  if (args.gameId !== undefined && !SOURCE_GAMES.some((game) => game.id === args.gameId)) throw new AppError('INVALID_REQUEST', 'Invalid Source game.')
  return { provider: args.provider, remoteModId: args.remoteModId!, remoteFileId: args.remoteFileId, gameId: args.gameId }
}
function parsePackEntries(value: unknown): ModPackEntry[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) throw new AppError('INVALID_REQUEST', 'A mod pack needs between one and one hundred entries.')
  const entries = value.map((candidate) => {
    if (!candidate || typeof candidate !== 'object') throw new AppError('INVALID_REQUEST', 'Invalid mod pack entry.')
    const entry = candidate as Partial<ModPackEntry>
    if (entry.provider !== 'gamebanana' || !/^\d{1,12}$/.test(entry.remoteModId ?? '') || !/^\d{1,12}$/.test(entry.remoteFileId ?? '') || typeof entry.title !== 'string' || entry.title.trim().length === 0 || entry.title.length > 200) {
      throw new AppError('INVALID_REQUEST', 'Invalid mod pack entry.')
    }
    return { provider: entry.provider, remoteModId: entry.remoteModId!, remoteFileId: entry.remoteFileId!, title: entry.title.trim() }
  })
  const identities = new Set(entries.map((entry) => `${entry.provider}:${entry.remoteModId}:${entry.remoteFileId}`))
  if (identities.size !== entries.length) throw new AppError('INVALID_REQUEST', 'A mod pack cannot contain duplicate files.')
  return entries
}
function parseCatalogId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,120}$/.test(value) || value === '.' || value === '..') throw new AppError('INVALID_REQUEST', 'Invalid catalog mod ID.')
  return value
}

async function loadProviderFixture<T>(key: string): Promise<T | undefined> {
  const fixturePath = process.env.CSMM_TEST_PROVIDER_FIXTURE
  if (!fixturePath) return undefined
  try {
    const parsed = JSON.parse(await readFile(fixturePath, 'utf8')) as Record<string, unknown>
    return parsed[key] as T
  } catch (error) {
    throw new AppError('NETWORK_ERROR', 'The provider test fixture could not be read safely.', error)
  }
}

async function downloadCatalogArchive(context: AppContext, id: string): Promise<Snapshot> {
  assertWritable(context)
  const entry = context.catalog.find(id)
  const operationId = `download-${id}-${Date.now()}`
  context.emit({ operationId, stage: 'downloading', message: `Downloading ${entry.title}`, bytesDone: 0, bytesTotal: entry.archiveSizeBytes })
  const downloads = join(context.libraryRoot, 'downloads')
  await mkdir(downloads, { recursive: true })
  const archivePath = join(downloads, `${entry.id}-${entry.version}.zip`)
  const response = await fetch(entry.archiveUrl, { signal: context.abortController?.signal })
  if (!response.ok || !response.body) throw new AppError('NETWORK_ERROR', `Download failed with HTTP ${response.status}.`)
  if (!response.url.startsWith('https://')) throw new AppError('NETWORK_ERROR', 'Download redirected to an insecure URL.')
  const temporaryPath = `${archivePath}.partial`
  const output = createWriteStream(temporaryPath, { flags: 'w' })
  const hash = createHash('sha256')
  let bytesDone = 0
  try {
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      throwIfCancelled(context)
      bytesDone += chunk.byteLength
      if (bytesDone > entry.archiveSizeBytes || bytesDone > 2 * 1024 * 1024 * 1024) throw new AppError('CHECKSUM_MISMATCH', 'Download exceeded the catalog size limit.')
      hash.update(chunk)
      if (!output.write(chunk)) await new Promise<void>((resolve) => output.once('drain', resolve))
      context.emit({ operationId, stage: 'downloading', message: `Downloaded ${bytesDone} bytes`, bytesDone, bytesTotal: entry.archiveSizeBytes })
    }
    await new Promise<void>((resolve, reject) => { output.end(() => resolve()); output.on('error', reject) })
    if (bytesDone !== entry.archiveSizeBytes || hash.digest('hex') !== entry.archiveSha256) throw new AppError('CHECKSUM_MISMATCH', 'Downloaded archive did not match the catalog manifest.')
    await rm(archivePath, { force: true })
    await rename(temporaryPath, archivePath)
  } catch (error) {
    output.destroy()
    await rm(temporaryPath, { force: true })
    throw error
  }
  const installed = await importArchive(archivePath, { libraryRoot: context.libraryRoot, source: 'catalog', modId: entry.id, title: entry.title, version: entry.version, author: entry.author, description: entry.description, sourceUrl: entry.sourcePageUrl, expectedSha256: entry.archiveSha256, expectedSize: entry.archiveSizeBytes, contentRoot: entry.contentRoot, signal: context.abortController?.signal, emit: context.emit })
  const state = context.store.get()
  const existing = state.installedMods.filter((mod) => mod.id !== installed.id)
  await context.store.save({ ...state, installedMods: [...existing, installed], settings: { catalogVersion: context.catalog.get().catalogVersion } })
  return snapshot(context)
}

function getProvider(context: AppContext, providerId: ModProviderId): ModProvider {
  const provider = context.providers.get(providerId)
  if (!provider) throw new AppError('NOT_FOUND', `Mod provider ${providerId} is not available.`)
  return provider
}

const PUBLIC_EXTERNAL_HOSTS = new Set(['store.steampowered.com', 'steamcommunity.com', 'gamebanana.com', 'api.gamebanana.com', 'moddb.com', 'www.moddb.com', 'rss.moddb.com', 'developer.valvesoftware.com'])

function parsePublicExternalUrl(value: unknown): string {
  if (typeof value !== 'string') throw new AppError('INVALID_REQUEST', 'Invalid external URL.')
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !PUBLIC_EXTERNAL_HOSTS.has(url.hostname)) throw new Error('not approved')
    return url.href
  } catch {
    throw new AppError('INVALID_REQUEST', 'External links are limited to approved HTTPS community sources.')
  }
}

const GAMEBANANA_DOWNLOAD_HOST = /(^|\.)gamebanana\.com$/i

function approvedGameBananaDownloadUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && GAMEBANANA_DOWNLOAD_HOST.test(url.hostname)
  } catch {
    return false
  }
}

export async function fetchApprovedProviderDownload(providerId: ModProviderId, url: string, signal?: AbortSignal): Promise<Response> {
  let currentUrl = url
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    if (providerId === 'gamebanana' && !approvedGameBananaDownloadUrl(currentUrl)) throw new AppError('NETWORK_ERROR', 'Provider redirected the download outside its approved domain.')
    const response = await fetch(currentUrl, { redirect: 'manual', signal })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new AppError('NETWORK_ERROR', 'Provider returned an invalid download redirect.')
      try {
        currentUrl = new URL(location, currentUrl).href
      } catch {
        throw new AppError('NETWORK_ERROR', 'Provider returned an invalid download redirect.')
      }
      continue
    }
    if (providerId === 'gamebanana' && !approvedGameBananaDownloadUrl(response.url || currentUrl)) throw new AppError('NETWORK_ERROR', 'Provider redirected the download outside its approved domain.')
    return response
  }
  throw new AppError('NETWORK_ERROR', 'Provider returned too many download redirects.')
}
function parseBrowseRequest(value: unknown): ProviderBrowseRequest {
  if (!value || typeof value !== 'object') throw new AppError('INVALID_REQUEST', 'Invalid provider browse request.')
  const request = value as Partial<ProviderBrowseRequest>
  if (request.provider !== 'gamebanana' || typeof request.query !== 'string') throw new AppError('INVALID_REQUEST', 'Invalid provider browse request.')
  if (request.query.length > 120) throw new AppError('INVALID_REQUEST', 'Provider search query is too long.')
  if (request.gameId !== undefined && !SOURCE_GAMES.some((game) => game.id === request.gameId)) throw new AppError('INVALID_REQUEST', 'Invalid Source game.')
  if (request.forceRefresh !== undefined && typeof request.forceRefresh !== 'boolean') throw new AppError('INVALID_REQUEST', 'Invalid provider refresh flag.')
  const page = request.page === undefined ? 1 : request.page
  const perPage = request.perPage === undefined ? 20 : request.perPage
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(perPage) || perPage < 1 || perPage > 30) throw new AppError('INVALID_REQUEST', 'Invalid provider pagination.')
  return { provider: request.provider, query: request.query.trim(), page, perPage, gameId: request.gameId ?? 'counter-strike-source', forceRefresh: request.forceRefresh === true }
}

async function downloadProviderArchive(context: AppContext, providerId: ModProviderId, remoteModId: string, remoteFileId: string): Promise<Snapshot> {
  const downloadFixture = await loadProviderFixture<{ error?: unknown }>('download')
  if (downloadFixture?.error) throw new AppError('NETWORK_ERROR', String(downloadFixture.error))
  assertWritable(context)
  const provider = getProvider(context, providerId)
  const details = await provider.getDetails(remoteModId, 'counter-strike-source')
  if (details.gameId !== 'counter-strike-source') throw new AppError('UNSUPPORTED_FORMAT', 'Only Counter-Strike: Source content can be installed into this library.')
  const selected = details.files.find((file) => file.id === remoteFileId)
  if (!selected || !selected.installable) throw new AppError('UNSUPPORTED_FORMAT', 'The selected provider file is not an installable ZIP.')
  const download = await provider.resolveDownload(remoteModId, remoteFileId, 'counter-strike-source')
  if (!download.checksumMd5) throw new AppError('CHECKSUM_MISMATCH', 'Provider did not provide a checksum for the selected file.')
  const operationId = `download-${providerId}-${remoteModId}-${remoteFileId}-${Date.now()}`
  context.emit({ operationId, stage: 'downloading', message: `Downloading ${details.title}`, bytesDone: 0, bytesTotal: download.sizeBytes || undefined })
  const downloads = join(context.libraryRoot, 'downloads')
  await mkdir(downloads, { recursive: true })
  const archivePath = join(downloads, `${providerId}-${remoteModId}-${remoteFileId}.zip`)
  const response = await fetchApprovedProviderDownload(providerId, download.url, context.abortController?.signal)
  if (!response.ok || !response.body) throw new AppError('NETWORK_ERROR', `Download failed with HTTP ${response.status}.`)
  const temporaryPath = `${archivePath}.partial`
  const output = createWriteStream(temporaryPath, { flags: 'w' })
  const hash = createHash('sha256')
  const md5Hash = createHash('md5')
  let bytesDone = 0
  let archiveSha256: string | undefined
  try {
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      throwIfCancelled(context)
      bytesDone += chunk.byteLength
      if (bytesDone > 2 * 1024 * 1024 * 1024 || (download.sizeBytes > 0 && bytesDone > download.sizeBytes)) throw new AppError('CHECKSUM_MISMATCH', 'Provider download exceeded the expected size.')
      hash.update(chunk)
      md5Hash.update(chunk)
      if (!output.write(chunk)) await new Promise<void>((resolve) => output.once('drain', resolve))
      context.emit({ operationId, stage: 'downloading', message: `Downloaded ${bytesDone} bytes`, bytesDone, bytesTotal: download.sizeBytes || undefined })
    }
    await new Promise<void>((resolve, reject) => { output.end(() => resolve()); output.on('error', reject) })
    if (download.sizeBytes > 0 && bytesDone !== download.sizeBytes) throw new AppError('CHECKSUM_MISMATCH', 'Provider download size changed while downloading.')
    archiveSha256 = hash.digest('hex')
    const archiveMd5 = md5Hash.digest('hex')
    if (download.checksumMd5 && archiveMd5 !== download.checksumMd5) throw new AppError('CHECKSUM_MISMATCH', 'Provider download checksum did not match the source file.')
    await rm(archivePath, { force: true })
    await rename(temporaryPath, archivePath)
  } catch (error) {
    output.destroy()
    await rm(temporaryPath, { force: true })
    throw error
  }
  if (!archiveSha256) throw new AppError('CHECKSUM_MISMATCH', 'Provider download checksum was not calculated.')
  const modId = `${providerId}:${remoteModId}:${remoteFileId}`
  const installed = await importArchive(archivePath, {
    libraryRoot: context.libraryRoot,
    source: 'provider',
    modId,
    storageId: `${providerId}-${remoteModId}-${remoteFileId}`,
    storageVersion: remoteFileId,
    provider: providerId,
    remoteModId,
    remoteFileId,
    title: details.title,
    version: selected.version ?? 'provider',
    author: details.author,
    description: details.description,
    sourceUrl: details.sourceUrl,
    expectedSize: download.sizeBytes || undefined,
    expectedSha256: archiveSha256,
    contentRoot: 'auto',
    signal: context.abortController?.signal,
    emit: context.emit
  })
  const state = context.store.get()
  await context.store.save({ ...state, installedMods: [...state.installedMods.filter((mod) => mod.id !== installed.id), installed] })
  return snapshot(context)
}

export function registerIpc(context: AppContext): void {
  const guard = <T>(handler: (context: AppContext, value: T) => Promise<unknown> | unknown) => async (event: Electron.IpcMainInvokeEvent, value: T) => {
    try { ensureSender(event, context); return await handler(context, value) } catch (error) { const appError = toAppError(error); const serialized = new Error(appError.message); serialized.name = appError.name; Object.assign(serialized, appError.toShape()); throw serialized }
  }
  ipcMain.handle('getSnapshot', guard((_context) => snapshot(context)))
  ipcMain.handle('toggleFullscreen', guard((current) => {
    const next = !current.window.isFullScreen()
    current.window.setFullScreen(next)
    return next
  }))
  ipcMain.handle('discoverGame', guard((current) => enqueueTrackedMutation(current, 'Discover game', async () => {
    assertWritable(current)
    const candidates = await current.steam.discover()
    const state = current.store.get()
    const counterStrike = candidates.find((candidate) => candidate.gameId === 'counter-strike-source') as GameInstallation | undefined
    await current.store.save({ ...state, detectedGames: candidates, ...(counterStrike ? { game: counterStrike } : {}) })
    if (!counterStrike) throw new AppError('GAME_NOT_FOUND', candidates.length ? 'Steam games were found, but Counter-Strike: Source was not among them. Choose its installation directory to continue.' : 'No supported Source games were found in the configured Steam libraries.')
    return snapshot(current)
  })))
  ipcMain.handle('chooseGameDirectory', guard((current) => enqueueTrackedMutation(current, 'Choose game directory', async () => {
    assertWritable(current)
    const result = await dialog.showOpenDialog(current.window, { properties: ['openDirectory'], title: 'Choose Counter-Strike: Source' })
    if (result.canceled || !result.filePaths[0]) return snapshot(current)
    const game = await current.steam.validateDirectory(result.filePaths[0])
    const state = current.store.get()
    await current.store.save({ ...state, game, detectedGames: [...state.detectedGames.filter((candidate) => candidate.installPath.toLowerCase() !== game.installPath.toLowerCase()), game] })
    return snapshot(current)
  })))
  ipcMain.handle('refreshCatalog', guard((current) => snapshot(current)))
  ipcMain.handle('installCatalogMod', guard((current, value: unknown) => enqueueTrackedMutation(current, 'Install curated mod', () => downloadCatalogArchive(current, parseCatalogId(value)))))
  ipcMain.handle('browseProvider', guard(async (current, value: unknown) => {
    const request = parseBrowseRequest(value)
    const fixture = await loadProviderFixture<ProviderSearchResult>('browse')
    if (fixture) return fixture
    const cacheKey = `browse:${JSON.stringify({ provider: request.provider, gameId: request.gameId, query: request.query, page: request.page, perPage: request.perPage })}`
    if (!request.forceRefresh) {
      const cached = await current.providerCache.get<ProviderSearchResult>(cacheKey)
      if (cached) return cached
    }
    const result = await getProvider(current, request.provider).browse(request)
    await current.providerCache.set(cacheKey, result)
    return result
  }))
  ipcMain.handle('getProviderMod', guard(async (current, value: unknown) => {
    const args = parseProviderModRequest(value)
    const fixture = await loadProviderFixture<ProviderModDetails>('details')
    if (fixture) return fixture
    const gameId = args.gameId ?? 'counter-strike-source'
    const cacheKey = `details:${args.provider}:${gameId}:${args.remoteModId}`
    const cached = await current.providerCache.get<ProviderModDetails>(cacheKey)
    if (cached) return cached
    const result = await getProvider(current, args.provider).getDetails(args.remoteModId, gameId)
    await current.providerCache.set(cacheKey, result)
    return result
  }))
  ipcMain.handle('installProviderMod', guard((current, value: unknown) => enqueueTrackedMutation(current, 'Install community mod', async () => {
    const args = parseProviderModRequest(value)
    if (!args.remoteFileId) throw new AppError('INVALID_REQUEST', 'A provider file is required.')
    return downloadProviderArchive(current, args.provider, args.remoteModId, args.remoteFileId)
  })))
  ipcMain.handle('createModPack', guard((current, value: unknown) => enqueueTrackedMutation(current, 'Create mod pack', async () => {
    assertWritable(current)
    if (!value || typeof value !== 'object') throw new AppError('INVALID_REQUEST', 'Invalid mod pack request.')
    const request = value as { name?: unknown; entries?: unknown }
    if (typeof request.name !== 'string' || request.name.trim().length === 0 || request.name.trim().length > 80) throw new AppError('INVALID_REQUEST', 'Pack name must be between one and eighty characters.')
    const now = new Date().toISOString()
    const pack = { id: `pack-${Date.now()}`, name: request.name.trim(), gameId: 'counter-strike-source' as const, entries: parsePackEntries(request.entries), createdAt: now, updatedAt: now }
    const state = current.store.get()
    await current.store.save({ ...state, modPacks: [...(state.modPacks ?? []), pack] })
    return snapshot(current)
  })))
  ipcMain.handle('getCommunityNews', guard((current, forceRefresh: unknown) => current.communityNews.getSnapshot(forceRefresh === true)))
  ipcMain.handle('getCommunityNewsArticle', guard((current, value: unknown) => {
    if (typeof value !== 'string' || value.length < 1 || value.length > 1000) throw new AppError('INVALID_REQUEST', 'Invalid news item ID.')
    return current.communityNews.getArticle(value)
  }))
  ipcMain.handle('openExternal', guard((_current, value: unknown) => shell.openExternal(parsePublicExternalUrl(value))))
  ipcMain.handle('installModPack', guard((current, value: string) => enqueueTrackedMutation(current, 'Install mod pack', async () => {
    assertWritable(current)
    if (typeof value !== 'string' || !/^pack-\d+$/.test(value)) throw new AppError('INVALID_REQUEST', 'Invalid mod pack ID.')
    const pack = (current.store.get().modPacks ?? []).find((candidate) => candidate.id === value)
    if (!pack) throw new AppError('NOT_FOUND', 'Mod pack was not found.')
    const failures: Array<{ title: string; message: string }> = []
    let completed = 0
    for (const entry of pack.entries) {
      try {
        await downloadProviderArchive(current, entry.provider, entry.remoteModId, entry.remoteFileId)
        completed += 1
      } catch (error) {
        failures.push({ title: entry.title, message: toAppError(error).message })
      }
    }
    return { ...snapshot(current), packInstall: { packId: pack.id, completed, failures } }
  })))
  ipcMain.handle('importLocalMod', guard((current, value: unknown) => enqueueTrackedMutation(current, 'Import local mod', async () => {
    assertWritable(current)
    const kind = value === 'archive' || value === 'folder' ? value : undefined
    const result = await dialog.showOpenDialog(current.window, {
      properties: kind === 'archive' ? ['openFile'] : kind === 'folder' ? ['openDirectory'] : ['openFile', 'openDirectory'],
      filters: kind === 'folder' ? undefined : [{ name: 'ZIP archives', extensions: ['zip'] }, { name: 'All files', extensions: ['*'] }],
      title: kind === 'archive' ? 'Import a ZIP archive' : kind === 'folder' ? 'Import an extracted mod folder' : 'Import a mod'
    })
    if (result.canceled || !result.filePaths[0]) return snapshot(current)
    const selected = result.filePaths[0]
    const sourceStat = await stat(selected)
    const installed = sourceStat.isDirectory()
      ? await importFolder(selected, { libraryRoot: current.libraryRoot, signal: current.abortController?.signal, emit: current.emit })
      : selected.toLowerCase().endsWith('.zip')
        ? await importArchive(selected, { libraryRoot: current.libraryRoot, source: 'local-zip', signal: current.abortController?.signal, emit: current.emit })
        : (() => { throw new AppError('UNSUPPORTED_FORMAT', 'Only extracted folders and ZIP archives are supported.') })()
    const state = current.store.get()
    await current.store.save({ ...state, installedMods: [...state.installedMods.filter((mod) => mod.id !== installed.id), installed] })
    return snapshot(current)
  })))
  ipcMain.handle('createProfile', guard((current, name: string) => enqueueTrackedMutation(current, 'Create profile', async () => {
    assertWritable(current)
    if (!name?.trim()) throw new AppError('INVALID_REQUEST', 'Profile name cannot be empty.')
    const now = new Date().toISOString()
    const profile: ModProfile = { id: `profile-${Date.now()}`, name: name.trim(), gameId: 'counter-strike-source', entries: [], updatedAt: now }
    const state = current.store.get()
    await current.store.save({ ...state, profiles: [...state.profiles, profile] })
    return snapshot(current)
  })))
  ipcMain.handle('updateProfile', guard((current, value: unknown) => enqueueTrackedMutation(current, 'Update profile', async () => {
    assertWritable(current)
    const profile = parseProfile(value)
    const state = current.store.get()
    if (!state.profiles.some((candidate) => candidate.id === profile.id)) throw new AppError('NOT_FOUND', 'Profile was not found.')
    await current.store.save({ ...state, profiles: state.profiles.map((candidate) => candidate.id === profile.id ? profile : candidate) })
    return snapshot(current)
  })))
  ipcMain.handle('previewProfile', guard((current, profileId: string) => current.deployment.preview(current.store.get(), profileId)))
  ipcMain.handle('deployProfile', guard((current, args: { profileId: string; confirmConflicts: boolean }) => enqueueTrackedMutation(current, 'Deploy profile', async () => {
    assertWritable(current)
    const result = await current.deployment.deploy(current.store.get(), args.profileId, args.confirmConflicts, current.operationId)
    await current.store.save(result.state)
    return snapshot(current)
  })))
  ipcMain.handle('removeInstalledMod', guard((current, modId: string) => enqueueTrackedMutation(current, 'Remove installed mod', async () => {
    assertWritable(current)
    const state = current.store.get()
    if (state.profiles.some((profile) => profile.entries.some((entry) => entry.modId === modId))) throw new AppError('MOD_IN_USE', 'Remove the mod from every profile before uninstalling it.')
    const mod = state.installedMods.find((candidate) => candidate.id === modId)
    if (!mod) throw new AppError('NOT_FOUND', 'Installed mod was not found.')
    safeManagedContentPath(current, mod)
    await rm(managedModPath(current, mod), { recursive: true, force: true })
    await current.store.save({ ...state, installedMods: state.installedMods.filter((candidate) => candidate.id !== modId) })
    return snapshot(current)
  })))
  ipcMain.handle('openInstalledModFolder', guard(async (current, modId: string) => {
    const mod = current.store.get().installedMods.find((candidate) => candidate.id === modId)
    if (!mod) throw new AppError('NOT_FOUND', 'Installed mod was not found.')
    const error = await shell.openPath(safeManagedContentPath(current, mod))
    if (error) throw new AppError('PERMISSION_DENIED', `Could not open the installed mod folder: ${error}`)
  }))
  ipcMain.handle('cancelOperation', guard((current, operationId: string) => {
    if (typeof operationId !== 'string' || operationId !== current.operationId || !current.abortController) return false
    current.abortController.abort()
    return true
  }))
  ipcMain.handle('shareInstalledMod', guard((current, modId: string) => {
    const mod = current.store.get().installedMods.find((candidate) => candidate.id === modId)
    if (!mod) throw new AppError('NOT_FOUND', 'Installed mod was not found.')
    clipboard.writeText([`CS Source Mod: ${mod.title}`, `Version: ${mod.version}`, mod.sourceUrl ? `Source: ${mod.sourceUrl}` : undefined, `Managed content: ${mod.contentPath}`].filter(Boolean).join('\n'))
  }))
  ipcMain.handle('getServerCache', guard((current) => current.serverCache.scan(current.store.get().game)))
  ipcMain.handle('cleanServerCache', guard((current, value: unknown) => enqueueTrackedMutation(current, 'Clean server cache', async () => {
    if (value !== true) throw new AppError('INVALID_REQUEST', 'Confirm server cache cleanup before continuing.')
    assertWritable(current)
    const cache = await current.serverCache.scan(current.store.get().game)
    if (cache.truncated) throw new AppError('INVALID_REQUEST', 'Server cache is too large to clean safely in one operation. Narrow the cache before retrying.')
    return current.serverCache.clean(current.store.get().game)
  })))
  ipcMain.handle('openManagedFolder', guard(async (current) => {
    const game = current.store.get().game
    if (!game) throw new AppError('GAME_NOT_FOUND', 'Configure Counter-Strike: Source first.')
    if (game.contentPath.includes('\0')) throw new AppError('INVALID_REQUEST', 'The configured game path is invalid.')
    const managedRoot = resolve(game.contentPath, 'custom')
    const target = resolve(current.store.get().activeDeployment?.targetPath ?? managedRoot)
    if (target.includes('\0') || (target !== managedRoot && !target.startsWith(`${managedRoot}${pathSeparator}`))) throw new AppError('INVALID_REQUEST', 'The managed folder path is outside the game custom directory.')
    const error = await shell.openPath(target)
    if (error) throw new AppError('PERMISSION_DENIED', `Could not open the managed folder: ${error}`)
  }))
}

export type { AppContext }
