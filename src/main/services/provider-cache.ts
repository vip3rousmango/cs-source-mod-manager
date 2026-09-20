import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface CacheEnvelope<T> {
  expiresAt: number
  value: T
}

export class ProviderCacheService {
  constructor(private readonly rootPath: string, private readonly ttlMs = 5 * 60 * 1000) {}

  async get<T>(key: string): Promise<T | undefined> {
    const memory = this.memory.get(key)
    if (memory) {
      if (memory.expiresAt > Date.now()) return memory.value as T
      this.memory.delete(key)
    }
    const filePath = this.filePath(key)
    try {
      const envelope = JSON.parse(await readFile(filePath, 'utf8')) as CacheEnvelope<T>
      if (!envelope || typeof envelope.expiresAt !== 'number' || envelope.expiresAt <= Date.now()) {
        await rm(filePath, { force: true })
        return undefined
      }
      this.memory.set(key, envelope)
      return envelope.value
    } catch {
      return undefined
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    const envelope: CacheEnvelope<T> = { expiresAt: Date.now() + this.ttlMs, value }
    this.memory.set(key, envelope)
    await mkdir(this.rootPath, { recursive: true })
    const filePath = this.filePath(key)
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporaryPath, JSON.stringify(envelope), { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, filePath)
  }

  async clear(): Promise<void> {
    this.memory.clear()
    await rm(this.rootPath, { recursive: true, force: true })
  }

  private readonly memory = new Map<string, CacheEnvelope<unknown>>()

  private filePath(key: string): string {
    const digest = createHash('sha256').update(key).digest('hex')
    return join(this.rootPath, `${digest}.json`)
  }
}
