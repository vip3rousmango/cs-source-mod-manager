import { useMemo, useState } from 'react'
import type { InstalledMod, ModPack, Snapshot } from '../shared/contracts'

interface LibraryViewProps {
  snapshot: Snapshot
  onImport: () => void
  onRemove: (modId: string) => void
  onShare: (modId: string) => Promise<void>
  onInstallPack: (packId: string) => void
}

export function LibraryView({ snapshot, onImport, onRemove, onShare, onInstallPack }: LibraryViewProps) {
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<'all' | InstalledMod['source']>('all')
  const [sharedId, setSharedId] = useState<string>()
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return snapshot.installedMods.filter((mod) => {
      const matchesSource = source === 'all' || mod.source === source
      const searchable = `${mod.title} ${mod.author ?? ''} ${mod.description ?? ''} ${mod.version}`.toLowerCase()
      return matchesSource && (!needle || searchable.includes(needle))
    })
  }, [query, source, snapshot.installedMods])
  const packs = snapshot.modPacks ?? []

  async function share(modId: string): Promise<void> {
    await onShare(modId)
    setSharedId(modId)
    window.setTimeout(() => setSharedId((current) => current === modId ? undefined : current), 1800)
  }

  return <section className="library-view">
    <div className="library-hero panel">
      <div><p className="eyebrow">Your collection</p><h2>My library</h2><p className="muted">Every mod is normalized, reversible, and ready for a profile.</p></div>
      <div className="library-stats"><div><strong>{snapshot.installedMods.length}</strong><span>installed</span></div><div><strong>{snapshot.profiles.length}</strong><span>profiles</span></div></div>
    </div>
    {packs.length > 0 && <section className="pack-library panel"><div className="section-heading"><div><p className="eyebrow">Saved loadouts</p><h3>Mod packs</h3><p className="muted">Install a full collection without repeating the download flow.</p></div><span className="catalog-count">{packs.length} saved</span></div><div className="pack-grid">{packs.map((pack) => <PackCard key={pack.id} pack={pack} onInstall={() => onInstallPack(pack.id)} />)}</div></section>}
    <div className="library-toolbar"><label className="search-field"><span className="sr-only">Search installed mods</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your library…" /></label><label className="tag-field"><span className="sr-only">Filter library source</span><select value={source} onChange={(event) => setSource(event.target.value as typeof source)}><option value="all">All sources</option><option value="provider">Community providers</option><option value="catalog">Curated</option><option value="local-folder">Imported folders</option><option value="local-zip">Imported ZIPs</option></select></label><button onClick={onImport}>Import mod</button></div>
    {filtered.length === 0 ? <div className="empty library-empty"><strong>{snapshot.installedMods.length === 0 ? 'Your library is ready for its first mod.' : 'Nothing matches this filter.'}</strong><span>{snapshot.installedMods.length === 0 ? 'Import a folder or ZIP, or discover a community mod to start building your collection.' : 'Try another title or source.'}</span>{snapshot.installedMods.length === 0 && <button onClick={onImport}>Import a mod</button>}</div> : <div className="library-grid">{filtered.map((mod) => <LibraryCard key={mod.id} mod={mod} shared={sharedId === mod.id} onRemove={onRemove} onShare={() => void share(mod.id)} />)}</div>}
  </section>
}
function PackCard({ pack, onInstall }: { pack: ModPack; onInstall: () => void }) {
  return <article className="pack-card"><div><p className="eyebrow">Saved pack</p><h3>{pack.name}</h3><span className="muted">{pack.entries.length} provider file{pack.entries.length === 1 ? '' : 's'}</span></div><div className="pack-entries">{pack.entries.slice(0, 4).map((entry) => <span key={`${entry.remoteModId}:${entry.remoteFileId}`}>{entry.title}</span>)}</div><button onClick={onInstall}>Install full pack</button></article>
}


function LibraryCard({ mod, shared, onRemove, onShare }: { mod: InstalledMod; shared: boolean; onRemove: (modId: string) => void; onShare: () => void }) {
  return <article className="library-card"><div className={`library-art library-art-${mod.source}`} aria-hidden="true"><span>{mod.title.slice(0, 1).toUpperCase()}</span><small>{sourceLabel(mod.source)}</small></div><div className="library-card-body"><div className="card-title-row"><div><h3>{mod.title}</h3><span className="muted">v{mod.version}{mod.author ? ` · ${mod.author}` : ''}</span></div><span className="status-pill">Ready</span></div><p>{mod.description || 'Normalized Source content ready for profiles.'}</p><div className="library-path"><span>Managed content</span><code>{mod.contentPath}</code></div><div className="card-actions"><button className="secondary" onClick={onShare}>{shared ? 'Copied' : 'Share'}</button><button className="danger" onClick={() => onRemove(mod.id)}>Delete</button></div></div></article>
}

function sourceLabel(source: InstalledMod['source']): string {
  if (source === 'provider') return 'Community'
  if (source === 'catalog') return 'Curated'
  if (source === 'local-folder') return 'Folder'
  return 'ZIP import'
}
