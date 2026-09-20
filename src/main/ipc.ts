import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { createWriteStream } from 'node:fs'
import { access, mkdir, rename, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppState, IPCAPI, ModProfile, ProgressEvent, Snapshot } from '../shared/contracts'
import { parseProfile } from '../shared/validation'
import { AppError, toAppError } from './services/errors'
import { StateStore } from './services/state-store'
import { SteamDiscoveryService } from './services/steam-discovery'
import { CatalogService } from './services/catalog'
import { DeploymentService } from './services/deployment'
import { importArchive, importFolder } from './services/archive-import'

interface AppContext {
  window: BrowserWindow
  store: StateStore
  steam: SteamDiscoveryService
  catalog: CatalogService
  deployment: DeploymentService
  libraryRoot: string
  emit: (event: ProgressEvent) => void
}

async function pathExists(path: string): Promise<boolean> { try { await access(path); return true } catch { return false } }

function ensureSender(event: Electron.IpcMainInvokeEvent, context: AppContext): void {
  if (event.sender !== context.window.webContents) throw new AppError('INVALID_REQUEST', 'Invalid IPC sender.')
}

function snapshot(context: AppContext): Snapshot {
  return { ...context.store.get(), catalog: context.catalog.get(), recoveryRequired: context.store.getRecoveryMessage() }
}

function assertWritable(context: AppContext): void {
  if (context.store.getRecoveryMessage()) throw new AppError('RECOVERY_REQUIRED', context.store.getRecoveryMessage()!)
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
  const installed = await importArchive(archivePath, { libraryRoot: context.libraryRoot, source: 'catalog', title: entry.title, version: entry.version, author: entry.author, description: entry.description, sourceUrl: entry.sourcePageUrl, expectedSha256: entry.archiveSha256, expectedSize: entry.archiveSizeBytes, contentRoot: entry.contentRoot, emit: context.emit })
  const state = context.store.get()
  const existing = state.installedMods.filter((mod) => mod.id !== installed.id)
  await context.store.save({ ...state, installedMods: [...existing, installed], settings: { catalogVersion: context.catalog.get().catalogVersion } })
  return snapshot(context)
}

export function registerIpc(context: AppContext): void {
  const guard = <T>(handler: (context: AppContext, value: T) => Promise<unknown> | unknown) => async (event: Electron.IpcMainInvokeEvent, value: T) => {
    try { ensureSender(event, context); return await handler(context, value) } catch (error) { throw toAppError(error).toShape() }
  }
  ipcMain.handle('getSnapshot', guard((_context) => snapshot(context)))
  ipcMain.handle('discoverGame', guard(async (current) => {
    assertWritable(current)
    const candidates = await current.steam.discover()
    if (!candidates[0]) throw new AppError('GAME_NOT_FOUND', 'Counter-Strike: Source was not found in the configured Steam libraries.')
    const state = current.store.get()
    await current.store.save({ ...state, game: candidates[0] })
    return snapshot(current)
  }))
  ipcMain.handle('chooseGameDirectory', guard(async (current) => {
    assertWritable(current)
    const result = await dialog.showOpenDialog(current.window, { properties: ['openDirectory'], title: 'Choose Counter-Strike: Source' })
    if (result.canceled || !result.filePaths[0]) return snapshot(current)
    const game = await current.steam.validateDirectory(result.filePaths[0])
    const state = current.store.get()
    await current.store.save({ ...state, game })
    return snapshot(current)
  }))
  ipcMain.handle('refreshCatalog', guard((current) => snapshot(current)))
  ipcMain.handle('installCatalogMod', guard((current, id: string) => { assertWritable(current); return downloadCatalogArchive(current, id) }))
  ipcMain.handle('importLocalMod', guard(async (current) => {
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
  }))
  ipcMain.handle('createProfile', guard(async (current, name: string) => {
    assertWritable(current)
    if (!name?.trim()) throw new AppError('INVALID_REQUEST', 'Profile name cannot be empty.')
    const now = new Date().toISOString()
    const profile: ModProfile = { id: `profile-${Date.now()}`, name: name.trim(), gameId: 'counter-strike-source', entries: [], updatedAt: now }
    const state = current.store.get()
    await current.store.save({ ...state, profiles: [...state.profiles, profile] })
    return snapshot(current)
  }))
  ipcMain.handle('updateProfile', guard(async (current, value: unknown) => {
    assertWritable(current)
    const profile = parseProfile(value)
    const state = current.store.get()
    if (!state.profiles.some((candidate) => candidate.id === profile.id)) throw new AppError('NOT_FOUND', 'Profile was not found.')
    await current.store.save({ ...state, profiles: state.profiles.map((candidate) => candidate.id === profile.id ? profile : candidate) })
    return snapshot(current)
  }))
  ipcMain.handle('previewProfile', guard((current, profileId: string) => current.deployment.preview(current.store.get(), profileId)))
  ipcMain.handle('deployProfile', guard(async (current, args: { profileId: string; confirmConflicts: boolean }) => {
    assertWritable(current)
    const result = await current.deployment.deploy(current.store.get(), args.profileId, args.confirmConflicts)
    await current.store.save(result.state)
    return snapshot(current)
  }))
  ipcMain.handle('removeInstalledMod', guard(async (current, modId: string) => {
    assertWritable(current)
    const state = current.store.get()
    if (state.profiles.some((profile) => profile.entries.some((entry) => entry.modId === modId))) throw new AppError('MOD_IN_USE', 'Remove the mod from every profile before uninstalling it.')
    const mod = state.installedMods.find((candidate) => candidate.id === modId)
    if (!mod) throw new AppError('NOT_FOUND', 'Installed mod was not found.')
    await rm(join(current.libraryRoot, 'mods', mod.id), { recursive: true, force: true })
    await current.store.save({ ...state, installedMods: state.installedMods.filter((candidate) => candidate.id !== modId) })
    return snapshot(current)
  }))
  ipcMain.handle('openManagedFolder', guard(async (current) => {
    const game = current.store.get().game
    if (!game) throw new AppError('GAME_NOT_FOUND', 'Configure Counter-Strike: Source first.')
    const target = current.store.get().activeDeployment?.targetPath ?? join(game.contentPath, 'custom')
    await shell.openPath(target)
  }))
}

export type { AppContext }
