export type GameId = 'counter-strike-source'
export type ModSource = 'catalog' | 'local-folder' | 'local-zip'

export interface GameInstallation {
  gameId: GameId
  steamRoot: string
  installPath: string
  contentPath: string
  detectedAt: string
}

export interface InstalledMod {
  id: string
  source: ModSource
  title: string
  version: string
  author?: string
  description?: string
  contentPath: string
  archivePath?: string
  archiveSha256?: string
  installedAt: string
  sourceUrl?: string
}

export interface ProfileEntry {
  modId: string
  enabled: boolean
  priority: number
}

export interface ModProfile {
  id: string
  name: string
  gameId: GameId
  entries: ProfileEntry[]
  updatedAt: string
}

export interface DeploymentFile {
  relativePath: string
  ownerModId: string
  sha256: string
}

export interface DeploymentManifest {
  profileId: string
  gameId: GameId
  targetPath: string
  deployedAt: string
  files: DeploymentFile[]
  conflicts: Array<{ relativePath: string; winnerModId: string; loserModIds: string[] }>
}

export interface CatalogEntry {
  id: string
  title: string
  version: string
  author?: string
  description: string
  tags: string[]
  archiveUrl: string
  archiveSha256: string
  archiveSizeBytes: number
  sourcePageUrl?: string
  contentRoot: 'auto' | 'archive-root' | 'single-directory'
}

export interface CatalogManifest {
  schemaVersion: 1
  catalogVersion: string
  entries: CatalogEntry[]
}

export interface AppState {
  schemaVersion: 1
  settings: { catalogVersion?: string }
  game?: GameInstallation
  installedMods: InstalledMod[]
  profiles: ModProfile[]
  activeDeployment?: DeploymentManifest
  activity: ActivityRecord[]
}

export interface Snapshot extends AppState {
  catalog: CatalogManifest
  recoveryRequired?: string
}

export type ActivityStatus = 'running' | 'success' | 'failure'
export interface ActivityRecord {
  id: string
  operation: string
  status: ActivityStatus
  message: string
  startedAt: string
  finishedAt?: string
  bytesDone?: number
  bytesTotal?: number
}

export type ProgressStage = 'discovering' | 'downloading' | 'validating' | 'staging' | 'deploying' | 'recovering'
export interface ProgressEvent {
  operationId: string
  stage: ProgressStage
  message: string
  bytesDone?: number
  bytesTotal?: number
}

export type AppErrorCode =
  | 'INVALID_REQUEST'
  | 'GAME_NOT_FOUND'
  | 'INVALID_GAME_DIRECTORY'
  | 'CATALOG_INVALID'
  | 'NETWORK_ERROR'
  | 'CHECKSUM_MISMATCH'
  | 'UNSUPPORTED_FORMAT'
  | 'INVALID_ARCHIVE'
  | 'INVALID_CONTENT'
  | 'CONFLICT_CONFIRMATION_REQUIRED'
  | 'PROFILE_INVALID'
  | 'PERMISSION_DENIED'
  | 'DEPLOYMENT_INTERRUPTED'
  | 'RECOVERY_REQUIRED'
  | 'MOD_IN_USE'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR'

export interface AppErrorShape {
  code: AppErrorCode
  message: string
  details?: unknown
}

export interface ConflictPreview {
  conflicts: Array<{ relativePath: string; winnerModId: string; loserModIds: string[] }>
  missingModIds: string[]
  disabledModIds: string[]
}

export interface DeploymentPreview extends ConflictPreview {
  profileId: string
  fileCount: number
}

export interface OperationResult<T = undefined> {
  ok: true
  value: T
}

export interface IPCAPI {
  getSnapshot(): Promise<Snapshot>
  discoverGame(): Promise<Snapshot>
  chooseGameDirectory(): Promise<Snapshot>
  refreshCatalog(): Promise<Snapshot>
  installCatalogMod(id: string): Promise<Snapshot>
  importLocalMod(): Promise<Snapshot>
  createProfile(name: string): Promise<Snapshot>
  updateProfile(profile: ModProfile): Promise<Snapshot>
  previewProfile(profileId: string): Promise<DeploymentPreview>
  deployProfile(profileId: string, confirmConflicts: boolean): Promise<Snapshot>
  removeInstalledMod(modId: string): Promise<Snapshot>
  openManagedFolder(): Promise<void>
  subscribeToProgress(listener: (event: ProgressEvent) => void): () => void
}

declare global {
  interface Window {
    csmm: IPCAPI
  }
}
