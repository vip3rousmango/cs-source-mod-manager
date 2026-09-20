import type { ProviderBrowseRequest, ProviderFile, ProviderModDetails, ProviderModSummary, ProviderSearchResult } from '../../shared/contracts'
import { AppError } from '../services/errors'
import type { ModProvider, ProviderDownload } from './mod-provider'

const GAME_ID = 2
const API_ROOT = 'https://gamebanana.com/apiv11'

interface RecordValue { [key: string]: unknown }

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' ? value as RecordValue : {}
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function plainText(value: unknown, maxLength = 4000): string {
  return (stringValue(value) ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

function sourceUrl(id: string, value: unknown): string {
  const candidate = stringValue(value)
  return candidate?.startsWith('https://') ? candidate : `https://gamebanana.com/mods/${encodeURIComponent(id)}`
}

function previewImage(value: unknown): string | undefined {
  const images = record(record(value)._aPreviewMedia)._aImages
  if (!Array.isArray(images)) return undefined
  const image = record(images[0])
  const base = stringValue(image._sBaseUrl)
  const file = stringValue(image._sFile530 ?? image._sFile220 ?? image._sFile)
  return base && file ? `${base}/${file}` : undefined
}

function tags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((tag) => typeof tag === 'string' ? tag : stringValue(record(tag)._sName)).filter((tag): tag is string => Boolean(tag))
}

function isCssRecord(value: unknown): boolean {
  return numberValue(record(record(value)._aGame)._idRow) === GAME_ID
}

function summary(value: unknown): ProviderModSummary | undefined {
  const item = record(value)
  const id = numberValue(item._idRow)
  const title = stringValue(item._sName)
  if (id === undefined || !title || !isCssRecord(item)) return undefined
  const category = stringValue(record(item._aRootCategory)._sName)
  return {
    provider: 'gamebanana',
    remoteModId: String(id),
    title,
    author: stringValue(record(item._aSubmitter)._sName),
    description: plainText(item._sDescription),
    tags: tags(item._aTags),
    category,
    sourceUrl: sourceUrl(String(id), item._sProfileUrl),
    previewImageUrl: previewImage(item),
    hasFiles: item._bHasFiles === true
  }
}

function file(value: unknown, canInstall: boolean): ProviderFile | undefined {
  const item = record(value)
  const id = numberValue(item._idRow)
  const name = stringValue(item._sFile)
  if (id === undefined || !name) return undefined
  const format = name.toLowerCase().endsWith('.zip') ? 'zip' : name.toLowerCase().endsWith('.rar') ? 'rar' : name.toLowerCase().endsWith('.7z') ? '7z' : 'other'
  const status = [stringValue(item._sAvResult), stringValue(item._sAnalysisResult)].filter(Boolean).join(' · ') || 'Unscanned'
  return { id: String(id), name, sizeBytes: numberValue(item._nFilesize) ?? 0, format, version: stringValue(item._sVersion), installable: canInstall && format === 'zip' && item._bIsArchived !== true && item._sAvResult === 'clean' && item._sAnalysisResult === 'ok', status }
}

async function fetchJson(url: string): Promise<RecordValue> {
  const response = await fetch(url)
  if (!response.ok) throw new AppError('NETWORK_ERROR', `GameBanana API returned HTTP ${response.status}.`)
  const body = await response.json().catch(() => undefined)
  if (!body || typeof body !== 'object') throw new AppError('NETWORK_ERROR', 'GameBanana returned an invalid API response.')
  return body as RecordValue
}

export class GameBananaProvider implements ModProvider {
  readonly id = 'gamebanana' as const
  async browse(request: Omit<ProviderBrowseRequest, 'provider'>): Promise<ProviderSearchResult> {
    const page = Math.max(1, Math.floor(request.page))
    const perPage = Math.min(30, Math.max(1, Math.floor(request.perPage)))
    const query = request.query.trim()
    const params = query
      ? new URLSearchParams({ _sSearchString: query, _sModelName: 'Mod', _idGameRow: String(GAME_ID), _nPage: String(page), _nPerpage: String(perPage) })
      : new URLSearchParams({ _nPage: String(page), _nPerpage: String(perPage), '_aFilters[Generic_Game]': String(GAME_ID), _sSort: 'Generic_LatestUpdated' })
    const payload = await fetchJson(`${API_ROOT}/${query ? 'Util/Search/Results' : 'Mod/Index'}?${params.toString()}`)
    const metadata = record(payload._aMetadata)
    const records = Array.isArray(payload._aRecords) ? payload._aRecords : []
    const mods = records.map(summary).filter((item): item is ProviderModSummary => Boolean(item))
    const total = numberValue(metadata._nRecordCount) ?? mods.length
    return { provider: 'gamebanana', query: request.query, page, perPage, total, hasMore: metadata._bIsComplete !== true && page * perPage < total, mods }
  }

  async getDetails(remoteModId: string): Promise<ProviderModDetails> {
    if (!/^\d+$/.test(remoteModId)) throw new AppError('INVALID_REQUEST', 'Invalid GameBanana mod ID.')
    const payload = await fetchJson(`${API_ROOT}/Mod/${encodeURIComponent(remoteModId)}/ProfilePage`)
    const base = summary(payload)
    if (!base) throw new AppError('NOT_FOUND', 'The GameBanana mod was not found for Counter-Strike: Source.')
    const checklist = payload._aLicenseChecklist
    const checklistRecord = record(checklist)
    const checklistItems: unknown[] = Array.isArray(checklist)
      ? checklist
      : [
          ...(Array.isArray(checklistRecord.yes) ? checklistRecord.yes : []),
          ...(Array.isArray(checklistRecord.no) ? checklistRecord.no : [])
        ]
    const canInstall = checklistItems.some((item) => {
      const value = typeof item === 'object' && item !== null ? record(item)._sText ?? record(item).text : item
      return plainText(value).toLowerCase() === 'download and install this mod'
    })
    const files = Array.isArray(payload._aFiles) ? payload._aFiles.map((item) => file(item, canInstall)).filter((item): item is ProviderFile => Boolean(item)) : []
    return { ...base, description: base.description || plainText(payload._sDescription), body: plainText(payload._sText, 12000), license: plainText(payload._sLicense, 1000) || undefined, files }
  }

  async resolveDownload(remoteModId: string, remoteFileId: string): Promise<ProviderDownload> {
    const details = await this.getDetails(remoteModId)
    const selected = details.files.find((candidate) => candidate.id === remoteFileId)
    if (!selected) throw new AppError('NOT_FOUND', 'The selected GameBanana file was not found.')
    if (!selected.installable) throw new AppError('UNSUPPORTED_FORMAT', 'This GameBanana file is browse-only because it is not a clean, installable ZIP.')
    const payload = await fetchJson(`${API_ROOT}/Mod/${encodeURIComponent(remoteModId)}/ProfilePage`)
    const rawFile = (Array.isArray(payload._aFiles) ? payload._aFiles : []).map(record).find((candidate) => String(candidate._idRow) === remoteFileId)
    const url = stringValue(rawFile?._sDownloadUrl)
    if (!url?.startsWith('https://')) throw new AppError('NETWORK_ERROR', 'GameBanana did not provide a secure download URL.')
    return { provider: 'gamebanana', remoteModId, remoteFileId, name: selected.name, url, sizeBytes: selected.sizeBytes, sourceUrl: details.sourceUrl }
  }
}
