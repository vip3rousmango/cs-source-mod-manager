import { readFile } from 'node:fs/promises'
import { parseCatalog } from '../../shared/validation'
import type { CatalogManifest } from '../../shared/contracts'
import { AppError } from './errors'

export class CatalogService {
  private manifest: CatalogManifest = { schemaVersion: 1, catalogVersion: 'unknown', entries: [] }

  constructor(private readonly manifestPath: string) {}

  async load(): Promise<CatalogManifest> {
    try {
      this.manifest = parseCatalog(JSON.parse(await readFile(this.manifestPath, 'utf8')))
    } catch (error) {
      throw new AppError('CATALOG_INVALID', 'The bundled catalog is invalid and cannot be used.', error)
    }
    return this.manifest
  }

  get(): CatalogManifest { return this.manifest }

  find(id: string) {
    const entry = this.manifest.entries.find((candidate) => candidate.id === id)
    if (!entry) throw new AppError('NOT_FOUND', `Catalog mod ${id} was not found.`)
    return entry
  }
}
