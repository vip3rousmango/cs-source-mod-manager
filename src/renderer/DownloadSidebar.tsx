import type { ActivityRecord, ProgressEvent } from '../shared/contracts'
import { Icon } from './Icon'

interface DownloadSidebarProps {
  progress: ProgressEvent[]
  activity: ActivityRecord[]
  activeOperationId?: string
  onOpenActivity: () => void
  onCancel: () => void
}
function formatBytes(value?: number): string {
  if (value === undefined) return ''
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export function DownloadSidebar({ progress, activity, activeOperationId, onOpenActivity, onCancel }: DownloadSidebarProps) {
  const current = progress.at(-1)?.operationId === activeOperationId ? progress.at(-1) : undefined
  const activeRecord = activity.find((item) => item.id === activeOperationId && item.status === 'running')
  const isInstallOperation = Boolean(current && ['downloading', 'validating', 'staging'].includes(current.stage)) || /install|import/i.test(activeRecord?.operation ?? '')
  const visibleProgress = isInstallOperation ? current : undefined
  const visibleRecord = isInstallOperation ? activeRecord : undefined
  const canCancel = Boolean(visibleProgress && ['downloading', 'validating', 'staging'].includes(visibleProgress.stage))
  const recent = activity.slice(-3).reverse()
  const percent = visibleProgress?.bytesTotal && visibleProgress.bytesTotal > 0 ? Math.min(100, Math.round((visibleProgress.bytesDone ?? 0) / visibleProgress.bytesTotal * 100)) : undefined
  return <aside className="download-sidebar" aria-label="Downloads manager">
    <div className="download-sidebar-heading"><div><p className="eyebrow">Workspace rail</p><h2>Downloads</h2></div><Icon name="download" size={20} /></div>
    {visibleProgress || visibleRecord ? <div className="download-current"><div className="download-current-label"><span className="status-dot" /> <strong>{visibleProgress ? stageLabel(visibleProgress.stage) : 'Preparing install'}</strong><span>{percent === undefined ? 'Working' : `${percent}%`}</span></div><p>{visibleProgress?.message ?? 'Waiting for the provider response before downloading.'}</p>{percent !== undefined && <div className="progress-track" aria-label={`${percent}% complete`}><span style={{ width: `${percent}%` }} /></div>}<small>{formatBytes(visibleProgress?.bytesDone)}{visibleProgress?.bytesTotal ? ` / ${formatBytes(visibleProgress.bytesTotal)}` : ''}</small>{canCancel && <button className="secondary cancel-button" onClick={onCancel}>Cancel operation</button>}</div> : <div className="download-empty"><Icon name="package" size={24} /><strong>Nothing downloading</strong><span>Install a community file or build a pack. Progress stays here while you browse.</span></div>}
    <div className="download-activity"><div className="rail-heading"><span>Recent activity</span><button className="link-button" onClick={onOpenActivity}>Open all</button></div>{recent.length === 0 ? <span className="rail-muted">Your completed installs will appear here.</span> : <div className="rail-list">{recent.map((item) => <div className="rail-item" key={item.id}><Icon name={item.status === 'failure' ? 'activity' : 'download'} size={15} /><div><strong>{item.operation}</strong><span>{item.message}</span></div><span className={`activity-status ${item.status}`}>{item.status}</span></div>)}</div>}</div>
  </aside>
}

function stageLabel(stage: ProgressEvent['stage']): string {
  if (stage === 'validating') return 'Validating archive'
  if (stage === 'staging') return 'Installing managed content'
  if (stage === 'downloading') return 'Downloading archive'
  if (stage === 'deploying') return 'Deploying profile'
  if (stage === 'discovering') return 'Detecting games'
  return 'Working'
}
