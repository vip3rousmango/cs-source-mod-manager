import { useEffect, useMemo, useState } from 'react'
import type { CommunityNewsArticle, CommunityNewsItem, CommunityNewsSnapshot } from '../shared/contracts'
import { Icon } from './Icon'

interface NewsViewProps {
  onOpenExternal: (url: string) => void
}

export function NewsView({ onOpenExternal }: NewsViewProps) {
  const [snapshot, setSnapshot] = useState<CommunityNewsSnapshot>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [feedFilter, setFeedFilter] = useState('all')
  const [article, setArticle] = useState<CommunityNewsArticle>()
  const [articleLoading, setArticleLoading] = useState(false)
  const [articleError, setArticleError] = useState<string>()

  async function refresh(forceRefresh = false): Promise<void> {
    setLoading(true)
    try { setSnapshot(await window.csmm.getCommunityNews(forceRefresh)); setError(undefined) } catch (operationError) { setError(operationError instanceof Error ? operationError.message : 'Could not load community news.') } finally { setLoading(false) }
  }
  useEffect(() => { void refresh() }, [])
  const items = useMemo(() => snapshot?.items.filter((item) => feedFilter === 'all' || item.feedId === feedFilter) ?? [], [feedFilter, snapshot])

  async function openArticle(item: CommunityNewsItem): Promise<void> {
    setArticleLoading(true)
    setArticleError(undefined)
    try { setArticle(await window.csmm.getCommunityNewsArticle(item.id)) } catch (operationError) { setArticleError(operationError instanceof Error ? operationError.message : 'Could not load this article.') } finally { setArticleLoading(false) }
  }

  return <section className="news-page">
    <div className="news-hero panel"><div><p className="eyebrow">Community desk</p><h2>What is happening in Source?</h2><p className="hero-copy">Read public Counter-Strike: Source news, releases, addons, downloads, and Source SDK updates without losing your place in the app.</p></div><div className="news-hero-mark" aria-hidden="true"><Icon name="news" size={48} /><span>RSS</span></div></div>
    <div className="news-toolbar"><label className="source-control"><span>Source</span><select value={feedFilter} onChange={(event) => setFeedFilter(event.target.value)}><option value="all">All community sources</option>{snapshot?.feeds.map((feed) => <option key={feed.id} value={feed.id}>{feed.label}</option>)}</select></label><button className="secondary" onClick={() => void refresh(true)} disabled={loading}><Icon name="refresh" size={16} /> {loading ? 'Refreshing…' : 'Refresh feeds'}</button>{snapshot && <span className="muted">Updated {formatDate(snapshot.refreshedAt)}</span>}</div>
    {error && <div className="alert error"><strong>Community feeds unavailable</strong><span>{error}</span></div>}
    <div className="news-layout"><section className="news-list" aria-live="polite">{loading && !snapshot ? <div className="loading-state"><Icon name="refresh" size={28} /><strong>Checking community sources…</strong></div> : items.length === 0 ? <div className="empty"><strong>No feed items yet.</strong><span>Try refreshing or change the source filter.</span></div> : items.map((item) => <NewsCard key={item.id} item={item} onOpen={() => void openArticle(item)} />)}</section><aside className="source-directory panel"><div className="section-heading"><div><p className="eyebrow">Public sources</p><h3>Community directory</h3></div><Icon name="layers" size={20} /></div><p className="muted">Approved sources stay inside the manager. Choose an article to read a safe text view, then jump to the original source only when you need the full site.</p><div className="source-list">{snapshot?.feeds.map((feed) => <button className="source-row" key={feed.id} onClick={() => setFeedFilter(feed.id)}><span className={`source-status ${feed.status}`} /><span><strong>{feed.label}</strong><small>{feed.description}</small>{feed.error && <em>{feed.error}</em>}</span><Icon name="chevron" size={14} /></button>)}</div></aside></div>
    {(article || articleLoading || articleError) && <ArticleReader article={article} loading={articleLoading} error={articleError} onClose={() => { setArticle(undefined); setArticleError(undefined) }} onOpenExternal={onOpenExternal} />}
  </section>
}

function NewsCard({ item, onOpen }: { item: CommunityNewsItem; onOpen: () => void }) {
  return <article className="news-card"><div className="news-card-meta"><span>{item.sourceLabel}</span><time dateTime={item.publishedAt}>{formatDate(item.publishedAt)}</time></div><h3>{item.title}</h3><p>{item.summary}</p><button className="link-button" onClick={onOpen}>Read inside app <Icon name="chevron" size={14} /></button></article>
}

function ArticleReader({ article, loading, error, onClose, onOpenExternal }: { article?: CommunityNewsArticle; loading: boolean; error?: string; onClose: () => void; onOpenExternal: (url: string) => void }) {
  return <div className="article-reader-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="article-reader panel" role="dialog" aria-modal="true" aria-label="Community article"><div className="article-reader-toolbar"><button className="secondary" onClick={onClose}><Icon name="chevron" size={14} /> Back to news</button>{article && <button className="secondary" onClick={() => onOpenExternal(article.url)}>Open original source <Icon name="external" size={14} /></button>}</div>{loading && <div className="loading-state">Loading the article…</div>}{error && <div className="alert error"><strong>Article unavailable</strong><span>{error}</span></div>}{article && !loading && <article className="article-reader-content"><p className="eyebrow">{article.sourceLabel} · {formatDate(article.publishedAt)}</p><h2>{article.title}</h2><p className="article-reader-source">{article.url}</p><div className="article-reader-body">{article.body.split(/\n{2,}/).filter(Boolean).map((paragraph, index) => <p key={`${article.id}-${index}`}>{paragraph}</p>)}</div></article>}</section></div>
}

function formatDate(value?: string): string {
  if (!value) return 'Recently'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Recently' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
