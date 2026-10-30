// 发布密钥：服务端只保存 SHA-256，明文仅在生成时输出一次。
import { randomBytes, createHash, timingSafeEqual } from "node:crypto"

import type { Store } from "./store"

const KEY_PREFIX = "sp_"
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

function base62(bytes: Uint8Array) {
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex")}`)
  let result = ""
  while (value > 0n) {
    result = BASE62[Number(value % 62n)] + result
    value /= 62n
  }
  return result.padStart(43, "0")
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export function generateKey() {
  return `${KEY_PREFIX}${base62(randomBytes(32))}`
}

/** 首次启动生成站点 ID 与密钥；已存在时返回 null。 */
export function ensureSiteIdentity(store: Store): { siteId: string; key: string | null } {
  let siteId = store.getMeta("site_id")
  if (!siteId) {
    siteId = `site_${base62(randomBytes(16)).slice(-22)}`
    store.setMeta("site_id", siteId)
  }
  if (store.getMeta("key_sha256")) return { siteId, key: null }
  const key = generateKey()
  store.setMeta("key_sha256", sha256Hex(key))
  return { siteId, key }
}

/** 轮换密钥，旧密钥立即失效。 */
export function rotateKey(store: Store) {
  const key = generateKey()
  store.setMeta("key_sha256", sha256Hex(key))
  return key
}

export function verifyKey(store: Store, presented: string) {
  const expected = store.getMeta("key_sha256")
  if (!expected || !presented.startsWith(KEY_PREFIX)) return false
  const actual = Buffer.from(sha256Hex(presented), "hex")
  return timingSafeEqual(actual, Buffer.from(expected, "hex"))
}

export function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? ""
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  return match?.[1] ?? ""
}

/**
 * 鉴权失败限流：同一 IP 在窗口内失败达到上限后暂时封禁。
 * 只统计失败，正常推送不受影响。
 */
export class FailureLimiter {
  private readonly failures = new Map<string, { count: number; windowStart: number; blockedUntil: number }>()

  constructor(
    private readonly maxFailures = 10,
    private readonly windowMs = 10 * 60 * 1000,
    private readonly blockMs = 15 * 60 * 1000,
  ) {}

  isBlocked(ip: string, now = Date.now()) {
    const entry = this.failures.get(ip)
    return Boolean(entry && entry.blockedUntil > now)
  }

  recordFailure(ip: string, now = Date.now()) {
    const entry = this.failures.get(ip)
    if (!entry || now - entry.windowStart > this.windowMs) {
      this.failures.set(ip, { count: 1, windowStart: now, blockedUntil: 0 })
      return
    }
    entry.count += 1
    if (entry.count >= this.maxFailures) entry.blockedUntil = now + this.blockMs
  }

  recordSuccess(ip: string) {
    this.failures.delete(ip)
  }
}
