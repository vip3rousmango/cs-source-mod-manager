import type { CommunityFeedId, CommunityFeedSource, CommunityFeedState, CommunityNewsArticle, CommunityNewsItem, CommunityNewsSnapshot } from '../../shared/contracts'

interface FeedDefinition extends CommunityFeedSource {
  allowedHosts: string[]
}

const FEEDS: FeedDefinition[] = [
  { id: 'steam-news', label: 'Steam News', description: 'Official Counter-Strike: Source news and updates.', feedUrl: 'https://store.steampowered.com/feeds/news/app/240/', siteUrl: 'https://store.steampowered.com/app/240/', allowedHosts: ['store.steampowered.com'] },
  { id: 'gamebanana-feed', label: 'GameBanana', description: 'New and updated Counter-Strike: Source submissions.', feedUrl: 'https://api.gamebanana.com/Rss/New?gameid=2&include_updated=1', siteUrl: 'https://gamebanana.com/games/2', allowedHosts: ['api.gamebanana.com', 'gamebanana.com'] },
  { id: 'moddb-downloads', label: 'ModDB Downloads', description: 'New Counter-Strike: Source downloads.', feedUrl: 'https://rss.moddb.com/games/counter-strike-source/downloads/feed/rss.xml', siteUrl: 'https://www.moddb.com/games/counter-strike-source/downloads', allowedHosts: ['rss.moddb.com', 'www.moddb.com'] },
  { id: 'moddb-articles', label: 'ModDB Articles', description: 'Articles and community updates from ModDB.', feedUrl: 'https://rss.moddb.com/games/counter-strike-source/articles/feed/rss.xml', siteUrl: 'https://www.moddb.com/games/counter-strike-source', allowedHosts: ['rss.moddb.com', 'www.moddb.com'] },
  { id: 'moddb-addons', label: 'ModDB Addons', description: 'New Counter-Strike: Source addons.', feedUrl: 'https://rss.moddb.com/games/counter-strike-source/addons/feed/rss.xml', siteUrl: 'https://www.moddb.com/games/counter-strike-source/addons', allowedHosts: ['rss.moddb.com', 'www.moddb.com'] },
  { id: 'valve-developer', label: 'Valve Developer Community', description: 'Recent Source SDK, Hammer, and VDC updates.', feedUrl: 'https://developer.valvesoftware.com/w/index.php?title=Special:RecentChanges&feed=rss&namespace=0', siteUrl: 'https://developer.valvesoftware.com/wiki/Main_Page', allowedHosts: ['developer.valvesoftware.com'] }
]

const MAX_FEED_BYTES = 1_000_000
const MAX_ITEMS_PER_FEED = 12
const CACHE_MS = 5 * 60 * 1000

function decodeXml(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code))).replace(/\s+/g, ' ').trim()
}

function tagValue(value: string, tag: string): string {
  const match = value.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))
  return match ? decodeXml(match[1]) : ''
}

function linkValue(value: string): string {
  const atom = value.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i)?.[1]
  return atom ?? tagValue(value, 'link')
}

function itemId(feedId: CommunityFeedId, title: string, url: string): string {
  return `${feedId}:${url || title}`
}

function parseItems(feed: FeedDefinition, xml: string): CommunityNewsItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].slice(0, MAX_ITEMS_PER_FEED)
  return blocks.flatMap((match) => {
    const block = match[2]
    const title = tagValue(block, 'title')
    const url = linkValue(block)
    if (!title || !url) return []
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' || !feed.allowedHosts.includes(parsed.hostname)) return []
      return [{ id: itemId(feed.id, title, parsed.href), feedId: feed.id, sourceLabel: feed.label, title, summary: tagValue(block, 'description') || tagValue(block, 'summary') || 'Open the community source for the latest details.', url: parsed.href, publishedAt: tagValue(block, 'pubDate') || tagValue(block, 'published') || tagValue(block, 'updated') || undefined }]
    } catch {
      return []
    }
  })
}

function validFeedUrl(feed: FeedDefinition, value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && feed.allowedHosts.includes(url.hostname)
  } catch {
    return false
  }
}
async function readFeedText(response: Response): Promise<string> {
  if (!response.body) throw new Error('Feed response had no body.')
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let byteCount = 0
  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    byteCount += chunk.byteLength
    if (byteCount > MAX_FEED_BYTES) throw new Error('Feed response exceeded the safety limit.')
    chunks.push(decoder.decode(chunk, { stream: true }))
  }
  chunks.push(decoder.decode())
  return chunks.join('')
}
const MAX_ARTICLE_BYTES = 2_000_000

function articleText(html: string): string {
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? html
  const withoutNoise = article.replace(/<(script|style|noscript|nav|footer|form)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
  const withBreaks = withoutNoise.replace(/<\/(p|div|section|article|h[1-6]|li|br)>/gi, '\n\n')
  const text = decodeXml(withBreaks.replace(/<[^>]+>/g, ' ')).replace(/\n[ \t]+/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return text.slice(0, 20_000)
}

async function readArticleText(response: Response): Promise<string> {
  if (!response.body) throw new Error('Article response had no body.')
  const decoder = new TextDecoder()
  const chunks: string[] = []
  let byteCount = 0
  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    byteCount += chunk.byteLength
    if (byteCount > MAX_ARTICLE_BYTES) throw new Error('Article response exceeded the safety limit.')
    chunks.push(decoder.decode(chunk, { stream: true }))
  }
  chunks.push(decoder.decode())
  return chunks.join('')
}

function isFeedDocument(xml: string): boolean {
  return /^\s*(?:<\?xml[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<(?:rss|feed|rdf:RDF)\b/i.test(xml)
}

function validFeedContentType(response: Response): boolean {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  return !contentType || contentType === 'application/rss+xml' || contentType === 'application/atom+xml' || contentType === 'application/xml' || contentType === 'text/xml' || contentType === 'application/rdf+xml' || contentType.endsWith('+xml')
}

async function fetchFeed(feed: FeedDefinition): Promise<CommunityFeedState & { items: CommunityNewsItem[] }> {
  const { allowedHosts: _allowedHosts, ...source } = feed
  let currentUrl = feed.feedUrl
  try {
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      if (!validFeedUrl(feed, currentUrl)) throw new Error('Feed redirect left the approved source host.')
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8_000)
      try {
        const response = await fetch(currentUrl, { redirect: 'manual', signal: controller.signal, headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } })
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          await response.body?.cancel().catch(() => undefined)
          if (!location) throw new Error('Feed returned an invalid redirect.')
          currentUrl = new URL(location, currentUrl).href
          continue
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        if (!validFeedContentType(response)) throw new Error('Feed returned a non-XML response.')
        const xml = await readFeedText(response)
        if (!isFeedDocument(xml)) throw new Error('Feed returned an invalid RSS or Atom document.')
        const items = parseItems(feed, xml)
        return { ...source, status: 'ok', itemCount: items.length, items }
      } finally {
        clearTimeout(timeout)
      }
    }
    throw new Error('Feed returned too many redirects.')
  } catch (error) {
    return { ...source, status: 'error', itemCount: 0, error: error instanceof Error ? error.message : 'Feed could not be loaded.', items: [] }
  }
}

export class CommunityNewsService {
  private cached?: { expiresAt: number; snapshot: CommunityNewsSnapshot }

  async getSnapshot(forceRefresh = false): Promise<CommunityNewsSnapshot> {
    if (!forceRefresh && this.cached && this.cached.expiresAt > Date.now()) return this.cached.snapshot
    const results = await Promise.all(FEEDS.map((feed) => fetchFeed(feed)))
    const items = results.flatMap((result) => result.items).sort((left, right) => Date.parse(right.publishedAt ?? '') - Date.parse(left.publishedAt ?? '')).slice(0, 60)
    const snapshot: CommunityNewsSnapshot = { refreshedAt: new Date().toISOString(), items, feeds: results.map(({ items: _items, ...feed }) => feed) }
    this.cached = { expiresAt: Date.now() + CACHE_MS, snapshot }
    return snapshot
  }
  async getArticle(id: string): Promise<CommunityNewsArticle> {
    const snapshot = await this.getSnapshot()
    const item = snapshot.items.find((candidate) => candidate.id === id)
    if (!item) throw new Error('News item was not found. Refresh the community desk and try again.')
    const feed = FEEDS.find((candidate) => candidate.id === item.feedId)
    if (!feed || !validFeedUrl(feed, item.url)) throw new Error('This article is not available from an approved community source.')
    let currentUrl = item.url
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      if (!validFeedUrl(feed, currentUrl)) throw new Error('Article redirect left the approved source host.')
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10_000)
      try {
        const response = await fetch(currentUrl, { redirect: 'manual', signal: controller.signal, headers: { accept: 'text/html, application/xhtml+xml' } })
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          await response.body?.cancel().catch(() => undefined)
          if (!location) throw new Error('Article returned an invalid redirect.')
          currentUrl = new URL(location, currentUrl).href
          continue
        }
        if (!response.ok) throw new Error(`Article returned HTTP ${response.status}.`)
        const body = articleText(await readArticleText(response))
        return { ...item, body: body || item.summary }
      } finally {
        clearTimeout(timeout)
      }
    }
    throw new Error('Article returned too many redirects.')
  }
}
