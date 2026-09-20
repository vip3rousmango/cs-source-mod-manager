import { useState } from 'react'
import type { ServerCacheSnapshot } from '../shared/contracts'

interface ServerCacheViewProps {
  cache?: ServerCacheSnapshot
  loading: boolean
  onRefresh: () => void
  onClean: () => void
}

export function ServerCacheView({ cache, loading, onRefresh, onClean }: ServerCacheViewProps) {
  const [confirming, setConfirming] = useState(false)
  if (!cache) return <section className="panel server-cache-view"><div className="loading-state">Reading server downloads…</div></section>
  const fileCount = cache.items.filter((item) => item.kind === 'file').length
  return <section className="panel server-cache-view"><div className="section-heading"><div><p className="eyebrow">Server cache</p><h2>Downloads from servers</h2><p className="muted">Review content downloaded while joining community servers. Cleaning this cache never touches your managed library.</p></div><div className="server-cache-actions"><button className="secondary" onClick={onRefresh} disabled={loading}>{loading ? 'Scanning…' : 'Scan again'}</button><button className="danger" onClick={() => setConfirming(true)} disabled={loading || fileCount === 0 || cache.truncated}>Clean cache</button></div></div>{cache.truncated && <div className="alert warning"><strong>Cache is larger than the safe preview limit.</strong><span>Cleaning is disabled until the cache is narrowed; this view shows the first {cache.items.length} items.</span></div>}{confirming && <div className="cache-confirm alert warning"><strong>Clean server downloads?</strong><span>This removes {fileCount} files ({formatBytes(cache.totalBytes)}) from:</span><code>{cache.rootPath}</code><div className="actions"><button className="danger" onClick={() => { setConfirming(false); onClean() }}>Clean {formatBytes(cache.totalBytes)}</button><button className="secondary" onClick={() => setConfirming(false)}>Keep files</button></div></div>}{!cache.available ? <div className="empty"><strong>Connect a game installation first.</strong><span>Choose Counter-Strike: Source in Setup to inspect server downloads.</span></div> : <>{cache.items.length === 0 ? <div className="empty"><strong>No server downloads found.</strong><span>Join a server and scan again to see downloaded content.</span></div> : <><div className="cache-summary"><div><strong>{formatBytes(cache.totalBytes)}</strong><span>disk space</span></div><div><strong>{fileCount}{cache.truncated ? '+' : ''}</strong><span>files</span></div><div className="cache-path"><strong>Cache location</strong><code>{cache.rootPath}</code></div></div><div className="server-cache-list">{cache.items.map((item) => <div className="server-cache-row" key={item.relativePath}><div><strong>{item.relativePath}</strong><span>{item.kind === 'directory' ? 'Folder' : formatBytes(item.sizeBytes)} · {new Date(item.modifiedAt).toLocaleString()}</span></div><span className="cache-kind">{item.kind}</span></div>)}</div></>}</>}</section>
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}
