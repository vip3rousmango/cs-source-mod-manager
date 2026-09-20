import { useEffect, useMemo, useState } from 'react'
import type { DeploymentPreview, ModProfile, ProgressEvent, Snapshot } from '../shared/contracts'

type View = 'setup' | 'catalog' | 'library' | 'profiles' | 'activity'

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'message' in error) return String(error.message)
  return 'Operation failed.'
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | undefined>()
  const [view, setView] = useState<View>('setup')
  const [error, setError] = useState<string>()
  const [progress, setProgress] = useState<ProgressEvent[]>([])
  const [profileName, setProfileName] = useState('Default')
  const [selectedProfile, setSelectedProfile] = useState<string>()
  const [preview, setPreview] = useState<DeploymentPreview>()

  async function refresh(): Promise<void> {
    try { setSnapshot(await window.csmm.getSnapshot()); setError(undefined) } catch (operationError) { setError(errorMessage(operationError)) }
  }

  async function run(operation: () => Promise<Snapshot>): Promise<void> {
    try { setSnapshot(await operation()); setError(undefined) } catch (operationError) { setError(errorMessage(operationError)) }
  }

  async function updateProfile(profile: ModProfile, entries: ModProfile['entries']): Promise<void> {
    await run(() => window.csmm.updateProfile({ ...profile, entries, updatedAt: new Date().toISOString() }))
    setPreview(undefined)
  }

  useEffect(() => {
    void refresh()
    return window.csmm.subscribeToProgress((event) => setProgress((current) => [...current.slice(-49), event]))
  }, [])

  const currentProfile = useMemo(() => snapshot?.profiles.find((profile) => profile.id === selectedProfile) ?? snapshot?.profiles[0], [snapshot, selectedProfile])

  if (!snapshot) return <main className="shell"><h1>CS Source Mod Manager</h1><p>Loading application state…</p></main>

  return <main className="shell">
    <header className="topbar"><div><p className="eyebrow">Steam utility</p><h1>CS Source Mod Manager</h1></div><button className="secondary" onClick={() => void refresh()}>Refresh</button></header>
    <nav className="tabs">{(['setup', 'catalog', 'library', 'profiles', 'activity'] as View[]).map((item) => <button key={item} className={view === item ? 'tab active' : 'tab'} onClick={() => setView(item)}>{item}</button>)}</nav>
    {error && <div className="alert error"><strong>Operation failed</strong><span>{error}</span></div>}
    {snapshot.recoveryRequired && <div className="alert error"><strong>Recovery required</strong><span>{snapshot.recoveryRequired}</span></div>}
    {view === 'profiles' && <section className="panel"><div className="section-heading"><div><h2>Profiles</h2><p className="muted">Priority is explicit; higher values win conflicts.</p></div><div className="inline-form"><input value={profileName} onChange={(event) => setProfileName(event.target.value)} aria-label="New profile name" /><button onClick={() => void run(() => window.csmm.createProfile(profileName))}>Create</button></div></div>{snapshot.profiles.length === 0 ? <p className="empty">Create a profile to compose installed mods.</p> : <><label className="field">Profile<select value={currentProfile?.id ?? ''} onChange={(event) => { setSelectedProfile(event.target.value); setPreview(undefined) }}>{snapshot.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>{currentProfile && <><div className="list">{snapshot.installedMods.length === 0 ? <p className="empty">Import a mod before composing this profile.</p> : snapshot.installedMods.map((mod) => { const entry = currentProfile.entries.find((candidate) => candidate.modId === mod.id); const enabled = entry?.enabled ?? false; return <div className="list-row" key={mod.id}><label className="check"><input type="checkbox" checked={enabled} onChange={(event) => { const entries = currentProfile.entries.filter((candidate) => candidate.modId !== mod.id); entries.push({ modId: mod.id, enabled: event.target.checked, priority: entry?.priority ?? 0 }); void updateProfile(currentProfile, entries) }} /><span><strong>{mod.title}</strong><small>{mod.source} · {mod.version}</small></span></label><input className="priority" type="number" value={entry?.priority ?? 0} aria-label={`${mod.title} priority`} onChange={(event) => { const entries = currentProfile.entries.filter((candidate) => candidate.modId !== mod.id); entries.push({ modId: mod.id, enabled, priority: Number(event.target.value) || 0 }); void updateProfile(currentProfile, entries) }} /></div> })}</div><div className="actions"><button onClick={async () => { try { setPreview(await window.csmm.previewProfile(currentProfile.id)); setError(undefined) } catch (operationError) { setError(errorMessage(operationError)) } }}>Preview deployment</button><button onClick={() => void run(() => window.csmm.deployProfile(currentProfile.id, Boolean(preview?.conflicts.length)))}>{preview?.conflicts.length ? 'Confirm & deploy conflicts' : 'Deploy profile'}</button></div>{preview && <div className={preview.conflicts.length ? 'alert warning' : 'success'}><strong>{preview.conflicts.length ? 'Conflicts require review' : 'No conflicts'}</strong><span>{preview.fileCount} files · {preview.conflicts.length} conflicts</span>{preview.conflicts.map((conflict) => <span key={conflict.relativePath}>{conflict.relativePath}: {conflict.winnerModId} wins</span>)}</div>}</>}</>}</section>}
    {view === 'setup' && <section className="panel"><h2>Game setup</h2><p className="muted">The manager only writes to its own folder under <code>cstrike/custom</code>.</p><div className="actions"><button onClick={() => void run(() => window.csmm.discoverGame())}>Detect Steam installation</button><button className="secondary" onClick={() => void run(() => window.csmm.chooseGameDirectory())}>Choose directory</button></div>{snapshot.game ? <div className="success"><strong>Connected</strong><span>{snapshot.game.installPath}</span></div> : <p className="empty">No Counter-Strike: Source installation selected.</p>}</section>}
    {view === 'catalog' && <section className="panel"><div className="section-heading"><div><h2>Curated catalog</h2><p className="muted">Catalog entries are verified ZIP archives bundled with the app.</p></div></div>{snapshot.catalog.entries.length === 0 ? <p className="empty">No catalog entries are bundled yet. Import a local ZIP from Library.</p> : <div className="cards">{snapshot.catalog.entries.map((entry) => <article className="card" key={entry.id}><h3>{entry.title}</h3><p>{entry.description}</p><p className="muted">v{entry.version} · {(entry.archiveSizeBytes / 1024 / 1024).toFixed(1)} MB</p><button onClick={() => void run(() => window.csmm.installCatalogMod(entry.id))}>Install</button></article>)}</div>}</section>}
    {view === 'library' && <section className="panel"><div className="section-heading"><div><h2>Library</h2><p className="muted">Normalized content is stored outside the game directory.</p></div><button onClick={() => void run(() => window.csmm.importLocalMod())}>Import folder or ZIP</button></div>{snapshot.installedMods.length === 0 ? <p className="empty">No installed mods.</p> : <div className="list">{snapshot.installedMods.map((mod) => <div className="list-row" key={mod.id}><div><strong>{mod.title}</strong><span>{mod.source} · {mod.version}</span></div><button className="danger" onClick={() => void run(() => window.csmm.removeInstalledMod(mod.id))}>Remove</button></div>)}</div>}</section>}
    {view === 'activity' && <section className="panel"><div className="section-heading"><div><h2>Activity</h2><p className="muted">Recent operation results and progress.</p></div><button className="secondary" onClick={() => void window.csmm.openManagedFolder()}>Open managed folder</button></div>{snapshot.activity.length === 0 && progress.length === 0 ? <p className="empty">No operations yet.</p> : <div className="list">{[...progress].reverse().map((item, index) => <div className="list-row" key={`${item.operationId}-${index}`}><div><strong>{item.stage}</strong><span>{item.message}</span></div></div>)}</div>}</section>}
  </main>
}
