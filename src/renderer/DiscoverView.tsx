import { useEffect, useMemo, useRef, useState } from 'react'
import { SOURCE_GAMES, type ModPackEntry, type ModProviderId, type ProviderFile, type ProviderModDetails, type ProviderModSummary, type ProviderSearchResult, type Snapshot, type SourceGameId } from '../shared/contracts'

interface DiscoverViewProps {
  snapshot: Snapshot
  onInstall: (provider: ModProviderId, remoteModId: string, remoteFileId: string) => void
  onCreatePack: (name: string, entries: ModPackEntry[]) => Promise<void>
  onOpenCatalog: () => void
}

type ModFilter = 'all' | 'skins' | 'maps' | 'hud' | 'sounds'
export function DiscoverView({ snapshot, onInstall, onCreatePack, onOpenCatalog }: DiscoverViewProps) {
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState<ModProviderId>('gamebanana')
  const [gameId, setGameId] = useState<SourceGameId>('counter-strike-source')
  const [results, setResults] = useState<ProviderSearchResult>()
  const [selected, setSelected] = useState<ProviderModDetails>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [activeFilter, setActiveFilter] = useState<ModFilter>('all')
  const [packName, setPackName] = useState('My loadout')
  const [packEntries, setPackEntries] = useState<ModPackEntry[]>([])
  const requestSequence = useRef(0)
  const installedIds = useMemo(() => new Set(snapshot.installedMods.filter((mod) => mod.source === 'provider').map((mod) => mod.id)), [snapshot.installedMods])
  const visibleMods = useMemo(() => (results?.mods ?? []).filter((mod) => activeFilter === 'all' || matchesFilter(mod, activeFilter)), [activeFilter, results])
  const recommendation = useMemo(() => {
    const activeProfile = snapshot.profiles.find((profile) => profile.id === snapshot.activeDeployment?.profileId)
    const scopedMods = activeProfile
      ? snapshot.installedMods.filter((mod) => activeProfile.entries.some((entry) => entry.modId === mod.id && entry.enabled))
      : snapshot.installedMods
    const skins = scopedMods.filter((mod) => /skin|weapon|m4a1|ak-47|model/i.test(`${mod.title} ${mod.description ?? ''}`))
    if (skins.length >= 2) return activeProfile ? `${activeProfile.name} has ${skins.length} skin${skins.length === 1 ? '' : 's'} ready. Browse new M4A1, rifle, and weapon releases next.` : `Your collection has ${skins.length} skins ready. Browse new M4A1, rifle, and weapon releases next.`
    return activeProfile ? `Tune ${activeProfile.name} with one verified skin, map, HUD, or sound from the latest releases.` : 'Start a loadout with one verified release, then Discover will tune recommendations to your collection.'
  }, [snapshot.activeDeployment?.profileId, snapshot.installedMods, snapshot.profiles])
  const categoryCounts = useMemo(() => (['all', 'skins', 'maps', 'hud', 'sounds'] as ModFilter[]).map((filter) => ({ filter, count: filter === 'all' ? (results?.total ?? 0) : (results?.mods ?? []).filter((mod) => matchesFilter(mod, filter)).length })), [results])
  useEffect(() => {
    if (!selected) return
    document.querySelector('.provider-details')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [selected])
  async function search(page = 1, forceRefresh = false): Promise<void> {
    const requestId = ++requestSequence.current
    setLoading(true)
    setError(undefined)
    try {
      const nextResults = await window.csmm.browseProvider({ provider, gameId, query, page, perPage: 20, forceRefresh })
      if (requestId !== requestSequence.current) return
      setResults(nextResults)
      setSelected(undefined)
    } catch (operationError) {
      if (requestId === requestSequence.current) setError(operationError instanceof Error ? operationError.message : `Could not browse ${providerLabel(provider)}.`)
    } finally {
      if (requestId === requestSequence.current) setLoading(false)
    }
  }

  async function select(mod: ProviderModSummary): Promise<void> {
    const requestId = ++requestSequence.current
    setSelected(undefined)
    setLoading(true)
    setError(undefined)
    try {
      const details = await window.csmm.getProviderMod(provider, mod.remoteModId, gameId)
      if (requestId === requestSequence.current) setSelected(details)
    } catch (operationError) {
      if (requestId === requestSequence.current) setError(operationError instanceof Error ? operationError.message : 'Could not load mod details.')
    } finally {
      if (requestId === requestSequence.current) setLoading(false)
    }
  }

  function addToPack(details: ProviderModDetails, file: ProviderFile): void {
    const entry: ModPackEntry = { provider: details.provider, remoteModId: details.remoteModId, remoteFileId: file.id, title: details.title }
    setPackEntries((current) => current.some((candidate) => candidate.provider === entry.provider && candidate.remoteModId === entry.remoteModId && candidate.remoteFileId === entry.remoteFileId) ? current : [...current, entry])
  }

  async function savePack(): Promise<void> {
    if (packEntries.length === 0) return
    await onCreatePack(packName, packEntries)
    setPackEntries([])
  }

  return <section className="discover-page">
    <div className="discover-hero panel"><div><p className="eyebrow">The community desk</p><h2>Find your next loadout.</h2><p className="hero-copy">Scan the latest {sourceGameLabel(gameId)} releases by category, compare sources, and save verified files to your collection.</p><div className="hero-actions"><button onClick={() => void search(1, Boolean(results))} disabled={loading}>{loading ? 'Loading releases…' : results ? 'Refresh latest' : 'Browse latest'}</button><span className="hero-note">Official API · cached results · ZIP-only installs</span></div></div><div className="hero-orbit" aria-hidden="true"><span>CSS</span><i>+</i><b>MODS</b></div></div>
    <div className="discover-toolbar"><label className="search-field"><span className="sr-only">Search {providerLabel(provider)} mods</span><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void search(1) }} placeholder="Search skins, maps, HUDs, sounds…" /></label><label className="source-control"><span className="sr-only">Mod source</span><select value={provider} onChange={(event) => { if (event.target.value === 'catalog') onOpenCatalog(); else setProvider(event.target.value as ModProviderId) }}><option value="gamebanana">GameBanana</option><option value="catalog">Bundled catalog</option></select></label><label className="source-control"><span className="sr-only">Source game</span><select value={gameId} onChange={(event) => { ++requestSequence.current; setGameId(event.target.value as SourceGameId); setResults(undefined); setSelected(undefined); setLoading(false); setError(undefined) }}>{SOURCE_GAMES.map((game) => <option key={game.id} value={game.id}>{game.label}{game.installable ? '' : ' · browse only'}</option>)}</select></label><button onClick={() => void search(1)} disabled={loading}>{loading ? 'Searching…' : 'Search'}</button><span className="provider-badge">{sourceGameLabel(gameId)}</span></div>
    <div className="filter-row" role="toolbar" aria-label="Filter mod types">{(['all', 'skins', 'maps', 'hud', 'sounds'] as ModFilter[]).map((filter) => <button key={filter} className={activeFilter === filter ? 'filter-chip active' : 'filter-chip'} onClick={() => setActiveFilter(filter)}>{filterLabel(filter)}</button>)}</div>
    <div className="category-lanes" aria-label="Release categories">{categoryCounts.map(({ filter, count }) => <button key={filter} className={activeFilter === filter ? 'category-lane active' : 'category-lane'} onClick={() => setActiveFilter(filter)}><span>{filterLabel(filter)}</span><strong>{count.toLocaleString()}</strong><small>{filter === 'all' ? 'latest total' : 'on this page'}</small></button>)}</div>
    <section className="discover-recommendation panel"><div><p className="eyebrow">Recommendation desk</p><strong>{recommendation}</strong></div><span className="muted">Recommendations use this collection and the active deployment profile when one exists.</span></section>
    <section className="community-pulse panel"><div className="section-heading"><div><p className="eyebrow">Community pulse</p><h3>What people are making</h3><p className="muted">A living snapshot of the latest release mix, not a second catalog.</p></div><span className="catalog-count">GameBanana · {sourceGameLabel(gameId)}</span></div><div className="pulse-list">{categoryCounts.filter(({ filter }) => filter !== 'all').map(({ filter, count }) => <article key={filter}><strong>{filterLabel(filter)}</strong><span>{count ? `${count} on this page` : 'Search this lane'} · latest community updates</span></article>)}</div></section>
    {packEntries.length > 0 && <div className="pack-dock panel"><div><p className="eyebrow">Build a pack</p><strong>{packEntries.length} verified file{packEntries.length === 1 ? '' : 's'} selected</strong><span className="muted">Save this loadout once, then install the whole pack from Library.</span></div><label><span className="sr-only">Pack name</span><input value={packName} onChange={(event) => setPackName(event.target.value)} /></label><button onClick={() => void savePack()}>Save pack</button><button className="secondary" onClick={() => setPackEntries([])}>Clear</button></div>}
    {error && <div className="alert error"><strong>Provider error</strong><span>{error}</span></div>}
    {!results && !loading && <div className="empty discover-empty"><strong>Your library starts here.</strong><span>Search or browse the latest community releases. Nothing installs until you choose a specific, verified file.</span></div>}
    {results && <><div className="library-result-meta"><div><span className="eyebrow">Latest releases</span><strong>{results.total === 0 ? 'No releases' : `${((results.page - 1) * results.perPage) + 1}–${Math.min(results.total, results.page * results.perPage)} of ${results.total.toLocaleString()}`}</strong></div><span className="muted">Page {results.page} of {Math.max(1, Math.ceil(results.total / results.perPage))}</span></div>{results.mods.length > 0 && <section className="featured-mod"><ProviderArtwork mod={results.mods[0]} className="featured-art" label="FEATURED" /><div className="featured-copy"><p className="eyebrow">Featured release</p><h3>{results.mods[0].title}</h3><p>{results.mods[0].description || 'Explore the full details and available files.'}</p><div className="tag-list">{results.mods[0].tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}</div><button className="secondary" onClick={() => void select(results.mods[0])}>View details</button></div></section>}{visibleMods.length === 0 ? <div className="empty">No mods match this category. Try All releases.</div> : <section className="mod-grid-section"><div className="rail-heading"><div><p className="eyebrow">{activeFilter === 'all' ? 'All releases' : filterLabel(activeFilter)}</p><h3>Pick something new</h3></div><span className="muted">{visibleMods.length} on this page</span></div><div className="provider-grid">{visibleMods.map((mod) => <ProviderCard key={`${mod.provider}:${mod.gameId}:${mod.remoteModId}`} mod={mod} selected={selected?.remoteModId === mod.remoteModId} onSelect={select} />)}</div></section>}{(results.page > 1 || results.hasMore) && <nav className="pagination-bar" aria-label="Provider results pages"><button className="secondary" onClick={() => void search(results.page - 1)} disabled={loading || results.page <= 1}>Previous page</button><span>Page {results.page} of {Math.max(1, Math.ceil(results.total / results.perPage))}</span><button onClick={() => void search(results.page + 1)} disabled={loading || !results.hasMore}>Next page</button></nav>}{selected && <ProviderDetails details={selected} installedIds={installedIds} onInstall={onInstall} onAddToPack={addToPack} onClose={() => setSelected(undefined)} />}</>}
  </section>
}

function ProviderArtwork({ mod, className, label }: { mod: ProviderModSummary; className: string; label: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setFailed(false)
  }, [mod.previewImageUrl])
  return <div className={className} aria-hidden="true">{mod.previewImageUrl && !failed ? <img className="provider-preview" src={mod.previewImageUrl} alt="" loading={label === 'FEATURED' ? 'eager' : 'lazy'} decoding="async" onError={() => setFailed(true)} /> : <span>{mod.title.slice(0, 1).toUpperCase()}</span>}<small>{label}</small></div>
}

function ProviderCard({ mod, selected, onSelect }: { mod: ProviderModSummary; selected: boolean; onSelect: (mod: ProviderModSummary) => Promise<void> }) {
  return <button className={`provider-card${selected ? ' selected' : ''}`} onClick={() => void onSelect(mod)}><ProviderArtwork mod={mod} className={`provider-art provider-art-${classify(mod)}`} label={filterLabel(classify(mod))} /><div className="provider-card-body"><div className="card-title-row"><h3>{mod.title}</h3>{mod.hasFiles && <span className="badge">Files</span>}</div><p>{mod.description || 'No description provided.'}</p><span className="muted">{mod.category ?? 'Mod'} · {mod.author ?? 'Unknown author'}</span></div></button>
}

function ProviderDetails({ details, installedIds, onInstall, onAddToPack, onClose }: { details: ProviderModDetails; installedIds: Set<string>; onInstall: DiscoverViewProps['onInstall']; onAddToPack: (details: ProviderModDetails, file: ProviderFile) => void; onClose: () => void }) {
  const canInstall = details.gameId === 'counter-strike-source'
  return <aside className="provider-details" aria-label={`${details.title} details`}><div className="detail-topline"><div className="detail-kicker">GAMEBANANA MOD</div><button className="detail-close secondary" onClick={onClose}>Close</button></div><h3>{details.title}</h3><p className="muted">{details.author ? `By ${details.author}` : 'Unknown author'} · {details.category ?? 'Mod'}</p><p className="detail-description">{details.body || details.description || 'No description provided.'}</p>{details.license && <p className="source-note">License: {details.license}</p>}<p className="source-note">Source: <code>{details.sourceUrl}</code></p><div className="tag-list">{details.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="provider-files"><h4>Files</h4>{details.files.length === 0 && <p className="muted">No downloadable files were listed.</p>}{details.files.map((file) => { const identity = `${details.provider}:${details.remoteModId}:${file.id}`; const installed = installedIds.has(identity); return <ProviderFileRow key={file.id} file={file} installed={installed} canInstall={canInstall} onAddToPack={() => onAddToPack(details, file)} onInstall={() => onInstall(details.provider, details.remoteModId, file.id)} />})}</div></aside>
}
function ProviderFileRow({ file, installed, canInstall, onAddToPack, onInstall }: { file: ProviderFile; installed: boolean; canInstall: boolean; onAddToPack: () => void; onInstall: () => void }) {
  const available = canInstall && file.installable
  const label = installed ? 'Installed' : available ? 'Install' : canInstall ? statusLabel(file.status) : 'Browse only'
  return <div className="provider-file"><div><strong>{file.name}</strong><span>{file.format.toUpperCase()} · {formatBytes(file.sizeBytes)} · {statusLabel(file.status)}</span></div><div className="provider-file-actions"><button disabled={!available || installed} onClick={onInstall}>{label}</button><button className="secondary" disabled={!available} onClick={onAddToPack}>Add to pack</button></div></div>
}

function classify(mod: ProviderModSummary): ModFilter {
  const searchable = `${mod.title} ${mod.description} ${mod.tags.join(' ')}`.toLowerCase()
  if (/(map|level|de_dust|de_nuke|surf)/.test(searchable)) return 'maps'
  if (/(hud|interface|ui|crosshair)/.test(searchable)) return 'hud'
  if (/(sound|audio|music|voice)/.test(searchable)) return 'sounds'
  if (/(skin|weapon|model|texture|character)/.test(searchable)) return 'skins'
  return 'all'
}

function matchesFilter(mod: ProviderModSummary, filter: ModFilter): boolean {
  return classify(mod) === filter || (filter === 'skins' && classify(mod) === 'all')
}

function filterLabel(filter: ModFilter): string {
  return filter === 'all' ? 'All releases' : filter === 'hud' ? 'HUDs' : filter[0].toUpperCase() + filter.slice(1)
}

function statusLabel(status: ProviderFile['status']): string {
  if (status === 'checksum-missing') return 'Checksum unavailable'
  if (status === 'permission-denied') return 'Author restricted'
  if (status === 'scan-pending') return 'Scan pending'
  if (status === 'scan-failed') return 'Scan failed'
  if (status === 'unsupported-format') return 'Browse only'
  if (status === 'archived') return 'Archived'
  return 'Verified ZIP'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function providerLabel(provider: ModProviderId): string {
  return provider === 'gamebanana' ? 'GameBanana' : provider
}

function sourceGameLabel(gameId: SourceGameId): string {
  return SOURCE_GAMES.find((game) => game.id === gameId)?.label ?? gameId
}
