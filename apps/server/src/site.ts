// 当前在线版本的只读视图：接口形状沿用 Petrichor 公开站，前端组件无需改动。
import { MEDIA_TYPES, type MediaExt, type Snapshot, type SnapshotArticle } from "./snapshot"

export interface PublicArticleListItem {
  articleId: string
  shareCode: string
  title: string
  excerpt: string
  updatedAt: string
  readingMinutes: number
  tags: string[]
  href: string
  expired: boolean
  hasPassword: boolean
  isRepost: boolean
  isPinned: boolean
  pinOrder: number | null
}

export interface PublicArticleDetail {
  title: string
  contentMd: string
  tags: string[]
  createdAt: string
  updatedAt: string
  isRepost: boolean
}

const EXCERPT_LENGTH = 140
// 中文按每分钟 400 字、英文按每分钟 200 词估算，至少 1 分钟。
const CJK_PER_MINUTE = 400
const WORDS_PER_MINUTE = 200

/** 去掉 Markdown 语法，得到可读的纯文本。 */
export function markdownToPlainText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function readingMinutes(markdown: string) {
  const text = markdownToPlainText(markdown)
  const cjk = text.match(/[㐀-鿿豈-﫿]/g)?.length ?? 0
  const words = text.replace(/[㐀-鿿豈-﫿]/g, " ").split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(cjk / CJK_PER_MINUTE + words / WORDS_PER_MINUTE))
}

function excerptOf(article: SnapshotArticle) {
  if (article.excerpt) return article.excerpt
  const text = markdownToPlainText(article.markdown)
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}...` : text
}

function toListItem(article: SnapshotArticle, pinOrder: number | null): PublicArticleListItem {
  return {
    articleId: article.slug,
    shareCode: article.slug,
    title: article.title,
    excerpt: excerptOf(article),
    updatedAt: article.updatedAt,
    readingMinutes: readingMinutes(article.markdown),
    tags: article.tags,
    href: `/p/${article.slug}`,
    expired: false,
    hasPassword: false,
    isRepost: false,
    isPinned: article.pinned,
    pinOrder,
  }
}

export class PublishedSite {
  readonly items: PublicArticleListItem[]
  private readonly bySlug: Map<string, SnapshotArticle>
  private readonly searchText: Map<string, { title: string; body: string }>
  private readonly media: Map<string, MediaExt>

  constructor(readonly revisionId: number, snapshot: Snapshot) {
    const pinnedCount = snapshot.articles.filter((article) => article.pinned).length
    let pinIndex = 0
    this.items = snapshot.articles.map((article) =>
      toListItem(article, article.pinned ? pinnedCount - pinIndex++ : null),
    )
    this.bySlug = new Map(snapshot.articles.map((article) => [article.slug, article]))
    this.searchText = new Map(snapshot.articles.map((article) => [
      article.slug,
      { title: article.title.toLowerCase(), body: markdownToPlainText(article.markdown).toLowerCase() },
    ]))
    this.media = new Map(snapshot.media.map((item) => [item.sha256, item.ext]))
  }

  detail(slug: string): PublicArticleDetail | null {
    const article = this.bySlug.get(slug)
    if (!article) return null
    return {
      title: article.title,
      contentMd: article.markdown,
      tags: article.tags,
      createdAt: article.createdAt,
      updatedAt: article.updatedAt,
      isRepost: false,
    }
  }

  /** 标题命中权重高于正文；同分按更新时间倒序。 */
  search(keyword: string, limit: number, offset: number) {
    const needle = keyword.trim().toLowerCase()
    if (!needle) return { items: [], hasMore: false }
    const scored = this.items
      .map((item) => {
        const text = this.searchText.get(item.shareCode)!
        const score = (text.title.includes(needle) ? 10 : 0) + (text.body.includes(needle) ? 1 : 0)
        return { ...item, score }
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || right.updatedAt.localeCompare(left.updatedAt))
    return { items: scored.slice(offset, offset + limit), hasMore: scored.length > offset + limit }
  }

  mediaType(sha256: string, ext: string) {
    const declared = this.media.get(sha256)
    return declared && declared === ext ? MEDIA_TYPES[declared] : null
  }
}
