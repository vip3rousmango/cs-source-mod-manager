import type { ModProviderId, ProviderBrowseRequest, ProviderModDetails, ProviderSearchResult } from '../../shared/contracts'

export interface ProviderDownload {
  provider: ModProviderId
  remoteModId: string
  remoteFileId: string
  name: string
  url: string
  sizeBytes: number
  sourceUrl: string
}

export interface ModProvider {
  readonly id: ModProviderId
  browse(request: Omit<ProviderBrowseRequest, 'provider'>): Promise<ProviderSearchResult>
  getDetails(remoteModId: string): Promise<ProviderModDetails>
  resolveDownload(remoteModId: string, remoteFileId: string): Promise<ProviderDownload>
}
