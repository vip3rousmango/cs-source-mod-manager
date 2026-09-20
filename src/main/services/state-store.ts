import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AppState } from '../../shared/contracts'
import { AppError } from './errors'

const emptyState: AppState = {
  schemaVersion: 1,
  settings: {},
  installedMods: [],
  profiles: [],
  modPacks: [],
  activity: []
}

export class StateStore {
  private state: AppState = structuredClone(emptyState)
  private recoveryMessage?: string

  constructor(private readonly filePath: string) {}

  async load(): Promise<AppState> {
    await mkdir(dirname(this.filePath), { recursive: true })
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as AppState
      if (parsed.schemaVersion !== 1) {
        throw new AppError('RECOVERY_REQUIRED', 'State schema is not supported; preserve the state file before recovery.', { schemaVersion: parsed.schemaVersion })
      }
      const interruptedAt = new Date().toISOString()
      const activity = (parsed.activity ?? []).map((item) => item.status === 'running'
        ? { ...item, status: 'failure' as const, message: 'Operation was interrupted before completion.', finishedAt: interruptedAt }
        : item)
      this.state = { ...parsed, modPacks: parsed.modPacks ?? [], activity }
      if (activity.some((item, index) => item !== (parsed.activity ?? [])[index])) await this.save(this.state)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.state = structuredClone(emptyState)
        await this.save()
      } else {
        this.recoveryMessage = error instanceof AppError ? error.message : 'The saved state could not be read safely.'
        this.state = structuredClone(emptyState)
      }
    }
    return structuredClone(this.state)
  }

  get(): AppState {
    return structuredClone(this.state)
  }

  getRecoveryMessage(): string | undefined {
    return this.recoveryMessage
  }

  async save(next: AppState = this.state): Promise<void> {
    if (next.schemaVersion !== 1) {
      throw new AppError('RECOVERY_REQUIRED', 'Refusing to write an unsupported state schema.')
    }
    const temporaryPath = join(dirname(this.filePath), `.state-${process.pid}-${Date.now()}.tmp`)
    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(temporaryPath, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, this.filePath)
    this.state = structuredClone(next)
  }

  async resetForTests(): Promise<void> {
    await rm(this.filePath, { force: true })
    this.state = structuredClone(emptyState)
  }
}
