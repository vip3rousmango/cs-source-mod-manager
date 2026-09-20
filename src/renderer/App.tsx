import { useEffect, useMemo, useState } from 'react'
import { DiscoverView } from './DiscoverView'
import { LibraryView } from './LibraryView'
import { ServerCacheView } from './ServerCacheView'
import { NewsView } from './NewsView'
import { DownloadSidebar } from './DownloadSidebar'
import { Icon } from './Icon'
import { SOURCE_GAMES, type ActivityRecord, type DeploymentPreview, type ModPackEntry, type ModProfile, type ProgressEvent, type ServerCacheSnapshot, type Snapshot } from '../shared/contracts'

type View = 'discover' | 'library' | 'profiles' | 'news' | 'server-cache' | 'activity'

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'message' in error) return String(error.message)
  return 'Operation failed.'
}


export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | undefined>()
  const [view, setView] = useState<View>('profiles')
  const [error, setError] = useState<string>()
  const [progress, setProgress] = useState<ProgressEvent[]>([])
  const [profileName, setProfileName] = useState('Default')
  const [selectedProfile, setSelectedProfile] = useState<string>()
  const [activeOperationId, setActiveOperationId] = useState<string>()
  const [preview, setPreview] = useState<DeploymentPreview>()
  const [serverCache, setServerCache] = useState<ServerCacheSnapshot>()
  const [serverCacheLoading, setServerCacheLoading] = useState(false)

  async function refresh(): Promise<void> {
    try {
      const next = await window.csmm.getSnapshot()
      setSnapshot(next)
      setActiveOperationId(next.activity.find((item) => item.status === 'running')?.id)
      setError(undefined)
    } catch (operationError) {
      setError(errorMessage(operationError))
    }
  }

  async function run(operation: () => Promise<Snapshot>): Promise<void> {
    try {
      const result = await operation()
      const next = { ...await window.csmm.getSnapshot(), packInstall: result.packInstall }
      setSnapshot(next)
      setActiveOperationId(next.activity.find((item) => item.status === 'running')?.id)
      const message = next.packInstall?.failures.length ? `Pack installed ${next.packInstall.completed} item(s); ${next.packInstall.failures.length} failed.` : 'Operation completed.'
      setError(next.packInstall?.failures.length ? message : undefined)
    } catch (operationError) {
      const message = errorMessage(operationError)
      setError(message)
      try {
        const next = await window.csmm.getSnapshot()
        setSnapshot(next)
        setActiveOperationId(next.activity.find((item) => item.status === 'running')?.id)
      } catch {}
    }
  }

  async function createModPack(name: string, entries: ModPackEntry[]): Promise<void> {
    try {
      const result = await window.csmm.createModPack(name, entries)
      const next = { ...await window.csmm.getSnapshot(), packInstall: result.packInstall }
      setSnapshot(next)
      setActiveOperationId(next.activity.find((item) => item.status === 'running')?.id)
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
    try {
      setServerCache(await window.csmm.cleanServerCache(true))
      await refresh()
    } catch (operationError) {
      setError(errorMessage(operationError))
    } finally {
      setServerCacheLoading(false)
    }
  }

  async function shareInstalledMod(modId: string): Promise<void> {
    try { await window.csmm.shareInstalledMod(modId); setError(undefined) } catch (operationError) { setError(errorMessage(operationError)); throw operationError }
  }

  function openExternal(url: string): void {
    void window.csmm.openExternal(url).catch((operationError) => setError(errorMessage(operationError)))
  }

  useEffect(() => {
    void refresh()
    return window.csmm.subscribeToProgress((event) => {
      setActiveOperationId(event.operationId)
      setProgress((current) => [...current.slice(-49), event])
    })
  }, [])

  useEffect(() => {
    if (view === 'server-cache') void refreshServerCache()
  }, [view])

  const currentProfile = useMemo(() => snapshot?.profiles.find((profile) => profile.id === selectedProfile) ?? snapshot?.profiles[0], [snapshot, selectedProfile])

  if (!snapshot) return <main className="shell"><h1>CS Source Mod Manager</h1><p>Loading application state…</p></main>

  return <main className="shell">
    <header className="topbar"><div><p className="eyebrow">Steam utility</p><h1>CS Source Mod Manager</h1></div><button className="secondary" onClick={() => void refresh()}>Refresh</button></header>
    <nav className="tabs"><div className="primary-tabs">{(['discover', 'library', 'profiles'] as View[]).map((item) => <button data-view={item} key={item} className={view === item ? 'tab active' : 'tab'} onClick={() => setView(item)}><Icon name={item === 'discover' ? 'compass' : item === 'library' ? 'library' : 'layers'} size={15} /> {item === 'library' ? 'collection' : item}</button>)}<button data-view="news" className={view === 'news' ? 'tab active' : 'tab'} onClick={() => setView('news')}><Icon name="news" size={15} /> news</button></div><div className="utility-tabs"><button data-view="server-cache" className={view === 'server-cache' ? 'tab active' : 'tab'} onClick={() => setView('server-cache')}><Icon name="download" size={15} /> server downloads</button><button data-view="activity" className={view === 'activity' ? 'tab active' : 'tab'} onClick={() => setView('activity')}><Icon name="activity" size={15} /> activity</button></div></nav>
    {error && <div className="alert error"><strong>Operation failed</strong><span>{error}</span></div>}
    {snapshot.recoveryRequired && <div className="alert error"><strong>Recovery required</strong><span>{snapshot.recoveryRequired}</span></div>}
    <div className="workspace-layout"><div className="workspace-main">
    {view === 'profiles' && <section className="panel setup-inline"><div className="section-heading"><div><p className="eyebrow">Workspace</p><h3>Game coverage & setup</h3><p className="muted">Set up the installation once. Available Source games stay visible in Discover, while Profiles remains the place to deploy safely.</p></div><span className={snapshot.game ? 'status-pill' : 'catalog-count'}>{snapshot.game ? 'Connected' : 'Needs setup'}</span></div><div className="coverage-grid">{SOURCE_GAMES.map((game) => <article className={`coverage-card${game.installable ? ' available' : ''}`} key={game.id}><span className="coverage-icon" aria-hidden="true">{game.label.slice(0, 2).toUpperCase()}</span><strong>{game.label}</strong><span>{game.installable ? 'Install + browse' : 'Browse only'}</span></article>)}</div><div className="setup-game-grid"><div><strong>Counter-Strike: Source installation</strong><span className="muted">{snapshot.game ? snapshot.game.installPath : 'Detect Steam or choose a validated directory.'}</span></div><button onClick={() => void run(() => window.csmm.discoverGame())}>Detect Steam</button><button className="secondary" onClick={() => void run(() => window.csmm.chooseGameDirectory())}>Choose directory</button></div></section>}
    {view === 'profiles' && <section className="panel"><div className="section-heading"><div><h2>Profiles</h2><p className="muted">Priority is explicit; higher values win conflicts.</p></div><div className="inline-form"><input value={profileName} onChange={(event) => setProfileName(event.target.value)} aria-label="New profile name" /><button onClick={() => void run(() => window.csmm.createProfile(profileName))}>Create</button></div></div>{snapshot.profiles.length === 0 ? <p className="empty">Create a profile to compose installed mods.</p> : <><label className="field">Profile<select value={currentProfile?.id ?? ''} onChange={(event) => { setSelectedProfile(event.target.value); setPreview(undefined) }}>{snapshot.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>{currentProfile && <><div className="list">{snapshot.installedMods.length === 0 ? <p className="empty">Import a mod before composing this profile.</p> : snapshot.installedMods.map((mod) => { const entry = currentProfile.entries.find((candidate) => candidate.modId === mod.id); const enabled = entry?.enabled ?? false; return <div className="list-row" key={mod.id}><label className="check"><input type="checkbox" checked={enabled} onChange={(event) => { const entries = currentProfile.entries.filter((candidate) => candidate.modId !== mod.id); entries.push({ modId: mod.id, enabled: event.target.checked, priority: entry?.priority ?? 0 }); void updateProfile(currentProfile, entries) }} /><span><strong>{mod.title}</strong><small>{mod.source} · {mod.version}</small></span></label><input className="priority" type="number" value={entry?.priority ?? 0} aria-label={`${mod.title} priority`} onChange={(event) => { const entries = currentProfile.entries.filter((candidate) => candidate.modId !== mod.id); entries.push({ modId: mod.id, enabled, priority: Number(event.target.value) || 0 }); void updateProfile(currentProfile, entries) }} /></div> })}</div><div className="actions"><button onClick={async () => { try { setPreview(await window.csmm.previewProfile(currentProfile.id)); setError(undefined) } catch (operationError) { setError(errorMessage(operationError)) } }}>Preview deployment</button><button onClick={() => void run(() => window.csmm.deployProfile(currentProfile.id, Boolean(preview?.conflicts.length)))}>{preview?.conflicts.length ? 'Confirm & deploy conflicts' : 'Deploy profile'}</button></div>{preview && <div className={preview.conflicts.length ? 'alert warning' : 'success'}><strong>{preview.conflicts.length ? 'Conflicts require review' : 'No conflicts'}</strong><span>{preview.fileCount} files · {preview.conflicts.length} conflicts</span>{preview.conflicts.map((conflict) => <span key={conflict.relativePath}>{conflict.relativePath}: {conflict.winnerModId} wins</span>)}</div>}</>}</>}</section>}
    {view === 'discover' && <DiscoverView snapshot={snapshot} onInstall={(provider, remoteModId, remoteFileId) => void run(() => window.csmm.installProviderMod(provider, remoteModId, remoteFileId))} onCreatePack={createModPack} onOpenCatalog={() => setView('library')} />}
    {view === 'news' && <NewsView onOpenExternal={openExternal} />}
    {view === 'library' && <LibraryView snapshot={snapshot} onImport={() => void run(() => window.csmm.importLocalMod())} onRemove={(modId) => void run(() => window.csmm.removeInstalledMod(modId))} onShare={shareInstalledMod} onInstallPack={(packId) => void run(() => window.csmm.installModPack(packId))} onInstallCatalog={(id) => void run(() => window.csmm.installCatalogMod(id))} />}
    {view === 'server-cache' && <ServerCacheView cache={serverCache} loading={serverCacheLoading} onRefresh={() => void refreshServerCache()} onClean={() => void cleanServerCache()} />}
    {view === 'activity' && <section className="panel"><div className="section-heading"><div><h2>Activity</h2><p className="muted">Recent operation results and progress.</p></div><button className="secondary" onClick={() => void window.csmm.openManagedFolder()}>Open managed folder</button></div>{snapshot.activity.length === 0 && progress.length === 0 ? <p className="empty">No operations yet.</p> : <div className="list">{[...snapshot.activity].reverse().map((item) => <div className="list-row" key={item.id}><div><strong>{item.operation}</strong><span>{item.message}</span></div><span className="muted">{item.status}</span></div>)}</div>}</section>}
    </div><DownloadSidebar progress={progress} activity={snapshot.activity} activeOperationId={activeOperationId} onOpenActivity={() => setView('activity')} /></div>
  </main>
}
