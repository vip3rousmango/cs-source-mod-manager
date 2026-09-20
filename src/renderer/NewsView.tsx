import { useEffect, useMemo, useState } from 'react'
import type { CommunityNewsItem, CommunityNewsSnapshot } from '../shared/contracts'
import { Icon } from './Icon'

interface NewsViewProps {
  onOpenExternal: (url: string) => void
}

export function NewsView({ onOpenExternal }: NewsViewProps) {
  const [snapshot, setSnapshot] = useState<CommunityNewsSnapshot>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [feedFilter, setFeedFilter] = useState('all')

  async function refresh(forceRefresh = false): Promise<void> {
    setLoading(true)
    try { setSnapshot(await window.csmm.getCommunityNews(forceRefresh)); setError(undefined) } catch (operationError) { setError(operationError instanceof Error ? operationError.message : 'Could not load community news.') } finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, [])

  const items = useMemo(() => snapshot?.items.filter((item) => feedFilter === 'all' || item.feedId === feedFilter) ?? [], [feedFilter, snapshot])
  return <section className="news-page">
    <div className="news-hero panel"><div><p className="eyebrow">Community desk</p><h2>What is happening in Source?</h2><p className="hero-copy">A focused stream of public Counter-Strike: Source news, releases, addons, downloads, and Source SDK updates. Feeds are read-only and limited to approved public sources.</p></div><div className="news-hero-mark" aria-hidden="true"><Icon name="news" size={48} /><span>RSS</span></div></div>
    <div className="news-toolbar"><label className="source-control"><span className="sr-only">News source</span><select value={feedFilter} onChange={(event) => setFeedFilter(event.target.value)}><option value="all">All community sources</option>{snapshot?.feeds.map((feed) => <option key={feed.id} value={feed.id}>{feed.label}</option>)}</select></label><button className="secondary" onClick={() => void refresh(true)} disabled={loading}><Icon name="refresh" size={16} /> {loading ? 'Refreshing…' : 'Refresh feeds'}</button>{snapshot && <span className="muted">Updated {formatDate(snapshot.refreshedAt)}</span>}</div>
    {error && <div className="alert error"><strong>Community feeds unavailable</strong><span>{error}</span></div>}
    <div className="news-layout"><section className="news-list" aria-live="polite">{loading && !snapshot ? <div className="loading-state"><Icon name="refresh" size={28} /><strong>Checking community sources…</strong></div> : items.length === 0 ? <div className="empty"><strong>No feed items yet.</strong><span>Try refreshing or open one of the source directories on the right.</span></div> : items.map((item) => <NewsCard key={item.id} item={item} onOpenExternal={onOpenExternal} />)}</section><aside className="source-directory panel"><div className="section-heading"><div><p className="eyebrow">Public sources</p><h3>Community directory</h3></div><Icon name="layers" size={20} /></div><p className="muted">These sources remain useful even when an individual feed is offline.</p><div className="source-list">{snapshot?.feeds.map((feed) => <button className="source-row" key={feed.id} onClick={() => onOpenExternal(feed.siteUrl)}><span className={`source-status ${feed.status}`} aria-label={feed.status === 'ok' ? 'Feed online' : 'Feed unavailable'} /><span><strong>{feed.label}</strong><small>{feed.description}</small>{feed.status === 'error' && <em>{feed.error}</em>}</span><Icon name="external" size={15} /></button>)}</div></aside></div>
  </section>
}

function NewsCard({ item, onOpenExternal }: { item: CommunityNewsItem; onOpenExternal: (url: string) => void }) {
  return <article className="news-card"><div className="news-card-meta"><span>{item.sourceLabel}</span><time dateTime={item.publishedAt}>{formatDate(item.publishedAt)}</time></div><h3>{item.title}</h3><p>{item.summary}</p><button className="link-button" onClick={() => onOpenExternal(item.url)}>Read source <Icon name="external" size={14} /></button></article>
}

function formatDate(value?: string): string {
  if (!value) return 'Recently'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Recently' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
