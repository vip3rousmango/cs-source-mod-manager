import type { ActivityRecord, ProgressEvent } from '../shared/contracts'
import { Icon } from './Icon'

interface DownloadSidebarProps {
  progress: ProgressEvent[]
  activity: ActivityRecord[]
  activeOperationId?: string
  onOpenActivity: () => void
}
function formatBytes(value?: number): string {
  if (value === undefined) return ''
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export function DownloadSidebar({ progress, activity, activeOperationId, onOpenActivity }: DownloadSidebarProps) {
  const current = progress.at(-1)?.operationId === activeOperationId ? progress.at(-1) : undefined
  const recent = activity.slice(-3).reverse()
  const percent = current?.bytesTotal && current.bytesTotal > 0 ? Math.min(100, Math.round((current.bytesDone ?? 0) / current.bytesTotal * 100)) : undefined
  return <aside className="download-sidebar" aria-label="Downloads manager">
    <div className="download-sidebar-heading"><div><p className="eyebrow">Workspace rail</p><h2>Downloads</h2></div><Icon name="download" size={20} /></div>
    {current ? <div className="download-current"><div className="download-current-label"><span className="status-dot" /> <strong>{current.stage}</strong><span>{percent === undefined ? 'Working' : `${percent}%`}</span></div><p>{current.message}</p>{percent !== undefined && <div className="progress-track" aria-label={`${percent}% complete`}><span style={{ width: `${percent}%` }} /></div>}<small>{formatBytes(current.bytesDone)}{current.bytesTotal ? ` / ${formatBytes(current.bytesTotal)}` : ''}</small></div> : <div className="download-empty"><Icon name="package" size={24} /><strong>Nothing downloading</strong><span>Install a community file or build a pack. Progress stays here while you browse.</span></div>}
    <div className="download-activity"><div className="rail-heading"><span>Recent activity</span><button className="link-button" onClick={onOpenActivity}>Open all</button></div>{recent.length === 0 ? <span className="rail-muted">Your completed installs will appear here.</span> : <div className="rail-list">{recent.map((item) => <div className="rail-item" key={item.id}><Icon name={item.status === 'failure' ? 'activity' : 'download'} size={15} /><div><strong>{item.operation}</strong><span>{item.message}</span></div></div>)}</div>}</div>
  </aside>
}
