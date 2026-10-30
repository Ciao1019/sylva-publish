// 请求分发：只读公开接口、推送接口、图片与前端静态页面。
import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

import { FailureLimiter, bearerToken, ensureSiteIdentity, verifyKey } from "./auth"
import type { ServerConfig } from "./config"
import { HttpError, errorResponse, json, withSecurityHeaders } from "./http"
import { handlePublish, publicInfo } from "./publish"
import { PublishedSite } from "./site"
import { parseSnapshot, SHA256_PATTERN } from "./snapshot"
import { Store } from "./store"

const SEARCH_LIMIT_MAX = 50
const DEFAULT_AVATAR = "about-avatar.avif"

function escapeJsonForHtml(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
}

function inlineScriptHashes(html: string) {
  const hashes: string[] = []
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)) {
    hashes.push(`'sha256-${createHash("sha256").update(match[1]!).digest("base64")}'`)
  }
  return hashes
}

/** 按需加载的 index.html：注入站点配置，并按配置决定是否允许收录。 */
function buildIndexHtml(config: ServerConfig) {
  const file = path.join(config.webDist, "index.html")
  if (!existsSync(file)) return null
  let html = readFileSync(file, "utf8")
  const site = config.site
  const head = [
    `<script id="sylva-site-config" type="application/json">${escapeJsonForHtml({
      title: site.title,
      subtitle: site.subtitle,
      description: site.description,
      githubUrl: site.githubUrl,
    })}</script>`,
    site.allowIndexing ? "" : `<meta name="robots" content="noindex, nofollow" />`,
  ].filter(Boolean).join("\n    ")
  html = html
    .replace("<!-- SYLVA_SITE_CONFIG -->", head)
    .replace(/<title>[^<]*<\/title>/, `<title>${Bun.escapeHTML(site.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${Bun.escapeHTML(site.description)}" />`)
  const csp = [
    "default-src 'self'",
    `script-src 'self' ${inlineScriptHashes(html).join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ")
  return { html, csp }
}

function contentTypeFor(file: string) {
  return Bun.file(file).type || "application/octet-stream"
}

export interface App {
  fetch: (request: Request, ip: string) => Promise<Response>
  store: Store
  siteId: string
  /** 首次启动生成的密钥；之后为 null */
  initialKey: string | null
  close: () => void
}

export async function createApp(config: ServerConfig): Promise<App> {
  const store = new Store(config.dataDir)
  const { siteId, key: initialKey } = ensureSiteIdentity(store)
  const limiter = new FailureLimiter()
  const index = buildIndexHtml(config)
  let site: PublishedSite | null = null

  async function reloadActive() {
    const id = store.currentRevisionId()
    const revision = id === null ? null : store.getRevision(id)
    site = revision ? new PublishedSite(revision.id, parseSnapshot(await store.readBlobText(revision.snapshotSha256))) : null
  }
  await reloadActive()

  function publicApi(request: Request, url: URL): Response | null {
    const { pathname, searchParams } = url
    if (request.method !== "GET") return null
    if (pathname === "/api/public/article/list") {
      return json({ items: site?.items ?? [] })
    }
    if (pathname === "/api/public/article/share/detail") {
      const detail = site?.detail(searchParams.get("shareCode")?.trim() ?? "")
      if (!detail) throw new HttpError(404, "文章不存在或已下线")
      return json(detail)
    }
    if (pathname === "/api/public/article/search") {
      const keyword = (searchParams.get("q") ?? "").slice(0, 100)
      const limit = Math.min(SEARCH_LIMIT_MAX, Math.max(1, Number(searchParams.get("limit")) || 20))
      const offset = Math.max(0, Number(searchParams.get("offset")) || 0)
      const result = site?.search(keyword, limit, offset) ?? { items: [], hasMore: false }
      return json({ keyword, limit, offset, ...result })
    }
    if (pathname === "/api/public/about/profile") return json(config.about)
    if (pathname === "/api/public/filing") return json(config.filing)
    if (pathname === "/api/v1/info") return json(publicInfo())
    return null
  }

  async function publishApi(request: Request, pathname: string, ip: string) {
    if (limiter.isBlocked(ip)) throw new HttpError(429, "鉴权失败次数过多，请稍后再试")
    if (!verifyKey(store, bearerToken(request))) {
      limiter.recordFailure(ip)
      store.audit(ip, "auth.failed", `${request.method} ${pathname}`)
      throw new HttpError(401, "发布密钥无效")
    }
    limiter.recordSuccess(ip)
    return handlePublish({ store, keepRevisions: config.keepRevisions, ip, onActiveChanged: reloadActive }, request, pathname)
  }

  function media(pathname: string) {
    const match = /^\/media\/([0-9a-f]{64})\.([a-z]+)$/.exec(pathname)
    if (!match || !SHA256_PATTERN.test(match[1]!)) return null
    const type = site?.mediaType(match[1]!, match[2]!)
    if (!type) return null
    return new Response(Bun.file(store.blobPath(match[1]!)), {
      headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" },
    })
  }

  function avatar() {
    const configured = config.aboutAvatar
    if (/^https?:\/\//i.test(configured)) {
      return new Response(null, { status: 302, headers: { Location: configured, "Cache-Control": "public, max-age=3600" } })
    }
    const file = configured ? path.resolve(configured) : path.join(config.webDist, DEFAULT_AVATAR)
    if (!existsSync(file)) return null
    return new Response(Bun.file(file), {
      headers: { "Content-Type": contentTypeFor(file), "Cache-Control": "public, max-age=3600" },
    })
  }

  function robots() {
    const body = config.site.allowIndexing ? "User-agent: *\nAllow: /\n" : "User-agent: *\nDisallow: /\n"
    return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } })
  }

  function staticFile(pathname: string) {
    let decoded: string
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      return null
    }
    const root = config.webDist
    const file = path.resolve(root, `.${decoded}`)
    if (!file.startsWith(root + path.sep) || !existsSync(file) || !statSync(file).isFile()) return null
    if (path.basename(file) === "index.html") return null
    const immutable = decoded.startsWith("/assets/")
    return new Response(Bun.file(file), {
      headers: {
        "Content-Type": contentTypeFor(file),
        "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=3600",
      },
    })
  }

  function spa() {
    if (!index) return new Response("前端尚未构建：请先执行 bun run build", { status: 503 })
    return new Response(index.html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
        "Content-Security-Policy": index.csp,
      },
    })
  }

  async function route(request: Request, ip: string) {
    const url = new URL(request.url)
    const { pathname } = url
    try {
      if (pathname.startsWith("/api/")) {
        const response = publicApi(request, url)
        if (response) return response
        if (pathname.startsWith("/api/v1/")) return await publishApi(request, pathname, ip)
        throw new HttpError(404, "接口不存在")
      }
      if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(405, "不支持的请求方法")
      if (pathname === "/robots.txt") return robots()
      if (pathname === "/about-avatar.avif") return avatar() ?? errorResponse(404, "头像不存在", pathname)
      if (pathname.startsWith("/media/")) return media(pathname) ?? errorResponse(404, "图片不存在", pathname)
      return staticFile(pathname) ?? spa()
    } catch (error) {
      if (error instanceof HttpError) return errorResponse(error.status, error.message, pathname)
      console.error("[sylva-publish] 请求处理失败", request.method, pathname, error)
      return errorResponse(500, "服务器内部错误", pathname)
    }
  }

  return {
    fetch: async (request, ip) => withSecurityHeaders(await route(request, ip)),
    store,
    siteId,
    initialKey,
    close: () => store.close(),
  }
}
