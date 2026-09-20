import { readdir, mkdir, rm, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { GameInstallation, ServerCacheItem, ServerCacheSnapshot } from '../../shared/contracts'

const MAX_ITEMS = 5000

export class ServerCacheService {
  async scan(game?: GameInstallation): Promise<ServerCacheSnapshot> {
    if (!game) return { available: false, totalBytes: 0, items: [], truncated: false }
    const rootPath = join(game.contentPath, 'download')
    const items: ServerCacheItem[] = []
    let totalBytes = 0
    let truncated = false

    const addItem = (item: ServerCacheItem): void => {
      if (items.length < MAX_ITEMS) items.push(item)
      else truncated = true
    }

    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        const fullPath = join(directory, entry.name)
        const info = await stat(fullPath)
        const relativePath = relative(rootPath, fullPath).replaceAll('\\', '/')
        if (entry.isDirectory()) {
          addItem({ relativePath, sizeBytes: 0, modifiedAt: info.mtime.toISOString(), kind: 'directory' })
          await visit(fullPath)
        } else if (entry.isFile()) {
          totalBytes += info.size
          addItem({ relativePath, sizeBytes: info.size, modifiedAt: info.mtime.toISOString(), kind: 'file' })
        }
      }
    }

    await visit(rootPath)
    return { available: true, rootPath, totalBytes, items, truncated }
  }

  async clean(game?: GameInstallation): Promise<ServerCacheSnapshot> {
    if (!game) return { available: false, totalBytes: 0, items: [], truncated: false }
    const rootPath = join(game.contentPath, 'download')
    await rm(rootPath, { recursive: true, force: true })
    await mkdir(rootPath, { recursive: true })
    return this.scan(game)
  }
}
