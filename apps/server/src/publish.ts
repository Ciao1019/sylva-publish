// 推送接口 /api/v1：客户端按内容哈希增量上传，再创建并激活版本。
import { createHash } from "node:crypto"

import { HttpError, json, readBody, readJson } from "./http"
import { SHA256_PATTERN, SNAPSHOT_VERSION, SUPPORTED_SNAPSHOT_VERSIONS, SnapshotError, assertMediaDeclared, parseSnapshot, type MediaExt } from "./snapshot"
import type { Store } from "./store"

export const PROTOCOL_VERSION = 1
export const SERVER_VERSION = "0.1.0"

export const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_PLAN_FILES = 25_000

function startsWith(body: Uint8Array, bytes: number[], offset = 0) {
  return bytes.every((byte, index) => body[offset + index] === byte)
}

function ascii(body: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...body.subarray(start, end))
}

/** 按文件头判断图片类型；不接受 SVG，因为它可以携带脚本。 */
export function sniffImage(body: Uint8Array): MediaExt | null {
  if (startsWith(body, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png"
  if (startsWith(body, [0xff, 0xd8, 0xff])) return "jpg"
  if (ascii(body, 0, 6) === "GIF87a" || ascii(body, 0, 6) === "GIF89a") return "gif"
  if (ascii(body, 0, 4) === "RIFF" && ascii(body, 8, 12) === "WEBP") return "webp"
  if (ascii(body, 4, 8) === "ftyp") {
    const boxSize = Math.min(body.length, (body[0]! << 24 | body[1]! << 16 | body[2]! << 8 | body[3]!) >>> 0)
    for (let offset = 8; offset + 4 <= boxSize; offset += 4) {
      const brand = ascii(body, offset, offset + 4)
      if (brand === "avif" || brand === "avis") return "avif"
    }
  }
  return null
}

function isJsonObject(body: Uint8Array) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body)
    const parsed: unknown = JSON.parse(text)
    return Boolean(parsed) && typeof parsed === "object" && !Array.isArray(parsed)
  } catch {
    return false
  }
}

function sha256Hex(body: Uint8Array) {
  return createHash("sha256").update(body).digest("hex")
}

function requireSha256(value: unknown, field: string) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) throw new HttpError(400, `${field} 必须是 64 位小写十六进制 SHA-256`)
  return value
}

function requireId(value: unknown, field: string) {
  const id = typeof value === "string" ? Number(value) : value
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) throw new HttpError(400, `${field} 必须是正整数`)
  return id
}

export function publicInfo() {
  return {
    protocolVersion: PROTOCOL_VERSION,
    serverVersion: SERVER_VERSION,
    snapshotVersions: [...SUPPORTED_SNAPSHOT_VERSIONS],
    latestSnapshotVersion: SNAPSHOT_VERSION,
  }
}

export interface PublishContext {
  store: Store
  keepRevisions: number
  ip: string
  /** 版本激活或撤回后通知应用刷新在线内容 */
  onActiveChanged: () => Promise<void>
}

function siteSummary(store: Store) {
  return {
    siteId: store.getMeta("site_id"),
    currentRevisionId: store.currentRevisionId(),
    revisions: store.listRevisions(),
  }
}

async function plan(ctx: PublishContext, request: Request) {
  const body = await readJson(request)
  const files = body.files
  if (!Array.isArray(files) || files.length > MAX_PLAN_FILES) throw new HttpError(400, `files 必须是不超过 ${MAX_PLAN_FILES} 项的数组`)
  const missing = new Set<string>()
  files.forEach((file, index) => {
    const sha256 = requireSha256((file as Record<string, unknown> | null)?.sha256, `files[${index}].sha256`)
    if (!ctx.store.hasBlob(sha256)) missing.add(sha256)
  })
  return json({ missing: [...missing] })
}

async function putBlob(ctx: PublishContext, request: Request, sha256: string) {
  if (!SHA256_PATTERN.test(sha256)) throw new HttpError(400, "文件哈希格式不正确")
  if (ctx.store.hasBlob(sha256)) {
    // 已存在：仍需读完请求体，再按幂等成功返回
    await readBody(request, MAX_SNAPSHOT_BYTES)
    return json({ sha256, stored: false })
  }
  const body = await readBody(request, MAX_SNAPSHOT_BYTES)
  if (sha256Hex(body) !== sha256) throw new HttpError(400, "文件内容与哈希不一致")
  const image = sniffImage(body)
  if (image) {
    if (body.byteLength > MAX_IMAGE_BYTES) throw new HttpError(413, `图片不能超过 ${MAX_IMAGE_BYTES} 字节`)
  } else if (!isJsonObject(body)) {
    throw new HttpError(415, "只接受快照 JSON 与 PNG、JPEG、WebP、GIF、AVIF 图片")
  }
  await ctx.store.writeBlob(sha256, body)
  return json({ sha256, stored: true }, { status: 201 })
}

/** 校验快照及其引用的文件后创建版本；失败也记录，方便客户端查看原因。 */
async function createRevision(ctx: PublishContext, request: Request) {
  const body = await readJson(request)
  const snapshotSha256 = requireSha256(body.snapshotSha256, "snapshotSha256")
  if (!ctx.store.hasBlob(snapshotSha256)) throw new HttpError(409, "快照文件尚未上传")
  try {
    const snapshot = parseSnapshot(await ctx.store.readBlobText(snapshotSha256))
    assertMediaDeclared(snapshot)
    for (const media of snapshot.media) {
      if (!ctx.store.hasBlob(media.sha256)) throw new SnapshotError(`图片尚未上传：${media.sha256}`)
    }
    const id = ctx.store.createRevision(snapshotSha256, "ready", null, snapshot.articles.length, snapshot.media.map((item) => item.sha256))
    ctx.store.audit(ctx.ip, "revision.create", `id=${id} articles=${snapshot.articles.length}`)
    return json(ctx.store.getRevision(id), { status: 201 })
  } catch (error) {
    if (!(error instanceof SnapshotError)) throw error
    const id = ctx.store.createRevision(snapshotSha256, "failed", error.message, 0, [])
    ctx.store.audit(ctx.ip, "revision.failed", `id=${id} ${error.message}`)
    return json(ctx.store.getRevision(id), { status: 422 })
  }
}

async function activate(ctx: PublishContext, request: Request) {
  const body = await readJson(request)
  const id = requireId(body.revisionId, "revisionId")
  const revision = ctx.store.getRevision(id)
  if (!revision) throw new HttpError(404, "版本不存在")
  if (revision.status !== "ready") throw new HttpError(409, `版本校验未通过：${revision.error ?? "未知错误"}`)
  if (ctx.store.currentRevisionId() !== id) {
    ctx.store.activateRevision(id)
    await ctx.onActiveChanged()
    ctx.store.audit(ctx.ip, "site.activate", `id=${id}`)
  }
  ctx.store.pruneRevisions(ctx.keepRevisions)
  return json(siteSummary(ctx.store))
}

async function unpublish(ctx: PublishContext, request: Request) {
  const body = await readJson(request)
  const purge = body.purge === true
  if (purge) ctx.store.purgeAll()
  else ctx.store.deactivate()
  await ctx.onActiveChanged()
  ctx.store.audit(ctx.ip, purge ? "site.purge" : "site.unpublish")
  return json(siteSummary(ctx.store))
}

/** 已通过鉴权的推送请求。 */
export async function handlePublish(ctx: PublishContext, request: Request, pathname: string) {
  const method = request.method
  if (method === "GET" && pathname === "/api/v1/site") return json(siteSummary(ctx.store))
  if (method === "POST" && pathname === "/api/v1/uploads/plan") return plan(ctx, request)
  const blob = /^\/api\/v1\/blobs\/([^/]+)$/.exec(pathname)
  if (method === "PUT" && blob) return putBlob(ctx, request, blob[1]!)
  if (method === "POST" && pathname === "/api/v1/revisions") return createRevision(ctx, request)
  const revision = /^\/api\/v1\/revisions\/(\d+)$/.exec(pathname)
  if (method === "GET" && revision) {
    const row = ctx.store.getRevision(Number(revision[1]))
    if (!row) throw new HttpError(404, "版本不存在")
    return json(row)
  }
  if (method === "POST" && pathname === "/api/v1/site/activate") return activate(ctx, request)
  if (method === "POST" && pathname === "/api/v1/site/unpublish") return unpublish(ctx, request)
  throw new HttpError(404, "接口不存在")
}
