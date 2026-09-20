import { useState } from 'react'
import type { ProviderModDetails, ProviderModSummary, ProviderSearchResult, Snapshot } from '../shared/contracts'

interface DiscoverViewProps {
  snapshot: Snapshot
  onInstall: (provider: 'gamebanana', remoteModId: string, remoteFileId: string) => void
}

export function DiscoverView({ snapshot, onInstall }: DiscoverViewProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProviderSearchResult>()
  const [selected, setSelected] = useState<ProviderModDetails>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const installedIds = new Set(snapshot.installedMods.filter((mod) => mod.source === 'provider').map((mod) => mod.id))

  async function search(): Promise<void> {
    setLoading(true)
    setError(undefined)
    try {
      setResults(await window.csmm.browseProvider({ provider: 'gamebanana', query, page: 1, perPage: 20 }))
      setSelected(undefined)
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : 'Could not browse GameBanana.')
    } finally {
      setLoading(false)
    }
  }

  async function select(mod: ProviderModSummary): Promise<void> {
    setSelected(undefined)
    setLoading(true)
    setError(undefined)
    try { setSelected(await window.csmm.getProviderMod('gamebanana', mod.remoteModId)) } catch (operationError) { setError(operationError instanceof Error ? operationError.message : 'Could not load mod details.') } finally { setLoading(false) }
  }

  return <section className="panel discover-panel">
    <div className="section-heading discover-heading"><div><p className="eyebrow">Community browser</p><h2>Discover mods</h2><p className="muted">Search GameBanana’s official API for Counter-Strike: Source mods. Results remain attributed to their authors and source pages.</p></div><span className="provider-badge">GameBanana · CS:S</span></div>
    <div className="discover-toolbar"><label className="search-field"><span className="sr-only">Search GameBanana mods</span><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void search() }} placeholder="Search skins, HUDs, sounds…" /></label><button onClick={() => void search()} disabled={loading}>{loading ? 'Searching…' : 'Search'}</button></div>
    {error && <div className="alert error"><strong>Provider error</strong><span>{error}</span></div>}
    {!results && !loading && <div className="empty discover-empty"><strong>Browse community mods without leaving the manager.</strong><span>Search results come from GameBanana’s supported API. Downloads are resolved only after you choose a specific file.</span></div>}
    {results && <div className="discover-layout"><div><div className="result-heading"><span className="muted">{results.total.toLocaleString()} results</span><span className="muted">Page {results.page}</span></div><div className="provider-grid">{results.mods.map((mod) => <button className={`provider-card${selected?.remoteModId === mod.remoteModId ? ' selected' : ''}`} key={mod.remoteModId} onClick={() => void select(mod)}><div className="provider-art" aria-hidden="true">{mod.title.slice(0, 1).toUpperCase()}</div><div className="provider-card-body"><h3>{mod.title}</h3><p>{mod.description || 'No description provided.'}</p><span className="muted">{mod.category ?? 'Mod'} · {mod.author ?? 'Unknown author'}</span></div></button>)}</div>{results.mods.length === 0 && <div className="empty">No GameBanana mods matched this search.</div>}</div>{selected && <ProviderDetails details={selected} installedIds={installedIds} onInstall={onInstall} />}</div>}
  </section>
}

function ProviderDetails({ details, installedIds, onInstall }: { details: ProviderModDetails; installedIds: Set<string>; onInstall: DiscoverViewProps['onInstall'] }) {
  return <aside className="provider-details"><div className="detail-kicker">GAMEBANANA MOD</div><h3>{details.title}</h3><p className="muted">{details.author ? `By ${details.author}` : 'Unknown author'} · {details.category ?? 'Mod'}</p><p className="detail-description">{details.body || details.description || 'No description provided.'}</p>{details.license && <p className="source-note">License: {details.license}</p>}<p className="source-note">Source: <code>{details.sourceUrl}</code></p><div className="tag-list">{details.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="provider-files"><h4>Files</h4>{details.files.length === 0 && <p className="muted">No downloadable files were listed.</p>}{details.files.map((file) => { const identity = `gamebanana:${details.remoteModId}:${file.id}`; const installed = installedIds.has(identity); return <div className="provider-file" key={file.id}><div><strong>{file.name}</strong><span>{file.format.toUpperCase()} · {formatBytes(file.sizeBytes)} · {file.status}</span></div><button disabled={!file.installable || installed} onClick={() => onInstall('gamebanana', details.remoteModId, file.id)}>{installed ? 'Installed' : file.installable ? 'Install' : 'Browse only'}</button></div>})}</div></aside>
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
