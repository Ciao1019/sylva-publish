// 运行配置全部来自环境变量；未设置时使用下方默认值。
import path from "node:path"

export type AboutAccentStyle = "red" | "orange" | "green" | "teal" | "blue" | "purple" | "pink" | "yellow"

export interface AboutAccent {
  phrase: string
  style: AboutAccentStyle
  note?: string
}

export interface AboutProfile {
  displayName: string
  roleTitle: string
  intro: string
  expertise: string[]
  toolkit: string[]
  quote: string
  accents: AboutAccent[]
  contactText: string
  contactLabel: string
  contactHref: string
}

export interface SiteFiling {
  enabled: boolean
  icpNumber: string
  icpUrl: string
  publicSecurityNumber: string
  publicSecurityUrl: string
}

export interface SiteConfig {
  title: string
  subtitle: string
  description: string
  githubUrl: string
  allowIndexing: boolean
}

export interface ServerConfig {
  host: string
  port: number
  dataDir: string
  webDist: string
  /** 信任反向代理的 X-Forwarded-For；仅在服务只能经由代理访问时开启 */
  trustProxy: boolean
  site: SiteConfig
  about: AboutProfile
  /** 头像：http(s) 地址重定向过去，本地路径直接读取；为空时使用内置头像 */
  aboutAvatar: string
  filing: SiteFiling
  /** 保留的历史版本数（含当前版本） */
  keepRevisions: number
}

// 默认资料取自 https://wl.do/about，部署时通过 ABOUT_* 环境变量覆盖。
export const DEFAULT_ABOUT: AboutProfile = {
  displayName: "CiZai",
  roleTitle: "Creative Dev & Visual Artist",
  intro: "我是 CiZai，是一个普普通通的程序员。\n\n目前就职于金山办公\n\n我的兴趣主要在 Coding / AI 方向。\n\n我喜欢 Minecraft。",
  expertise: ["Frontend Architecture", "AI 应用开发", "Knowledge Systems", "Creative Coding"],
  toolkit: ["Golang", "TypeScript", "React", "Next.js", "AI", "PostgreSQL", "Minecraft"],
  quote: "Code is just another medium for painting dreams.",
  accents: [
    { phrase: "CiZai", style: "red", note: "yep, that's me" },
    { phrase: "程序员", style: "green", note: "just a dev" },
    { phrase: "金山办公", style: "blue", note: "where I work" },
    { phrase: "Coding / AI", style: "green", note: "my playground" },
    { phrase: "Minecraft", style: "blue", note: "★ my comfort game" },
  ],
  contactText: "想聊点什么？随时",
  contactLabel: "message me",
  contactHref: "mailto:zang@linux.do",
}

const ACCENT_STYLES = new Set<AboutAccentStyle>(["red", "orange", "green", "teal", "blue", "purple", "pink", "yellow"])

type Env = Record<string, string | undefined>

function text(env: Env, name: string, fallback: string) {
  const value = env[name]
  return value === undefined ? fallback : value.trim()
}

/** 环境变量里的换行可以写成真实换行，也可以写成字面量 \n。 */
function multiline(env: Env, name: string, fallback: string) {
  const value = env[name]
  return value === undefined ? fallback : value.replace(/\\n/g, "\n").trim()
}

/** 列表用英文逗号或换行分隔。 */
function list(env: Env, name: string, fallback: string[]) {
  const value = env[name]
  if (value === undefined) return fallback
  return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)
}

function bool(env: Env, name: string, fallback: boolean) {
  const value = env[name]?.trim().toLowerCase()
  if (!value) return fallback
  return value === "1" || value === "true" || value === "yes"
}

function int(env: Env, name: string, fallback: number, min: number, max: number) {
  const value = Number.parseInt(env[name] ?? "", 10)
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function accents(env: Env): AboutAccent[] {
  const raw = env.ABOUT_ACCENTS
  if (raw === undefined) return DEFAULT_ABOUT.accents
  if (!raw.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("ABOUT_ACCENTS 必须是 JSON 数组，例如 [{\"phrase\":\"CiZai\",\"style\":\"red\",\"note\":\"me\"}]")
  }
  if (!Array.isArray(parsed)) throw new Error("ABOUT_ACCENTS 必须是 JSON 数组")
  return parsed.map((item, index) => {
    const entry = item as Record<string, unknown>
    const phrase = typeof entry.phrase === "string" ? entry.phrase.trim() : ""
    const style = entry.style as AboutAccentStyle
    if (!phrase || !ACCENT_STYLES.has(style)) {
      throw new Error(`ABOUT_ACCENTS 第 ${index + 1} 项需要 phrase 与合法的 style`)
    }
    const note = typeof entry.note === "string" && entry.note.trim() ? entry.note.trim() : undefined
    return note ? { phrase, style, note } : { phrase, style }
  })
}

function safeHttpUrl(value: string) {
  if (!value) return ""
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : ""
  } catch {
    return ""
  }
}

export function loadConfig(env: Env = process.env): ServerConfig {
  const icpNumber = text(env, "FILING_ICP_NUMBER", "")
  const publicSecurityNumber = text(env, "FILING_PUBLIC_SECURITY_NUMBER", "")
  return {
    host: text(env, "HOST", "0.0.0.0"),
    port: int(env, "PORT", 8080, 1, 65535),
    dataDir: path.resolve(text(env, "DATA_DIR", "./data")),
    webDist: path.resolve(text(env, "WEB_DIST", path.join(import.meta.dir, "../../web/dist"))),
    trustProxy: bool(env, "TRUST_PROXY", false),
    site: {
      title: text(env, "SITE_TITLE", "Sylva"),
      subtitle: text(env, "SITE_SUBTITLE", "Knowledge, Articles & Inspiration"),
      description: text(env, "SITE_DESCRIPTION", "由 Sylva 发布的文章。"),
      githubUrl: safeHttpUrl(text(env, "SITE_GITHUB_URL", "")),
      allowIndexing: bool(env, "SITE_ALLOW_INDEXING", false),
    },
    about: {
      displayName: text(env, "ABOUT_DISPLAY_NAME", DEFAULT_ABOUT.displayName),
      roleTitle: text(env, "ABOUT_ROLE_TITLE", DEFAULT_ABOUT.roleTitle),
      intro: multiline(env, "ABOUT_INTRO", DEFAULT_ABOUT.intro),
      expertise: list(env, "ABOUT_EXPERTISE", DEFAULT_ABOUT.expertise),
      toolkit: list(env, "ABOUT_TOOLKIT", DEFAULT_ABOUT.toolkit),
      quote: text(env, "ABOUT_QUOTE", DEFAULT_ABOUT.quote),
      accents: accents(env),
      contactText: text(env, "ABOUT_CONTACT_TEXT", DEFAULT_ABOUT.contactText),
      contactLabel: text(env, "ABOUT_CONTACT_LABEL", DEFAULT_ABOUT.contactLabel),
      contactHref: text(env, "ABOUT_CONTACT_HREF", DEFAULT_ABOUT.contactHref),
    },
    aboutAvatar: text(env, "ABOUT_AVATAR_URL", ""),
    filing: {
      enabled: Boolean(icpNumber || publicSecurityNumber),
      icpNumber,
      icpUrl: safeHttpUrl(text(env, "FILING_ICP_URL", icpNumber ? "https://beian.miit.gov.cn/" : "")),
      publicSecurityNumber,
      publicSecurityUrl: safeHttpUrl(text(env, "FILING_PUBLIC_SECURITY_URL", "")),
    },
    keepRevisions: int(env, "KEEP_REVISIONS", 10, 1, 100),
  }
}
