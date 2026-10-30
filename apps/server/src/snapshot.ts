// 发布快照：客户端过滤后推送的唯一数据契约（协议见 docs/protocol.md）。
// 服务端只做结构与引用校验，不判断内容能否公开——那是客户端隐私过滤的职责。

export const SNAPSHOT_VERSION = 1
export const SUPPORTED_SNAPSHOT_VERSIONS = [1] as const

export interface SnapshotArticle {
  slug: string
  title: string
  markdown: string
  excerpt: string
  tags: string[]
  createdAt: string
  updatedAt: string
  pinned: boolean
}

export interface SnapshotMedia {
  sha256: string
  ext: MediaExt
  size: number
}

export interface Snapshot {
  snapshotVersion: number
  generatedAt: string
  articles: SnapshotArticle[]
  media: SnapshotMedia[]
}

export const MEDIA_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
} as const

export type MediaExt = keyof typeof MEDIA_TYPES

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,127}$/
export const SHA256_PATTERN = /^[0-9a-f]{64}$/

const LIMITS = {
  articles: 5000,
  titleLength: 300,
  excerptLength: 500,
  markdownLength: 2_000_000,
  tags: 30,
  tagLength: 60,
  media: 20_000,
} as const

export class SnapshotError extends Error {}

function fail(message: string): never {
  throw new SnapshotError(message)
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${where} 必须是对象`)
  return value as Record<string, unknown>
}

function string(value: unknown, where: string, maxLength: number, required = true): string {
  if (value === undefined || value === null) {
    if (required) fail(`${where} 缺失`)
    return ""
  }
  if (typeof value !== "string") fail(`${where} 必须是字符串`)
  if (value.length > maxLength) fail(`${where} 超过 ${maxLength} 个字符`)
  return value
}

function isoTime(value: unknown, where: string): string {
  const raw = string(value, where, 64)
  const time = Date.parse(raw)
  if (Number.isNaN(time)) fail(`${where} 不是有效时间`)
  return new Date(time).toISOString()
}

function parseArticle(value: unknown, index: number): SnapshotArticle {
  const where = `articles[${index}]`
  const item = record(value, where)
  const slug = string(item.slug, `${where}.slug`, 128)
  if (!SLUG_PATTERN.test(slug)) fail(`${where}.slug 只能包含小写字母、数字和连字符`)
  const title = string(item.title, `${where}.title`, LIMITS.titleLength).trim()
  if (!title) fail(`${where}.title 不能为空`)
  const tagsValue = item.tags ?? []
  if (!Array.isArray(tagsValue) || tagsValue.length > LIMITS.tags) fail(`${where}.tags 必须是不超过 ${LIMITS.tags} 项的数组`)
  const tags = tagsValue.map((tag, tagIndex) => string(tag, `${where}.tags[${tagIndex}]`, LIMITS.tagLength).trim()).filter(Boolean)
  const createdAt = isoTime(item.createdAt, `${where}.createdAt`)
  return {
    slug,
    title,
    markdown: string(item.markdown, `${where}.markdown`, LIMITS.markdownLength),
    excerpt: string(item.excerpt, `${where}.excerpt`, LIMITS.excerptLength, false).trim(),
    tags,
    createdAt,
    updatedAt: item.updatedAt === undefined ? createdAt : isoTime(item.updatedAt, `${where}.updatedAt`),
    pinned: item.pinned === true,
  }
}

function parseMedia(value: unknown, index: number): SnapshotMedia {
  const where = `media[${index}]`
  const item = record(value, where)
  const sha256 = string(item.sha256, `${where}.sha256`, 64)
  if (!SHA256_PATTERN.test(sha256)) fail(`${where}.sha256 格式不正确`)
  const ext = string(item.ext, `${where}.ext`, 8) as MediaExt
  if (!(ext in MEDIA_TYPES)) fail(`${where}.ext 不支持：${ext}`)
  const size = item.size
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) fail(`${where}.size 必须是正整数`)
  return { sha256, ext, size }
}

/** 解析并校验快照；不认识的字段直接忽略，便于协议向后兼容。 */
export function parseSnapshot(raw: string): Snapshot {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    fail("快照不是有效的 JSON")
  }
  const root = record(data, "快照")
  const version = root.snapshotVersion
  if (typeof version !== "number" || !(SUPPORTED_SNAPSHOT_VERSIONS as readonly number[]).includes(version)) {
    fail(`不支持的快照版本：${String(version)}，请升级发布服务`)
  }
  const articlesValue = root.articles ?? []
  const mediaValue = root.media ?? []
  if (!Array.isArray(articlesValue) || articlesValue.length > LIMITS.articles) fail(`articles 必须是不超过 ${LIMITS.articles} 项的数组`)
  if (!Array.isArray(mediaValue) || mediaValue.length > LIMITS.media) fail(`media 必须是不超过 ${LIMITS.media} 项的数组`)

  const articles = articlesValue.map(parseArticle)
  const slugs = new Set<string>()
  for (const article of articles) {
    if (slugs.has(article.slug)) fail(`文章 slug 重复：${article.slug}`)
    slugs.add(article.slug)
  }
  const media = mediaValue.map(parseMedia)
  return {
    snapshotVersion: version,
    generatedAt: root.generatedAt === undefined ? new Date().toISOString() : isoTime(root.generatedAt, "generatedAt"),
    articles,
    media,
  }
}

/** 正文里引用的站内图片：/media/<sha256>.<ext>。 */
export function referencedMedia(markdown: string): string[] {
  const result = new Set<string>()
  for (const match of markdown.matchAll(/\/media\/([0-9a-f]{64})\.(png|jpg|webp|gif|avif)\b/g)) {
    result.add(match[1]!)
  }
  return [...result]
}

/** 校验正文引用的图片都已在快照 media 中声明。 */
export function assertMediaDeclared(snapshot: Snapshot) {
  const declared = new Set(snapshot.media.map((item) => item.sha256))
  for (const article of snapshot.articles) {
    for (const sha256 of referencedMedia(article.markdown)) {
      if (!declared.has(sha256)) fail(`文章 ${article.slug} 引用了未声明的图片 ${sha256}`)
    }
  }
}
