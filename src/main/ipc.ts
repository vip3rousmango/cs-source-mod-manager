import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { AppState, ModProfile, ModProviderId, ProgressEvent, ProviderBrowseRequest, Snapshot } from '../shared/contracts'
import { parseProfile } from '../shared/validation'
import { AppError, toAppError } from './services/errors'
import { StateStore } from './services/state-store'
import { SteamDiscoveryService } from './services/steam-discovery'
import { CatalogService } from './services/catalog'
import { DeploymentService } from './services/deployment'
import { importArchive, importFolder } from './services/archive-import'
import { GameBananaProvider } from './providers/gamebanana'
import type { ModProvider } from './providers/mod-provider'
interface AppContext {
  window: BrowserWindow
  store: StateStore
  steam: SteamDiscoveryService
  catalog: CatalogService
  deployment: DeploymentService
  providers: Map<ModProviderId, ModProvider>
  libraryRoot: string
  emit: (event: ProgressEvent) => void
}


function ensureSender(event: Electron.IpcMainInvokeEvent, context: AppContext): void {
  if (event.sender !== context.window.webContents) throw new AppError('INVALID_REQUEST', 'Invalid IPC sender.')
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

let mutationTail = Promise.resolve()

function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(operation, operation)
  mutationTail = result.then(() => undefined, () => undefined)
  return result
}

function parseProviderModRequest(value: unknown): { provider: ModProviderId; remoteModId: string; remoteFileId?: string } {
  if (!value || typeof value !== 'object') throw new AppError('INVALID_REQUEST', 'Invalid provider mod request.')
  const args = value as Partial<{ provider: ModProviderId; remoteModId: string; remoteFileId: string }>
  if (args.provider !== 'gamebanana' || !/^\d{1,12}$/.test(args.remoteModId ?? '')) throw new AppError('INVALID_REQUEST', 'Invalid provider mod ID.')
  if (args.remoteFileId !== undefined && !/^\d{1,12}$/.test(args.remoteFileId)) throw new AppError('INVALID_REQUEST', 'Invalid provider file ID.')
  return { provider: args.provider, remoteModId: args.remoteModId!, remoteFileId: args.remoteFileId }
}
function parseCatalogId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._-]{1,120}$/.test(value) || value === '.' || value === '..') throw new AppError('INVALID_REQUEST', 'Invalid catalog mod ID.')
  return value
}

async function downloadCatalogArchive(context: AppContext, id: string): Promise<Snapshot> {
  assertWritable(context)
  const entry = context.catalog.find(id)
  const operationId = `download-${id}-${Date.now()}`
  context.emit({ operationId, stage: 'downloading', message: `Downloading ${entry.title}`, bytesDone: 0, bytesTotal: entry.archiveSizeBytes })
  const downloads = join(context.libraryRoot, 'downloads')
  await mkdir(downloads, { recursive: true })
  const archivePath = join(downloads, `${entry.id}-${entry.version}.zip`)
  const response = await fetch(entry.archiveUrl)
  if (!response.ok || !response.body) throw new AppError('NETWORK_ERROR', `Download failed with HTTP ${response.status}.`)
  if (!response.url.startsWith('https://')) throw new AppError('NETWORK_ERROR', 'Download redirected to an insecure URL.')
  const temporaryPath = `${archivePath}.partial`
  const output = createWriteStream(temporaryPath, { flags: 'w' })
  const hash = createHash('sha256')
  let bytesDone = 0
  try {
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
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
  const installed = await importArchive(archivePath, { libraryRoot: context.libraryRoot, source: 'catalog', modId: entry.id, title: entry.title, version: entry.version, author: entry.author, description: entry.description, sourceUrl: entry.sourcePageUrl, expectedSha256: entry.archiveSha256, expectedSize: entry.archiveSizeBytes, contentRoot: entry.contentRoot, emit: context.emit })
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

function parseBrowseRequest(value: unknown): ProviderBrowseRequest {
  if (!value || typeof value !== 'object') throw new AppError('INVALID_REQUEST', 'Invalid provider browse request.')
  const request = value as Partial<ProviderBrowseRequest>
  if (request.provider !== 'gamebanana' || typeof request.query !== 'string') throw new AppError('INVALID_REQUEST', 'Invalid provider browse request.')
  if (request.query.length > 120) throw new AppError('INVALID_REQUEST', 'Provider search query is too long.')
  const page = request.page === undefined ? 1 : request.page
  const perPage = request.perPage === undefined ? 20 : request.perPage
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(perPage) || perPage < 1 || perPage > 30) throw new AppError('INVALID_REQUEST', 'Invalid provider pagination.')
  return { provider: request.provider, query: request.query.trim(), page, perPage }
}

async function downloadProviderArchive(context: AppContext, providerId: ModProviderId, remoteModId: string, remoteFileId: string): Promise<Snapshot> {
  assertWritable(context)
  const provider = getProvider(context, providerId)
  const details = await provider.getDetails(remoteModId)
  const selected = details.files.find((file) => file.id === remoteFileId)
  if (!selected || !selected.installable) throw new AppError('UNSUPPORTED_FORMAT', 'The selected provider file is not an installable ZIP.')
  const download = await provider.resolveDownload(remoteModId, remoteFileId)
  const operationId = `download-${providerId}-${remoteModId}-${remoteFileId}-${Date.now()}`
  context.emit({ operationId, stage: 'downloading', message: `Downloading ${details.title}`, bytesDone: 0, bytesTotal: download.sizeBytes || undefined })
  const downloads = join(context.libraryRoot, 'downloads')
  await mkdir(downloads, { recursive: true })
  const archivePath = join(downloads, `${providerId}-${remoteModId}-${remoteFileId}.zip`)
  const response = await fetch(download.url)
  if (!response.ok || !response.body) throw new AppError('NETWORK_ERROR', `Download failed with HTTP ${response.status}.`)
  if (!response.url.startsWith('https://')) throw new AppError('NETWORK_ERROR', 'Download redirected to an insecure URL.')
  const temporaryPath = `${archivePath}.partial`
  const output = createWriteStream(temporaryPath, { flags: 'w' })
  const hash = createHash('sha256')
  const md5Hash = createHash('md5')
  let bytesDone = 0
  let archiveSha256: string | undefined
  try {
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
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
    emit: context.emit
  })
  const state = context.store.get()
  await context.store.save({ ...state, installedMods: [...state.installedMods.filter((mod) => mod.id !== installed.id), installed] })
  return snapshot(context)
}

export function registerIpc(context: AppContext): void {
  const guard = <T>(handler: (context: AppContext, value: T) => Promise<unknown> | unknown) => async (event: Electron.IpcMainInvokeEvent, value: T) => {
    try { ensureSender(event, context); return await handler(context, value) } catch (error) { throw toAppError(error).toShape() }
  }
  ipcMain.handle('getSnapshot', guard((_context) => snapshot(context)))
  ipcMain.handle('discoverGame', guard((current) => enqueueMutation(async () => {
    assertWritable(current)
    const candidates = await current.steam.discover()
    if (!candidates[0]) throw new AppError('GAME_NOT_FOUND', 'Counter-Strike: Source was not found in the configured Steam libraries.')
    const state = current.store.get()
    await current.store.save({ ...state, game: candidates[0] })
    return snapshot(current)
  })))
  ipcMain.handle('chooseGameDirectory', guard((current) => enqueueMutation(async () => {
    assertWritable(current)
    const result = await dialog.showOpenDialog(current.window, { properties: ['openDirectory'], title: 'Choose Counter-Strike: Source' })
    if (result.canceled || !result.filePaths[0]) return snapshot(current)
    const game = await current.steam.validateDirectory(result.filePaths[0])
    const state = current.store.get()
    await current.store.save({ ...state, game })
    return snapshot(current)
  })))
  ipcMain.handle('refreshCatalog', guard((current) => snapshot(current)))
  ipcMain.handle('installCatalogMod', guard((current, value: unknown) => enqueueMutation(() => downloadCatalogArchive(current, parseCatalogId(value)))))
  ipcMain.handle('browseProvider', guard(async (current, value: unknown) => {
    const request = parseBrowseRequest(value)
    return getProvider(current, request.provider).browse(request)
  }))
  ipcMain.handle('getProviderMod', guard((current, value: unknown) => {
    const args = parseProviderModRequest(value)
    return getProvider(current, args.provider).getDetails(args.remoteModId)
  }))
  ipcMain.handle('installProviderMod', guard((current, value: unknown) => {
    const args = parseProviderModRequest(value)
    if (!args.remoteFileId) throw new AppError('INVALID_REQUEST', 'A provider file ID is required.')
    return enqueueMutation(() => downloadProviderArchive(current, args.provider, args.remoteModId, args.remoteFileId!))
  }))
  ipcMain.handle('importLocalMod', guard((current) => enqueueMutation(async () => {
    assertWritable(current)
    const result = await dialog.showOpenDialog(current.window, { properties: ['openFile', 'openDirectory'], filters: [{ name: 'Mod files', extensions: ['zip', 'rar', '7z'] }] })
    if (result.canceled || !result.filePaths[0]) return snapshot(current)
    const selected = result.filePaths[0]
    const sourceStat = await stat(selected)
    const installed = sourceStat.isDirectory()
      ? await importFolder(selected, { libraryRoot: current.libraryRoot })
      : selected.toLowerCase().endsWith('.zip')
        ? await importArchive(selected, { libraryRoot: current.libraryRoot, source: 'local-zip' })
        : (() => { throw new AppError('UNSUPPORTED_FORMAT', 'Only extracted folders and ZIP archives are supported.') })()
    const state = current.store.get()
    await current.store.save({ ...state, installedMods: [...state.installedMods.filter((mod) => mod.id !== installed.id), installed] })
    return snapshot(current)
  })))
  ipcMain.handle('createProfile', guard((current, name: string) => enqueueMutation(async () => {
    assertWritable(current)
    if (!name?.trim()) throw new AppError('INVALID_REQUEST', 'Profile name cannot be empty.')
    const now = new Date().toISOString()
    const profile: ModProfile = { id: `profile-${Date.now()}`, name: name.trim(), gameId: 'counter-strike-source', entries: [], updatedAt: now }
    const state = current.store.get()
    await current.store.save({ ...state, profiles: [...state.profiles, profile] })
    return snapshot(current)
  })))
  ipcMain.handle('updateProfile', guard((current, value: unknown) => enqueueMutation(async () => {
    assertWritable(current)
    const profile = parseProfile(value)
    const state = current.store.get()
    if (!state.profiles.some((candidate) => candidate.id === profile.id)) throw new AppError('NOT_FOUND', 'Profile was not found.')
    await current.store.save({ ...state, profiles: state.profiles.map((candidate) => candidate.id === profile.id ? profile : candidate) })
    return snapshot(current)
  })))
  ipcMain.handle('previewProfile', guard((current, profileId: string) => current.deployment.preview(current.store.get(), profileId)))
  ipcMain.handle('deployProfile', guard((current, args: { profileId: string; confirmConflicts: boolean }) => enqueueMutation(async () => {
    assertWritable(current)
    const result = await current.deployment.deploy(current.store.get(), args.profileId, args.confirmConflicts)
    await current.store.save(result.state)
    return snapshot(current)
  })))
  ipcMain.handle('removeInstalledMod', guard((current, modId: string) => enqueueMutation(async () => {
    assertWritable(current)
    const state = current.store.get()
    if (state.profiles.some((profile) => profile.entries.some((entry) => entry.modId === modId))) throw new AppError('MOD_IN_USE', 'Remove the mod from every profile before uninstalling it.')
    const mod = state.installedMods.find((candidate) => candidate.id === modId)
    if (!mod) throw new AppError('NOT_FOUND', 'Installed mod was not found.')
    await rm(managedModPath(current, mod), { recursive: true, force: true })
    await current.store.save({ ...state, installedMods: state.installedMods.filter((candidate) => candidate.id !== modId) })
    return snapshot(current)
  })))
  ipcMain.handle('openManagedFolder', guard(async (current) => {
    const game = current.store.get().game
    if (!game) throw new AppError('GAME_NOT_FOUND', 'Configure Counter-Strike: Source first.')
    const target = current.store.get().activeDeployment?.targetPath ?? join(game.contentPath, 'custom')
    await shell.openPath(target)
  }))
}

export type { AppContext }
