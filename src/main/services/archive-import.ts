import { createReadStream, createWriteStream } from 'node:fs'
import { access, cp, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
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
  title?: string
  version?: string
  author?: string
  description?: string
  sourceUrl?: string
  expectedSha256?: string
  expectedSize?: number
  contentRoot?: CatalogEntry['contentRoot']
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
          const path = assertSafeRelativePath(entry.fileName)
          const directory = path.endsWith('/')
          const unixType = (entry.externalFileAttributes >>> 16) & 0o170000
          if (unixType === 0o120000) throw new AppError('INVALID_ARCHIVE', 'Symbolic links are not supported in mod archives.')
          entries.push({ path: directory ? path.slice(0, -1) : path, directory, size: entry.uncompressedSize, source: entry.fileName })
          zip.readEntry()
        } catch (entryError) { zip.close(); reject(entryError) }
      })
      zip.on('end', () => resolve(entries))
      zip.on('error', reject)
    })
  })
}

async function extractEntry(archivePath: string, sourceName: string, destination: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error ?? new Error('Cannot open ZIP'))
      const next = (): void => zip.readEntry()
      zip.on('entry', (entry) => {
        if (entry.fileName !== sourceName) return next()
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError ?? new Error('Cannot read ZIP entry'))
          const target = createWriteStream(destination, { flags: 'wx' })
          stream.pipe(target)
          target.on('finish', () => { zip.close(); resolve() })
          target.on('error', reject)
        })
      })
      zip.on('end', () => reject(new Error(`ZIP entry ${sourceName} not found`)))
      zip.on('error', reject)
      next()
    })
  })
}

function normalizeEntries(entries: SafeEntry[], contentRoot: CatalogEntry['contentRoot'] = 'auto'): SafeEntry[] {
  const files = entries.filter((entry) => !entry.directory)
  const meaningful = files.filter((entry) => !IGNORED_FILES.has(basename(entry.path).toLowerCase()))
  if (meaningful.some((entry) => basename(entry.path).toLowerCase() === 'gameinfo.txt')) {
    throw new AppError('INVALID_CONTENT', 'This archive is a complete Source mod; import Counter-Strike: Source custom content instead.')
  }
  const topRoots = new Set(meaningful.map((entry) => entry.path.split('/')[0].toLowerCase()))
  let strip = ''
  if (contentRoot === 'single-directory' || (contentRoot === 'auto' && topRoots.size === 1 && ![...topRoots].some((root) => CONTENT_ROOTS.has(root)))) {
    strip = [...topRoots][0] ?? ''
  }
  const normalized = meaningful.map((entry) => ({ ...entry, path: strip && entry.path.startsWith(`${strip}/`) ? entry.path.slice(strip.length + 1) : entry.path }))
  if (!normalized.some((entry) => CONTENT_ROOTS.has(entry.path.split('/')[0].toLowerCase()))) {
    throw new AppError('INVALID_CONTENT', 'No recognized Counter-Strike: Source content folders were found.')
  }
  const seen = new Set<string>()
  for (const entry of normalized) {
    const key = entry.path.toLowerCase()
    if (seen.has(key)) throw new AppError('INVALID_ARCHIVE', `Archive contains duplicate path ${entry.path}.`)
    seen.add(key)
  }
  return normalized
}

export async function importArchive(archivePath: string, options: ImportOptions): Promise<InstalledMod> {
  const archiveStat = await stat(archivePath).catch(() => undefined)
  if (!archiveStat?.isFile()) throw new AppError('NOT_FOUND', 'The selected archive could not be read.')
  if (archiveStat.size > MAX_ARCHIVE_BYTES) throw new AppError('INVALID_ARCHIVE', 'The archive exceeds the 2 GiB safety limit.')
  if (options.expectedSize !== undefined && archiveStat.size !== options.expectedSize) throw new AppError('CHECKSUM_MISMATCH', 'Downloaded archive size does not match the catalog.')
  if (options.expectedSha256) {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(archivePath)) hash.update(chunk)
    if (hash.digest('hex') !== options.expectedSha256) throw new AppError('CHECKSUM_MISMATCH', 'Downloaded archive checksum does not match the catalog.')
  }
  options.emit?.({ operationId: 'import', stage: 'validating', message: 'Validating archive' })
  const entries = await readEntries(archivePath)
  if (entries.reduce((sum, entry) => sum + entry.size, 0) > MAX_ARCHIVE_BYTES) throw new AppError('INVALID_ARCHIVE', 'Archive contents exceed the 2 GiB safety limit.')
  const normalized = normalizeEntries(entries, options.contentRoot)
  const staging = await mkdtemp(join(options.libraryRoot, '.staging-'))
  try {
    for (const entry of normalized) {
      const target = join(staging, entry.path)
      await mkdir(dirname(target), { recursive: true })
      const original = entries.find((candidate) => candidate.path === entry.source)
      if (!original) throw new AppError('INVALID_ARCHIVE', 'Archive entry disappeared during validation.')
      await extractEntry(archivePath, original.source, target)
    }
    const title = options.title ?? basename(archivePath, extname(archivePath))
    const modId = safeId(title)
    const version = options.version ?? 'local'
    const contentPath = join(options.libraryRoot, 'mods', modId, version, 'content')
    await rm(contentPath, { recursive: true, force: true })
    await mkdir(dirname(contentPath), { recursive: true })
    await cp(staging, contentPath, { recursive: true, force: false, errorOnExist: true })
    return { id: modId, source: options.source, title, version, author: options.author, description: options.description, contentPath, archivePath: options.source === 'local-zip' || options.source === 'catalog' ? archivePath : undefined, archiveSha256: options.expectedSha256, installedAt: new Date().toISOString(), sourceUrl: options.sourceUrl }
  } finally { await rm(staging, { recursive: true, force: true }) }
}

export async function importFolder(folderPath: string, options: Omit<ImportOptions, 'source'>): Promise<InstalledMod> {
  const folderStat = await stat(folderPath).catch(() => undefined)
  if (!folderStat?.isDirectory()) throw new AppError('NOT_FOUND', 'The selected mod folder could not be read.')
  const entries = await readdir(folderPath, { withFileTypes: true })
  const roots = entries.filter((entry) => entry.isDirectory() && CONTENT_ROOTS.has(entry.name.toLowerCase()))
  if (roots.length === 0) throw new AppError('INVALID_CONTENT', 'The selected folder has no recognized Source content roots.')
  const title = options.title ?? basename(folderPath)
  const contentPath = join(options.libraryRoot, 'mods', safeId(title), options.version ?? 'local', 'content')
  await rm(contentPath, { recursive: true, force: true })
  await mkdir(dirname(contentPath), { recursive: true })
  await cp(folderPath, contentPath, { recursive: true, force: false, errorOnExist: true })
  return { id: safeId(title), source: 'local-folder', title, version: options.version ?? 'local', contentPath, installedAt: new Date().toISOString() }
}
