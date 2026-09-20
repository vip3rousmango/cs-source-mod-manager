import { useEffect, useMemo, useState } from 'react'
import { DiscoverView } from './DiscoverView'
import { LibraryView } from './LibraryView'
import { ServerCacheView } from './ServerCacheView'
import type { CatalogEntry, DeploymentPreview, ModPackEntry, ModProfile, ProgressEvent, ServerCacheSnapshot, Snapshot } from '../shared/contracts'

type View = 'setup' | 'discover' | 'catalog' | 'library' | 'profiles' | 'server-cache' | 'activity'

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'message' in error) return String(error.message)
  return 'Operation failed.'
}

function CatalogView({ snapshot, onInstall, onOpenLibrary }: { snapshot: Snapshot; onInstall: (id: string) => void; onOpenLibrary: () => void }) {
  const [query, setQuery] = useState('')
  const [activeTag, setActiveTag] = useState<string>('all')
  const [selectedId, setSelectedId] = useState<string>()
  const installedIds = useMemo(() => new Set(snapshot.installedMods.filter((mod) => mod.source === 'catalog').map((mod) => mod.id)), [snapshot.installedMods])
  const tags = useMemo(() => [...new Set(snapshot.catalog.entries.flatMap((entry) => entry.tags))].sort(), [snapshot.catalog.entries])
  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return snapshot.catalog.entries.filter((entry) => {
      const matchesTag = activeTag === 'all' || entry.tags.includes(activeTag)
      const searchable = `${entry.title} ${entry.author ?? ''} ${entry.description} ${entry.tags.join(' ')}`.toLowerCase()
      return matchesTag && (!normalizedQuery || searchable.includes(normalizedQuery))
    })
  }, [activeTag, query, snapshot.catalog.entries])
  const selectedEntry = filteredEntries.find((entry) => entry.id === selectedId) ?? filteredEntries[0]

  return <section className="panel catalog-panel">
    <div className="section-heading catalog-heading">
      <div><p className="eyebrow">Verified downloads</p><h2>Mod catalog</h2><p className="muted">Browse curated Counter-Strike: Source content. Every archive is size- and SHA-256-verified before it reaches your library.</p></div>
      <span className="catalog-count">{filteredEntries.length} {filteredEntries.length === 1 ? 'mod' : 'mods'}</span>
    </div>
    <div className="catalog-toolbar">
      <label className="search-field"><span className="sr-only">Search mods</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search mods, authors, tags…" /></label>
      <label className="tag-field"><span className="sr-only">Filter by tag</span><select value={activeTag} onChange={(event) => setActiveTag(event.target.value)}><option value="all">All tags</option>{tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}</select></label>
    </div>
    {snapshot.catalog.entries.length === 0 ? <div className="empty catalog-empty"><strong>No curated downloads are available in this build.</strong><span>Import a ZIP or extracted mod folder from Library to add content. Curated downloads will appear here when this build includes verified sources.</span><span>For immediate testing, use <button className="link-button" onClick={onOpenLibrary}>Library → Import folder or ZIP</button>.</span></div> : filteredEntries.length === 0 ? <div className="empty catalog-empty">No mods match this search. Try another title or clear the tag filter.</div> : <div className="catalog-layout">
      <div className="catalog-grid">{filteredEntries.map((entry) => {
        const installed = installedIds.has(entry.id)
        return <button className={`catalog-card${selectedEntry?.id === entry.id ? ' selected' : ''}`} key={entry.id} onClick={() => setSelectedId(entry.id)}>
          <div className="card-art" aria-hidden="true">{entry.title.slice(0, 1).toUpperCase()}</div>
          <div className="catalog-card-body"><div className="card-title-row"><h3>{entry.title}</h3>{installed && <span className="badge">Installed</span>}</div><p>{entry.description}</p><div className="tag-list">{entry.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div><span className="muted">v{entry.version} · {formatBytes(entry.archiveSizeBytes)}</span></div>
        </button>
      })}</div>
      {selectedEntry && <CatalogDetails entry={selectedEntry} installed={installedIds.has(selectedEntry.id)} onInstall={onInstall} />}
    </div>}
  </section>
}

function CatalogDetails({ entry, installed, onInstall }: { entry: CatalogEntry; installed: boolean; onInstall: (id: string) => void }) {
  return <aside className="catalog-details">
    <div className="detail-kicker">MOD DETAILS</div>
    <h3>{entry.title}</h3>
    <p className="muted">{entry.author ? `By ${entry.author}` : 'Community contribution'} · Version {entry.version}</p>
    <p className="detail-description">{entry.description}</p>
    <div className="tag-list">{entry.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
    <dl className="detail-meta"><div><dt>Archive</dt><dd>{formatBytes(entry.archiveSizeBytes)}</dd></div><div><dt>Content layout</dt><dd>{entry.contentRoot}</dd></div><div><dt>SHA-256</dt><dd><code>{entry.archiveSha256}</code></dd></div></dl>
    {entry.sourcePageUrl && <p className="source-note">Source: <code>{entry.sourcePageUrl}</code></p>}
    <button disabled={installed} onClick={() => onInstall(entry.id)}>{installed ? 'Installed' : 'Download & install'}</button>
  </aside>
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | undefined>()
  const [view, setView] = useState<View>('setup')
  const [error, setError] = useState<string>()
  const [progress, setProgress] = useState<ProgressEvent[]>([])
  const [profileName, setProfileName] = useState('Default')
  const [selectedProfile, setSelectedProfile] = useState<string>()
  const [preview, setPreview] = useState<DeploymentPreview>()
  const [serverCache, setServerCache] = useState<ServerCacheSnapshot>()
  const [serverCacheLoading, setServerCacheLoading] = useState(false)

  async function refresh(): Promise<void> {
    try { setSnapshot(await window.csmm.getSnapshot()); setError(undefined) } catch (operationError) { setError(errorMessage(operationError)) }
  }

  async function run(operation: () => Promise<Snapshot>): Promise<void> {
    try {
      const next = await operation()
      setSnapshot(next)
      setError(next.packInstall?.failures.length ? `Pack installed ${next.packInstall.completed} item(s); ${next.packInstall.failures.length} failed.` : undefined)
    } catch (operationError) {
      setError(errorMessage(operationError))
    }
  }
  async function createModPack(name: string, entries: ModPackEntry[]): Promise<void> {
    try {
      setSnapshot(await window.csmm.createModPack(name, entries))
      setError(undefined)
    } catch (operationError) {
      setError(errorMessage(operationError))
      throw operationError
    }
  }

  async function updateProfile(profile: ModProfile, entries: ModProfile['entries']): Promise<void> {
    await run(() => window.csmm.updateProfile({ ...profile, entries, updatedAt: new Date().toISOString() }))
    setPreview(undefined)
  }

  async function refreshServerCache(): Promise<void> {
    setServerCacheLoading(true)
    try { setServerCache(await window.csmm.getServerCache()); setError(undefined) } catch (operationError) { setError(errorMessage(operationError)) } finally { setServerCacheLoading(false) }
  }

  async function cleanServerCache(): Promise<void> {
    try { setServerCache(await window.csmm.cleanServerCache(true)); setError(undefined) } catch (operationError) { setError(errorMessage(operationError)) } finally { setServerCacheLoading(false) }
  }

  async function shareInstalledMod(modId: string): Promise<void> {
    try { await window.csmm.shareInstalledMod(modId); setError(undefined) } catch (operationError) { setError(errorMessage(operationError)); throw operationError }
  }

  useEffect(() => {
    void refresh()
    return window.csmm.subscribeToProgress((event) => setProgress((current) => [...current.slice(-49), event]))
  }, [])

  useEffect(() => {
    if (view === 'server-cache') void refreshServerCache()
  }, [view])

  const currentProfile = useMemo(() => snapshot?.profiles.find((profile) => profile.id === selectedProfile) ?? snapshot?.profiles[0], [snapshot, selectedProfile])

  if (!snapshot) return <main className="shell"><h1>CS Source Mod Manager</h1><p>Loading application state…</p></main>

  return <main className="shell">
    <header className="topbar"><div><p className="eyebrow">Steam utility</p><h1>CS Source Mod Manager</h1></div><button className="secondary" onClick={() => void refresh()}>Refresh</button></header>
    <nav className="tabs">{(['setup', 'discover', 'catalog', 'library', 'profiles', 'server-cache', 'activity'] as View[]).map((item) => <button data-view={item} key={item} className={view === item ? 'tab active' : 'tab'} onClick={() => setView(item)}>{item === 'server-cache' ? 'server downloads' : item}</button>)}</nav>
    {error && <div className="alert error"><strong>Operation failed</strong><span>{error}</span></div>}
    {snapshot.recoveryRequired && <div className="alert error"><strong>Recovery required</strong><span>{snapshot.recoveryRequired}</span></div>}
    {view === 'setup' && <section className="panel"><h2>Game setup</h2><p className="muted">Managed deployments live under <code>cstrike/custom</code>. The only exception is an explicit, confirmed cleanup of downloaded server content under <code>cstrike/download</code>.</p><div className="actions"><button onClick={() => void run(() => window.csmm.discoverGame())}>Detect Steam installation</button><button className="secondary" onClick={() => void run(() => window.csmm.chooseGameDirectory())}>Choose directory</button></div>{snapshot.game ? <div className="success"><strong>Connected</strong><span>{snapshot.game.installPath}</span></div> : <p className="empty">No Counter-Strike: Source installation selected.</p>}</section>}
    {view === 'profiles' && <section className="panel"><div className="section-heading"><div><h2>Profiles</h2><p className="muted">Priority is explicit; higher values win conflicts.</p></div><div className="inline-form"><input value={profileName} onChange={(event) => setProfileName(event.target.value)} aria-label="New profile name" /><button onClick={() => void run(() => window.csmm.createProfile(profileName))}>Create</button></div></div>{snapshot.profiles.length === 0 ? <p className="empty">Create a profile to compose installed mods.</p> : <><label className="field">Profile<select value={currentProfile?.id ?? ''} onChange={(event) => { setSelectedProfile(event.target.value); setPreview(undefined) }}>{snapshot.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>{currentProfile && <><div className="list">{snapshot.installedMods.length === 0 ? <p className="empty">Import a mod before composing this profile.</p> : snapshot.installedMods.map((mod) => { const entry = currentProfile.entries.find((candidate) => candidate.modId === mod.id); const enabled = entry?.enabled ?? false; return <div className="list-row" key={mod.id}><label className="check"><input type="checkbox" checked={enabled} onChange={(event) => { const entries = currentProfile.entries.filter((candidate) => candidate.modId !== mod.id); entries.push({ modId: mod.id, enabled: event.target.checked, priority: entry?.priority ?? 0 }); void updateProfile(currentProfile, entries) }} /><span><strong>{mod.title}</strong><small>{mod.source} · {mod.version}</small></span></label><input className="priority" type="number" value={entry?.priority ?? 0} aria-label={`${mod.title} priority`} onChange={(event) => { const entries = currentProfile.entries.filter((candidate) => candidate.modId !== mod.id); entries.push({ modId: mod.id, enabled, priority: Number(event.target.value) || 0 }); void updateProfile(currentProfile, entries) }} /></div> })}</div><div className="actions"><button onClick={async () => { try { setPreview(await window.csmm.previewProfile(currentProfile.id)); setError(undefined) } catch (operationError) { setError(errorMessage(operationError)) } }}>Preview deployment</button><button onClick={() => void run(() => window.csmm.deployProfile(currentProfile.id, Boolean(preview?.conflicts.length)))}>{preview?.conflicts.length ? 'Confirm & deploy conflicts' : 'Deploy profile'}</button></div>{preview && <div className={preview.conflicts.length ? 'alert warning' : 'success'}><strong>{preview.conflicts.length ? 'Conflicts require review' : 'No conflicts'}</strong><span>{preview.fileCount} files · {preview.conflicts.length} conflicts</span>{preview.conflicts.map((conflict) => <span key={conflict.relativePath}>{conflict.relativePath}: {conflict.winnerModId} wins</span>)}</div>}</>}</>}</section>}
    {view === 'discover' && <DiscoverView snapshot={snapshot} onInstall={(provider, remoteModId, remoteFileId) => void run(() => window.csmm.installProviderMod(provider, remoteModId, remoteFileId))} onCreatePack={createModPack} onOpenCatalog={() => setView('catalog')} />}
    {view === 'catalog' && <CatalogView snapshot={snapshot} onInstall={(id) => void run(() => window.csmm.installCatalogMod(id))} onOpenLibrary={() => setView('library')} />}
    {view === 'library' && <LibraryView snapshot={snapshot} onImport={() => void run(() => window.csmm.importLocalMod())} onRemove={(modId) => void run(() => window.csmm.removeInstalledMod(modId))} onShare={shareInstalledMod} onInstallPack={(packId) => void run(() => window.csmm.installModPack(packId))} />}
    {view === 'server-cache' && <ServerCacheView cache={serverCache} loading={serverCacheLoading} onRefresh={() => void refreshServerCache()} onClean={() => void cleanServerCache()} />}
    {view === 'activity' && <section className="panel"><div className="section-heading"><div><h2>Activity</h2><p className="muted">Recent operation results and progress.</p></div><button className="secondary" onClick={() => void window.csmm.openManagedFolder()}>Open managed folder</button></div>{snapshot.activity.length === 0 && progress.length === 0 ? <p className="empty">No operations yet.</p> : <div className="list">{[...progress].reverse().map((item, index) => <div className="list-row" key={`${item.operationId}-${index}`}><div><strong>{item.stage}</strong><span>{item.message}</span></div></div>)}</div>}</section>}
  </main>
}
