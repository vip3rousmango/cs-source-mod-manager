import { createReadStream, createWriteStream } from 'node:fs'
import { access, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, dirname, extname, join, relative } from 'node:path'
import yauzl from 'yauzl'
import type { CatalogEntry, InstalledMod, ModSource, ProgressEvent } from '../../shared/contracts'
import { assertSafeRelativePath } from '../../shared/validation'
import { AppError } from './errors'

const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024
const CONTENT_ROOTS = new Set(['materials', 'models', 'sound', 'scripts', 'resource', 'maps', 'cfg', 'particles', 'scenes', 'panorama', 'addons', 'bin', 'expressions', 'media'])
const IGNORED_FILES = new Set(['readme', 'readme.txt', 'license', 'license.txt', 'thumbs.db', '.ds_store'])

export interface ImportOptions {
  libraryRoot: string
  source: ModSource
  modId?: string
  storageId?: string
  storageVersion?: string
  provider?: InstalledMod['provider']
  remoteModId?: string
  remoteFileId?: string
  title?: string
  version?: string
  author?: string
  description?: string
  sourceUrl?: string
  expectedSha256?: string
  expectedSize?: number
  contentRoot?: CatalogEntry['contentRoot']
  signal?: AbortSignal
  emit?: (event: ProgressEvent) => void
}

interface SafeEntry { path: string; directory: boolean; size: number; source: string }

function safeId(title: string): string {
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
  return id || `local-${Date.now()}`
}

async function readEntries(archivePath: string): Promise<SafeEntry[]> {
  return await new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true, autoClose: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error('Cannot open ZIP'))
      const entries: SafeEntry[] = []
      zip.readEntry()
      zip.on('entry', (entry) => {
        try {
          const unixType = (entry.externalFileAttributes >>> 16) & 0o170000
          if (unixType !== 0 && unixType !== 0o040000 && unixType !== 0o100000) throw new AppError('INVALID_ARCHIVE', 'Only regular files and directories are supported in mod archives.')
          const directory = entry.fileName.endsWith('/') || unixType === 0o040000
          const candidatePath = directory && entry.fileName.endsWith('/') ? entry.fileName.slice(0, -1) : entry.fileName
          const path = assertSafeRelativePath(candidatePath)
          entries.push({ path, directory, size: entry.uncompressedSize, source: entry.fileName })
          zip.readEntry()
        } catch (entryError) { zip.close(); reject(entryError) }
      })
      zip.on('end', () => resolve(entries))
      zip.on('error', reject)
    })
  })
}

function storageSegment(value: string, label: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') throw new AppError('INVALID_REQUEST', `${label} contains invalid storage metadata.`)
  return value
}

async function extractEntries(archivePath: string, normalized: SafeEntry[], staging: string, signal?: AbortSignal, emit?: (event: ProgressEvent) => void): Promise<void> {
  const destinations = new Map(normalized.map((entry) => [entry.source, join(staging, entry.path)]))
  await new Promise<void>((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error('Cannot open ZIP'))
      let settled = false
      let extracted = 0
      const fail = (cause: unknown): void => {
        if (settled) return
        settled = true
        zip.close()
        reject(cause)
      }
      const next = (): void => {
        try {
          throwIfAborted(signal)
          zip.readEntry()
        } catch (entryError) {
          fail(entryError)
        }
      }
      zip.on('entry', (entry) => {
        const destination = destinations.get(entry.fileName)
        if (!destination) return next()
        try { throwIfAborted(signal) } catch (entryError) { return fail(entryError) }
        void mkdir(dirname(destination), { recursive: true }).then(() => {
          if (settled) return
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) return fail(streamError ?? new Error('Cannot read ZIP entry'))
            const output = createWriteStream(destination, { flags: 'wx' })
            const abort = (): void => { stream.destroy(new AppError('OPERATION_CANCELLED', 'Operation cancelled. No managed content was changed.')) }
            signal?.addEventListener('abort', abort, { once: true })
            const cleanup = (): void => signal?.removeEventListener('abort', abort)
            stream.on('data', () => {
              if (signal?.aborted) abort()
            })
            stream.on('error', (streamFailure) => { cleanup(); fail(streamFailure) })
            output.on('error', (outputFailure) => { cleanup(); stream.destroy(); fail(outputFailure) })
            output.on('finish', () => {
              cleanup()
              extracted += 1
              emit?.({ operationId: 'import', stage: 'staging', message: `Unpacked ${entry.fileName}`, bytesDone: extracted, bytesTotal: normalized.length })
              next()
            })
            stream.pipe(output)
          })
        }).catch(fail)
      })
      zip.on('end', () => {
        if (!settled) {
          settled = true
          resolve()
        }
      })
      zip.on('error', fail)
      next()
    })
  })
}
async function readEntryText(archivePath: string, sourceName: string, maxBytes = 32 * 1024): Promise<string | undefined> {
  return await new Promise<string | undefined>((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error('Cannot open ZIP'))
      let found = false
      const next = (): void => zip.readEntry()
      zip.on('entry', (entry) => {
        if (entry.fileName !== sourceName) return next()
        found = true
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError ?? new Error('Cannot read ZIP entry'))
          const chunks: Buffer[] = []
          let total = 0
          stream.on('data', (chunk: Buffer) => {
            total += chunk.length
            if (total <= maxBytes) chunks.push(chunk)
          })
          stream.on('end', () => { zip.close(); resolve(Buffer.concat(chunks).toString('utf8').slice(0, maxBytes)) })
          stream.on('error', reject)
        })
      })
      zip.on('end', () => { if (!found) resolve(undefined) })
      zip.on('error', reject)
      next()
    })
  })
}
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AppError('OPERATION_CANCELLED', 'Operation cancelled. No managed content was changed.')
}

function instructionFile(path: string): boolean {
  const name = basename(path).toLowerCase()
  return name.startsWith('readme') || name.startsWith('install') || name.startsWith('instruction') || name.startsWith('note')
}

function normalizeEntries(entries: SafeEntry[], contentRoot: CatalogEntry['contentRoot'] = 'auto'): SafeEntry[] {
  const files = entries.filter((entry) => !entry.directory)
  const meaningful = files.filter((entry) => !IGNORED_FILES.has(basename(entry.path).toLowerCase()))
  if (meaningful.some((entry) => basename(entry.path).toLowerCase() === 'gameinfo.txt')) {
    throw new AppError('INVALID_CONTENT', 'This archive is a complete Source mod; import Counter-Strike: Source custom content instead.')
  }
  const contentCandidates = meaningful.flatMap((entry) => {
    const segments = entry.path.split('/')
    const rootIndex = segments.findIndex((segment) => CONTENT_ROOTS.has(segment.toLowerCase()))
    return rootIndex < 0 ? [] : [{ entry, prefix: segments.slice(0, rootIndex) }]
  })
  if (contentCandidates.length === 0) throw new AppError('INVALID_CONTENT', 'No recognized Counter-Strike: Source content folders were found.')
  if (contentRoot === 'archive-root' && contentCandidates.some((candidate) => candidate.prefix.length > 0)) {
    throw new AppError('INVALID_CONTENT', 'This archive has a wrapper directory. It needs a provider or auto content-root rule before it can be installed.')
  }
  const prefix = contentCandidates[0].prefix
  if (!contentCandidates.every((candidate) => candidate.prefix.join('/') === prefix.join('/'))) {
    throw new AppError('INVALID_CONTENT', 'This archive contains multiple possible Source content roots. Review the mod instructions and import a single game-content folder.')
  }
  const normalized = contentCandidates.map(({ entry }) => ({ ...entry, path: entry.path.split('/').slice(prefix.length).join('/') }))
  const seen = new Set<string>()
  for (const entry of normalized) {
    const key = entry.path.toLowerCase()
    if (seen.has(key)) throw new AppError('INVALID_ARCHIVE', `Archive contains duplicate path ${entry.path}.`)
    seen.add(key)
  }
  return normalized
}

export async function importArchive(archivePath: string, options: ImportOptions): Promise<InstalledMod> {
  throwIfAborted(options.signal)
  const archiveStat = await stat(archivePath).catch(() => undefined)
  if (!archiveStat?.isFile()) throw new AppError('NOT_FOUND', 'The selected archive could not be read.')
  if (archiveStat.size > MAX_ARCHIVE_BYTES) throw new AppError('INVALID_ARCHIVE', 'The archive exceeds the 2 GiB safety limit.')
  if (options.expectedSize !== undefined && archiveStat.size !== options.expectedSize) throw new AppError('CHECKSUM_MISMATCH', 'Downloaded archive size does not match the catalog.')
  if (options.expectedSha256) {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(archivePath)) {
      throwIfAborted(options.signal)
      hash.update(chunk)
    }
    if (hash.digest('hex') !== options.expectedSha256) throw new AppError('CHECKSUM_MISMATCH', 'Downloaded archive checksum does not match the catalog.')
  }
  options.emit?.({ operationId: 'import', stage: 'validating', message: 'Scanning archive structure and safety checks.' })
  const entries = await readEntries(archivePath)
  throwIfAborted(options.signal)
  if (entries.reduce((sum, entry) => sum + entry.size, 0) > MAX_ARCHIVE_BYTES) throw new AppError('INVALID_ARCHIVE', 'Archive contents exceed the 2 GiB safety limit.')
  const normalized = normalizeEntries(entries, options.contentRoot)
  const instructionEntries = entries.filter((entry) => !entry.directory && instructionFile(entry.path)).slice(0, 3)
  const instructionParts = await Promise.all(instructionEntries.map(async (entry) => {
    const text = await readEntryText(archivePath, entry.source)
    return text?.trim() ? `## ${entry.path}\n${text.trim()}` : undefined
  }))
  const installationNotes = instructionParts.filter((part): part is string => Boolean(part)).join('\n\n').slice(0, 96 * 1024) || undefined
  options.emit?.({ operationId: 'import', stage: 'validating', message: `Archive is safe. Found ${normalized.length} content file${normalized.length === 1 ? '' : 's'}${installationNotes ? ' and install notes for review' : ''}.`, bytesDone: normalized.length, bytesTotal: normalized.length })
  await mkdir(options.libraryRoot, { recursive: true })
  const staging = await mkdtemp(join(options.libraryRoot, '.staging-'))
  try {
    options.emit?.({ operationId: 'import', stage: 'staging', message: `Unpacking ${normalized.length} content file${normalized.length === 1 ? '' : 's'} in one pass.`, bytesDone: 0, bytesTotal: normalized.length })
    await extractEntries(archivePath, normalized, staging, options.signal, options.emit)
    options.emit?.({ operationId: 'import', stage: 'staging', message: `Unpacked ${normalized.length} content file${normalized.length === 1 ? '' : 's'}.`, bytesDone: normalized.length, bytesTotal: normalized.length })
    throwIfAborted(options.signal)
    const title = options.title ?? basename(archivePath, extname(archivePath))
    const modId = options.modId ?? safeId(title)
    const storageId = storageSegment(options.storageId ?? modId, 'Mod storage ID')
    const version = options.version ?? 'local'
    const storageVersion = storageSegment(options.storageVersion ?? version, 'Mod storage version')
    const contentPath = join(options.libraryRoot, 'mods', storageId, storageVersion, 'content')
    await rm(contentPath, { recursive: true, force: true })
    await mkdir(dirname(contentPath), { recursive: true })
    await cp(staging, contentPath, { recursive: true, force: false, errorOnExist: true })
    return { id: modId, source: options.source, title, version, author: options.author, description: options.description, contentPath, storageId, provider: options.provider, remoteModId: options.remoteModId, remoteFileId: options.remoteFileId, archivePath: options.source === 'local-zip' || options.source === 'catalog' || options.source === 'provider' ? archivePath : undefined, archiveSha256: options.expectedSha256, installedAt: new Date().toISOString(), sourceUrl: options.sourceUrl, installationNotes }
  } finally { await rm(staging, { recursive: true, force: true }) }
}

export async function importFolder(folderPath: string, options: Omit<ImportOptions, 'source'>): Promise<InstalledMod> {
  throwIfAborted(options.signal)
  const folderStat = await stat(folderPath).catch(() => undefined)
  if (!folderStat?.isDirectory()) throw new AppError('NOT_FOUND', 'The selected mod folder could not be read.')
  const entries = await readdir(folderPath, { withFileTypes: true })
  const roots = entries.filter((entry) => entry.isDirectory() && CONTENT_ROOTS.has(entry.name.toLowerCase()))
  if (roots.length === 0) throw new AppError('INVALID_CONTENT', 'The selected folder has no recognized Source content roots.')
  const noteEntry = entries.find((entry) => entry.isFile() && instructionFile(entry.name))
  const installationNotes = noteEntry ? (await readFile(join(folderPath, noteEntry.name), 'utf8').catch(() => '')).slice(0, 96 * 1024).trim() || undefined : undefined
  options.emit?.({ operationId: 'import', stage: 'validating', message: `Folder is safe. Found ${roots.length} recognized content root${roots.length === 1 ? '' : 's'}${installationNotes ? ' and install notes for review' : ''}.`, bytesDone: 0, bytesTotal: 1 })
  const title = options.title ?? basename(folderPath)
  const contentPath = join(options.libraryRoot, 'mods', safeId(title), options.version ?? 'local', 'content')
  const temporaryPath = `${contentPath}.importing-${Date.now()}`
  const backupPath = `${contentPath}.backup-${Date.now()}`
  await rm(temporaryPath, { recursive: true, force: true })
  await rm(backupPath, { recursive: true, force: true })
  await mkdir(dirname(contentPath), { recursive: true })
  try {
    throwIfAborted(options.signal)
    options.emit?.({ operationId: 'import', stage: 'staging', message: 'Copying extracted content into managed storage.', bytesDone: 0, bytesTotal: 1 })
    await cp(folderPath, temporaryPath, { recursive: true, force: false, errorOnExist: true })
    throwIfAborted(options.signal)
    const previousExists = await stat(contentPath).then(() => true, () => false)
    if (previousExists) await rename(contentPath, backupPath)
    await rename(temporaryPath, contentPath)
    await rm(backupPath, { recursive: true, force: true })
    options.emit?.({ operationId: 'import', stage: 'staging', message: 'Managed content is ready.', bytesDone: 1, bytesTotal: 1 })
  } catch (error) {
    await rm(temporaryPath, { recursive: true, force: true })
    const currentExists = await stat(contentPath).then(() => true, () => false)
    const backupExists = await stat(backupPath).then(() => true, () => false)
    if (!currentExists && backupExists) await rename(backupPath, contentPath)
    throw error
  }
  return { id: safeId(title), source: 'local-folder', title, version: options.version ?? 'local', contentPath, installedAt: new Date().toISOString(), installationNotes }
}
