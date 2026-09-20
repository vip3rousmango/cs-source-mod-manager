import type { ModProviderId, ProviderBrowseRequest, ProviderModDetails, ProviderSearchResult, SourceGameId } from '../../shared/contracts'

export interface ProviderDownload {
  provider: ModProviderId
  remoteModId: string
  remoteFileId: string
  name: string
  url: string
  sizeBytes: number
  checksumMd5?: string
  sourceUrl: string
}

export interface ModProvider {
  readonly id: ModProviderId
  browse(request: Omit<ProviderBrowseRequest, 'provider'>): Promise<ProviderSearchResult>
  getDetails(remoteModId: string, gameId?: SourceGameId): Promise<ProviderModDetails>
  resolveDownload(remoteModId: string, remoteFileId: string, gameId?: SourceGameId): Promise<ProviderDownload>
}
