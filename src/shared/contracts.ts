export type GameId = 'counter-strike-source'
export type ModSource = 'catalog' | 'provider' | 'local-folder' | 'local-zip'
export type ModProviderId = 'gamebanana'
export type SourceGameId = GameId | 'half-life-2' | 'day-of-defeat-source' | 'brainbread-source'
export const SOURCE_GAMES: ReadonlyArray<{ id: SourceGameId; label: string; gameBananaId: number; installable: boolean }> = [
  { id: 'counter-strike-source', label: 'Counter-Strike: Source', gameBananaId: 2, installable: true },
  { id: 'half-life-2', label: 'Half-Life 2', gameBananaId: 9, installable: false },
  { id: 'day-of-defeat-source', label: 'Day of Defeat: Source', gameBananaId: 10, installable: false },
  { id: 'brainbread-source', label: 'BrainBread: Source', gameBananaId: 500, installable: false }
]

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
  storageId?: string
  provider?: ModProviderId
  remoteModId?: string
  remoteFileId?: string
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

export interface ProviderBrowseRequest {
  provider: ModProviderId
  query: string
  page: number
  perPage: number
  gameId?: SourceGameId
  forceRefresh?: boolean
}

export type ProviderFileStatus = 'installable' | 'unsupported-format' | 'archived' | 'scan-pending' | 'scan-failed' | 'checksum-missing' | 'permission-denied'

export interface ProviderFile {
  id: string
  name: string
  sizeBytes: number
  format: 'zip' | 'rar' | '7z' | 'other'
  version?: string
  installable: boolean
  status: ProviderFileStatus
  checksumMd5?: string
}

export interface ProviderModSummary {
  provider: ModProviderId
  gameId: SourceGameId
  remoteModId: string
  title: string
  author?: string
  description: string
  tags: string[]
  category?: string
  sourceUrl: string
  previewImageUrl?: string
  hasFiles: boolean
}

export interface ProviderSearchResult {
  provider: ModProviderId
  query: string
  page: number
  perPage: number
  total: number
  hasMore: boolean
  mods: ProviderModSummary[]
}

export interface ProviderModDetails extends ProviderModSummary {
  body: string
  license?: string
  files: ProviderFile[]
}
export interface ModPackEntry {
  provider: ModProviderId
  remoteModId: string
  remoteFileId: string
  title: string
}

export interface ModPack {
  id: string
  name: string
  gameId: GameId
  entries: ModPackEntry[]
  createdAt: string
  updatedAt: string
}
export interface ServerCacheItem {
  relativePath: string
  sizeBytes: number
  modifiedAt: string
  kind: 'file' | 'directory'
}

export interface ServerCacheSnapshot {
  available: boolean
  rootPath?: string
  totalBytes: number
  items: ServerCacheItem[]
  truncated: boolean
}

export type CommunityFeedId = 'steam-news' | 'gamebanana-feed' | 'moddb-downloads' | 'moddb-articles' | 'moddb-addons' | 'valve-developer'
export type CommunityFeedStatus = 'ok' | 'error'
export interface CommunityFeedSource {
  id: CommunityFeedId
  label: string
  description: string
  feedUrl: string
  siteUrl: string
}
export interface CommunityFeedState extends CommunityFeedSource {
  status: CommunityFeedStatus
  itemCount: number
  error?: string
}
export interface CommunityNewsItem {
  id: string
  feedId: CommunityFeedId
  sourceLabel: string
  title: string
  summary: string
  url: string
  publishedAt?: string
}
export interface CommunityNewsSnapshot {
  refreshedAt: string
  items: CommunityNewsItem[]
  feeds: CommunityFeedState[]
}

export interface AppState {
  schemaVersion: 1
  settings: { catalogVersion?: string }
  game?: GameInstallation
  installedMods: InstalledMod[]
  profiles: ModProfile[]
  modPacks?: ModPack[]
  activeDeployment?: DeploymentManifest
  activity: ActivityRecord[]
}

export interface PackInstallFailure {
  title: string
  message: string
}

export interface PackInstallSummary {
  packId: string
  completed: number
  failures: PackInstallFailure[]
}

export interface Snapshot extends AppState {
  catalog: CatalogManifest
  recoveryRequired?: string
  packInstall?: PackInstallSummary
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
  browseProvider(request: ProviderBrowseRequest): Promise<ProviderSearchResult>
  getProviderMod(provider: ModProviderId, remoteModId: string, gameId?: SourceGameId): Promise<ProviderModDetails>
  installProviderMod(provider: ModProviderId, remoteModId: string, remoteFileId: string): Promise<Snapshot>
  createModPack(name: string, entries: ModPackEntry[]): Promise<Snapshot>
  installModPack(packId: string): Promise<Snapshot>
  importLocalMod(): Promise<Snapshot>
  createProfile(name: string): Promise<Snapshot>
  updateProfile(profile: ModProfile): Promise<Snapshot>
  previewProfile(profileId: string): Promise<DeploymentPreview>
  deployProfile(profileId: string, confirmConflicts: boolean): Promise<Snapshot>
  removeInstalledMod(modId: string): Promise<Snapshot>
  openManagedFolder(): Promise<void>
  shareInstalledMod(modId: string): Promise<void>
  getServerCache(): Promise<ServerCacheSnapshot>
  cleanServerCache(confirm: boolean): Promise<ServerCacheSnapshot>
  getCommunityNews(forceRefresh?: boolean): Promise<CommunityNewsSnapshot>
  openExternal(url: string): Promise<void>
  subscribeToProgress(listener: (event: ProgressEvent) => void): () => void
}

declare global {
  interface Window {
    csmm: IPCAPI
  }
}
