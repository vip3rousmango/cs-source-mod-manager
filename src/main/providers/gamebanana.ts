import type { ProviderBrowseRequest, ProviderFile, ProviderFileStatus, ProviderModDetails, ProviderModSummary, ProviderSearchResult, SourceGameId } from '../../shared/contracts'
import { AppError } from '../services/errors'
import type { ModProvider, ProviderDownload } from './mod-provider'

const GAME_IDS: Record<SourceGameId, number> = { 'counter-strike-source': 2, 'half-life-2': 9, 'day-of-defeat-source': 10, 'brainbread-source': 500 }
const GAME_ID = GAME_IDS['counter-strike-source']
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
  if (!base || !file) return undefined
  try {
    const url = new URL(`${base}/${file}`)
    if (url.protocol !== 'https:' || url.hostname !== 'images.gamebanana.com' || url.port || url.username || url.password || !url.pathname.startsWith('/img/ss/mods/')) return undefined
    return url.href
  } catch {
    return undefined
  }
}

function tags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((tag) => typeof tag === 'string' ? tag : stringValue(record(tag)._sName ?? record(tag)._sTitle ?? record(tag)._sValue)).filter((tag): tag is string => Boolean(tag))
}

function sourceGameId(value: unknown): SourceGameId | undefined {
  const gameBananaId = numberValue(record(record(value)._aGame)._idRow)
  return (Object.keys(GAME_IDS) as SourceGameId[]).find((gameId) => GAME_IDS[gameId] === gameBananaId)
}

function summary(value: unknown, expectedGameId: SourceGameId = 'counter-strike-source'): ProviderModSummary | undefined {
  const item = record(value)
  const id = numberValue(item._idRow)
  const title = stringValue(item._sName)
  const gameId = sourceGameId(item)
  if (id === undefined || !title || gameId !== expectedGameId) return undefined
  const category = stringValue(record(item._aRootCategory)._sName)
  return {
    provider: 'gamebanana',
    gameId,
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
  const lowerName = name.toLowerCase()
  const format = lowerName.endsWith('.zip') ? 'zip' : lowerName.endsWith('.rar') ? 'rar' : lowerName.endsWith('.7z') ? '7z' : 'other'
  const archived = item._bIsArchived === true
  const antivirus = stringValue(item._sAvResult)?.toLowerCase()
  const analysis = stringValue(item._sAnalysisResult)?.toLowerCase()
  const scanReady = antivirus === 'clean' && analysis === 'ok'
  const checksumMd5 = typeof item._sMd5Checksum === 'string' && /^[0-9a-f]{32}$/i.test(item._sMd5Checksum) ? item._sMd5Checksum.toLowerCase() : undefined
  const status: ProviderFileStatus = archived
    ? 'archived'
    : format !== 'zip'
      ? 'unsupported-format'
      : !canInstall
        ? 'permission-denied'
        : antivirus === undefined || analysis === undefined
          ? 'scan-pending'
          : !scanReady
            ? 'scan-failed'
            : checksumMd5 === undefined
              ? 'checksum-missing'
              : 'installable'
  return { id: String(id), name, sizeBytes: numberValue(item._nFilesize) ?? 0, format, version: stringValue(item._sVersion), installable: status === 'installable', status, checksumMd5 }
}

async function fetchJson(url: string): Promise<RecordValue> {
  const response = await fetch(url)
  if (!response.ok) throw new AppError('NETWORK_ERROR', `GameBanana API returned HTTP ${response.status}.`)
  const body = await response.json().catch(() => undefined)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AppError('NETWORK_ERROR', 'GameBanana returned an invalid API response.')
  return body as RecordValue
}

function browsePayload(payload: RecordValue): { metadata: RecordValue; records: unknown[] } {
  const metadata = record(payload._aMetadata)
  const records = payload._aRecords
  if (!Array.isArray(records) || !Number.isSafeInteger(metadata._nRecordCount) || (metadata._nRecordCount as number) < 0) {
    throw new AppError('NETWORK_ERROR', 'GameBanana returned an invalid browse response.')
  }
  return { metadata, records }
}

export class GameBananaProvider implements ModProvider {
  readonly id = 'gamebanana' as const
  async browse(request: Omit<ProviderBrowseRequest, 'provider'>): Promise<ProviderSearchResult> {
    const page = Math.max(1, Math.floor(request.page))
    const perPage = Math.min(30, Math.max(1, Math.floor(request.perPage)))
    const query = request.query.trim()
    const gameId = request.gameId ?? 'counter-strike-source'
    const gameBananaId = GAME_IDS[gameId]
    const params = query
      ? new URLSearchParams({ _sSearchString: query, _sModelName: 'Mod', _idGameRow: String(gameBananaId), _nPage: String(page), _nPerpage: String(perPage) })
      : new URLSearchParams({ _nPage: String(page), _nPerpage: String(perPage), '_aFilters[Generic_Game]': String(gameBananaId), _sSort: 'Generic_LatestUpdated' })
    const payload = await fetchJson(`${API_ROOT}/${query ? 'Util/Search/Results' : 'Mod/Index'}?${params.toString()}`)
    const { metadata, records } = browsePayload(payload)
    const mods = records.map((item) => summary(item, gameId)).filter((item): item is ProviderModSummary => Boolean(item))
    const total = metadata._nRecordCount as number
    return { provider: 'gamebanana', query: request.query, page, perPage, total, hasMore: metadata._bIsComplete !== true && page * perPage < total, mods }
  }

  async getDetails(remoteModId: string, gameId: SourceGameId = 'counter-strike-source'): Promise<ProviderModDetails> {
    if (!/^\d+$/.test(remoteModId)) throw new AppError('INVALID_REQUEST', 'Invalid GameBanana mod ID.')
    const payload = await fetchJson(`${API_ROOT}/Mod/${encodeURIComponent(remoteModId)}/ProfilePage`)
    const base = summary(payload, gameId)
    if (!base) throw new AppError('NOT_FOUND', 'The GameBanana mod was not found for the selected Source game.')
    if (!Array.isArray(payload._aFiles)) throw new AppError('NETWORK_ERROR', 'GameBanana returned an invalid mod detail response.')
    const checklist = payload._aLicenseChecklist
    const flatChecklist = Array.isArray(checklist)
    const checklistRecord = record(checklist)
    const checklistItems: unknown[] = flatChecklist ? checklist : (Array.isArray(checklistRecord.yes) ? checklistRecord.yes : [])
    const canInstall = checklistItems.some((item) => {
      if (flatChecklist) {
        if (typeof item !== 'object' || item === null) return false
        const itemRecord = record(item)
        return itemRecord._bValue === true && plainText(itemRecord._sText ?? itemRecord.text).toLowerCase() === 'download and install this mod'
      }
      return plainText(item).toLowerCase() === 'download and install this mod'
    })
    const files = payload._aFiles.map((item) => file(item, canInstall)).filter((item): item is ProviderFile => Boolean(item))
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
    return { provider: 'gamebanana', remoteModId, remoteFileId, name: selected.name, url, sizeBytes: selected.sizeBytes, checksumMd5: selected.checksumMd5, sourceUrl: details.sourceUrl }
  }
}
