import { useMemo, useRef, useState } from 'react'
import type { ProviderFile, ProviderModDetails, ProviderModSummary, ProviderSearchResult, Snapshot } from '../shared/contracts'

interface DiscoverViewProps {
  snapshot: Snapshot
  onInstall: (provider: 'gamebanana', remoteModId: string, remoteFileId: string) => void
}

type ModFilter = 'all' | 'skins' | 'maps' | 'hud' | 'sounds'

export function DiscoverView({ snapshot, onInstall }: DiscoverViewProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProviderSearchResult>()
  const [selected, setSelected] = useState<ProviderModDetails>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [activeFilter, setActiveFilter] = useState<ModFilter>('all')
  const requestSequence = useRef(0)
  const installedIds = new Set(snapshot.installedMods.filter((mod) => mod.source === 'provider').map((mod) => mod.id))
  const visibleMods = useMemo(() => (results?.mods ?? []).filter((mod) => activeFilter === 'all' || matchesFilter(mod, activeFilter)), [activeFilter, results])

  async function search(append = false): Promise<void> {
    const requestId = ++requestSequence.current
    const nextPage = append ? (results?.page ?? 0) + 1 : 1
    setLoading(true)
    setError(undefined)
    try {
      const nextResults = await window.csmm.browseProvider({ provider: 'gamebanana', query, page: nextPage, perPage: 20 })
      if (requestId !== requestSequence.current) return
      const mods = append ? [...(results?.mods ?? []), ...nextResults.mods.filter((candidate) => !(results?.mods ?? []).some((current) => current.remoteModId === candidate.remoteModId))] : nextResults.mods
      setResults({ ...nextResults, mods })
      if (!append) setSelected(undefined)
    } catch (operationError) {
      if (requestId === requestSequence.current) setError(operationError instanceof Error ? operationError.message : 'Could not browse GameBanana.')
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
      const details = await window.csmm.getProviderMod('gamebanana', mod.remoteModId)
      if (requestId === requestSequence.current) setSelected(details)
    } catch (operationError) {
      if (requestId === requestSequence.current) setError(operationError instanceof Error ? operationError.message : 'Could not load mod details.')
    } finally {
      if (requestId === requestSequence.current) setLoading(false)
    }
  }

  return <section className="discover-page">
    <div className="discover-hero panel"><div><p className="eyebrow">The mod library</p><h2>Find your next loadout.</h2><p className="hero-copy">Browse Counter-Strike: Source skins, maps, HUDs, sounds, and packs from GameBanana. Save the good stuff to your library, then compose it into profiles.</p><div className="hero-actions"><button onClick={() => void search()} disabled={loading}>{loading ? 'Loading library…' : results ? 'Refresh latest' : 'Browse latest'}</button><span className="hero-note">Official API · attributed sources · ZIP-only installs</span></div></div><div className="hero-orbit" aria-hidden="true"><span>CSS</span><i>+</i><b>MODS</b></div></div>
    <div className="discover-toolbar"><label className="search-field"><span className="sr-only">Search GameBanana mods</span><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void search() }} placeholder="Search skins, maps, HUDs, sounds…" /></label><label className="source-control"><span className="sr-only">Mod source</span><select value="gamebanana" disabled><option>GameBanana</option></select></label><button onClick={() => void search()} disabled={loading}>{loading ? 'Searching…' : 'Search'}</button><span className="provider-badge">CS:S</span></div>
    <div className="filter-row" role="toolbar" aria-label="Filter mod types">{(['all', 'skins', 'maps', 'hud', 'sounds'] as ModFilter[]).map((filter) => <button key={filter} className={activeFilter === filter ? 'filter-chip active' : 'filter-chip'} onClick={() => setActiveFilter(filter)}>{filterLabel(filter)}</button>)}</div>
    {error && <div className="alert error"><strong>Provider error</strong><span>{error}</span></div>}
    {!results && !loading && <div className="empty discover-empty"><strong>Your library starts here.</strong><span>Search or browse the latest community releases. Nothing installs until you choose a specific, verified file.</span></div>}
    {results && <><div className="library-result-meta"><div><span className="eyebrow">Curated by the community</span><strong>{results.total.toLocaleString()} results</strong></div><span className="muted">Page {results.page}</span></div>{results.mods.length > 0 && <section className="featured-mod"><div className="featured-art" aria-hidden="true"><span>{results.mods[0].title.slice(0, 1).toUpperCase()}</span><small>FEATURED</small></div><div className="featured-copy"><p className="eyebrow">Featured release</p><h3>{results.mods[0].title}</h3><p>{results.mods[0].description || 'Explore the full details and available files.'}</p><div className="tag-list">{results.mods[0].tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}</div><button className="secondary" onClick={() => void select(results.mods[0])}>View details</button></div></section>}{visibleMods.length === 0 ? <div className="empty">No mods match this category. Try All releases.</div> : <section className="mod-rail-section"><div className="rail-heading"><div><p className="eyebrow">{activeFilter === 'all' ? 'All releases' : filterLabel(activeFilter)}</p><h3>Pick something new</h3></div><span className="muted">{visibleMods.length} shown</span></div><div className="provider-rail">{visibleMods.map((mod) => <ProviderCard key={mod.remoteModId} mod={mod} selected={selected?.remoteModId === mod.remoteModId} onSelect={select} />)}</div></section>}{results.hasMore && <button className="load-more" onClick={() => void search(true)} disabled={loading}>{loading ? 'Loading more…' : 'Load more releases'}</button>}{selected && <ProviderDetails details={selected} installedIds={installedIds} onInstall={onInstall} />}</>}
  </section>
}

function ProviderCard({ mod, selected, onSelect }: { mod: ProviderModSummary; selected: boolean; onSelect: (mod: ProviderModSummary) => Promise<void> }) {
  return <button className={`provider-card${selected ? ' selected' : ''}`} onClick={() => void onSelect(mod)}><div className={`provider-art provider-art-${classify(mod)}`} aria-hidden="true"><span>{mod.title.slice(0, 1).toUpperCase()}</span><small>{filterLabel(classify(mod))}</small></div><div className="provider-card-body"><div className="card-title-row"><h3>{mod.title}</h3>{mod.hasFiles && <span className="badge">Files</span>}</div><p>{mod.description || 'No description provided.'}</p><span className="muted">{mod.category ?? 'Mod'} · {mod.author ?? 'Unknown author'}</span></div></button>
}

function ProviderDetails({ details, installedIds, onInstall }: { details: ProviderModDetails; installedIds: Set<string>; onInstall: DiscoverViewProps['onInstall'] }) {
  return <aside className="provider-details"><div className="detail-kicker">GAMEBANANA MOD</div><h3>{details.title}</h3><p className="muted">{details.author ? `By ${details.author}` : 'Unknown author'} · {details.category ?? 'Mod'}</p><p className="detail-description">{details.body || details.description || 'No description provided.'}</p>{details.license && <p className="source-note">License: {details.license}</p>}<p className="source-note">Source: <code>{details.sourceUrl}</code></p><div className="tag-list">{details.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="provider-files"><h4>Files</h4>{details.files.length === 0 && <p className="muted">No downloadable files were listed.</p>}{details.files.map((file) => { const identity = `gamebanana:${details.remoteModId}:${file.id}`; const installed = installedIds.has(identity); return <ProviderFileRow key={file.id} file={file} installed={installed} onInstall={() => onInstall('gamebanana', details.remoteModId, file.id)} />})}</div></aside>
}

function ProviderFileRow({ file, installed, onInstall }: { file: ProviderFile; installed: boolean; onInstall: () => void }) {
  const label = installed ? 'Installed' : file.installable ? 'Install' : statusLabel(file.status)
  return <div className="provider-file"><div><strong>{file.name}</strong><span>{file.format.toUpperCase()} · {formatBytes(file.sizeBytes)} · {statusLabel(file.status)}</span></div><button disabled={!file.installable || installed} onClick={onInstall}>{label}</button></div>
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
