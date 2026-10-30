import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { createApp, type App } from "./app"
import { DEFAULT_ABOUT, loadConfig } from "./config"

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3])

function sha256(body: Uint8Array | string) {
  return createHash("sha256").update(body).digest("hex")
}

let root: string
let app: App
let key: string

async function start(env: Record<string, string> = {}) {
  const config = loadConfig({ DATA_DIR: path.join(root, "data"), WEB_DIST: path.join(root, "dist"), ...env })
  app = await createApp(config)
  return app
}

function call(pathname: string, init: RequestInit & { auth?: string | null; ip?: string } = {}) {
  const headers = new Headers(init.headers)
  const auth = init.auth === undefined ? key : init.auth
  if (auth) headers.set("Authorization", `Bearer ${auth}`)
  return app.fetch(new Request(`http://localhost${pathname}`, { ...init, headers }), init.ip ?? "127.0.0.1")
}

async function upload(body: Uint8Array | string) {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body
  const hash = sha256(bytes)
  const response = await call(`/api/v1/blobs/${hash}`, { method: "PUT", body: bytes })
  return { hash, response }
}

async function publish(snapshot: unknown) {
  const { hash } = await upload(JSON.stringify(snapshot))
  const created = await call("/api/v1/revisions", { method: "POST", body: JSON.stringify({ snapshotSha256: hash }) })
  const revision = await created.json() as { id: number; status: string; error: string | null }
  if (created.status !== 201) return { created, revision }
  const activated = await call("/api/v1/site/activate", { method: "POST", body: JSON.stringify({ revisionId: revision.id }) })
  return { created, revision, activated }
}

const article = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  title: `标题 ${slug}`,
  markdown: `# ${slug}\n\n这是一段正文内容。`,
  tags: ["笔记"],
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-02T00:00:00Z",
  ...extra,
})

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), "sylva-publish-"))
  mkdirSync(path.join(root, "dist", "assets"), { recursive: true })
  writeFileSync(path.join(root, "dist", "index.html"), `<!doctype html><html><head><meta name="description" content="x" /><title>x</title><script>document.documentElement.classList.add("dark")</script>\n<!-- SYLVA_SITE_CONFIG --></head><body><div id="root"></div></body></html>`)
  writeFileSync(path.join(root, "dist", "assets", "app.js"), "console.log(1)")
  writeFileSync(path.join(root, "dist", "about-avatar.avif"), "avatar")
  await start()
  key = app.initialKey!
})

afterEach(() => {
  app.close()
  rmSync(root, { recursive: true, force: true })
})

describe("发布密钥", () => {
  it("首次启动生成密钥，重启后不再输出", async () => {
    expect(key).toMatch(/^sp_[0-9A-Za-z]{43}$/)
    const siteId = app.siteId
    app.close()
    await start()
    expect(app.initialKey).toBeNull()
    expect(app.siteId).toBe(siteId)
  })

  it("缺少或错误的密钥被拒绝，连续失败后封禁该 IP", async () => {
    expect((await call("/api/v1/site", { auth: null })).status).toBe(401)
    for (let index = 0; index < 10; index += 1) await call("/api/v1/site", { auth: "sp_wrong", ip: "10.0.0.1" })
    expect((await call("/api/v1/site", { ip: "10.0.0.1" })).status).toBe(429)
    expect((await call("/api/v1/site", { ip: "10.0.0.2" })).status).toBe(200)
  })

  it("公开信息无需密钥", async () => {
    const response = await call("/api/v1/info", { auth: null })
    expect(await response.json()).toMatchObject({ protocolVersion: 1, snapshotVersions: [1] })
  })
})

describe("推送与在线内容", () => {
  it("增量计划只返回缺少的文件", async () => {
    const { hash } = await upload(PNG)
    const missing = sha256("missing")
    const response = await call("/api/v1/uploads/plan", {
      method: "POST",
      body: JSON.stringify({ files: [{ sha256: hash, size: PNG.length }, { sha256: missing, size: 7 }] }),
    })
    expect(await response.json()).toEqual({ missing: [missing] })
  })

  it("拒绝哈希不一致、SVG 与非 JSON 文件", async () => {
    const svg = new TextEncoder().encode("<svg onload=alert(1)></svg>")
    expect((await upload(svg)).response.status).toBe(415)
    const wrong = await call(`/api/v1/blobs/${sha256("other")}`, { method: "PUT", body: PNG })
    expect(wrong.status).toBe(400)
  })

  it("发布后文章列表、详情、搜索与图片可读，未声明的图片不可访问", async () => {
    const image = await upload(PNG)
    const stray = await upload(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]))
    const { activated } = await publish({
      snapshotVersion: 1,
      articles: [
        article("first", { markdown: `正文 ![图](/media/${image.hash}.png)`, pinned: true }),
        article("second", { title: "Bun 发布服务" }),
      ],
      media: [{ sha256: image.hash, ext: "png", size: PNG.length }],
    })
    expect(activated?.status).toBe(200)

    const list = await (await call("/api/public/article/list", { auth: null })).json() as { items: Array<Record<string, unknown>> }
    expect(list.items.map((item) => item.shareCode)).toEqual(["first", "second"])
    expect(list.items[0]).toMatchObject({ href: "/p/first", isPinned: true, hasPassword: false, readingMinutes: 1 })

    const detail = await (await call("/api/public/article/share/detail?shareCode=second", { auth: null })).json()
    expect(detail).toMatchObject({ title: "Bun 发布服务", tags: ["笔记"], isRepost: false })
    expect((await call("/api/public/article/share/detail?shareCode=nope", { auth: null })).status).toBe(404)

    const search = await (await call("/api/public/article/search?q=bun", { auth: null })).json() as { items: Array<{ shareCode: string }> }
    expect(search.items.map((item) => item.shareCode)).toEqual(["second"])

    const media = await call(`/media/${image.hash}.png`, { auth: null })
    expect(media.headers.get("content-type")).toBe("image/png")
    expect((await call(`/media/${stray.hash}.jpg`, { auth: null })).status).toBe(404)
  })

  it("快照引用未上传或未声明的图片时版本失败，线上内容不变", async () => {
    await publish({ snapshotVersion: 1, articles: [article("live")] })
    const missing = sha256("not uploaded")
    const { created, revision } = await publish({
      snapshotVersion: 1,
      articles: [article("next", { markdown: `![x](/media/${missing}.png)` })],
      media: [],
    })
    expect(created.status).toBe(422)
    expect(revision.error).toContain("未声明")
    const list = await (await call("/api/public/article/list", { auth: null })).json() as { items: Array<{ shareCode: string }> }
    expect(list.items.map((item) => item.shareCode)).toEqual(["live"])
  })

  it("可以回滚到旧版本，撤回后列表为空，清除后版本也被删除", async () => {
    const first = await publish({ snapshotVersion: 1, articles: [article("v1")] })
    await publish({ snapshotVersion: 1, articles: [article("v2")] })
    await call("/api/v1/site/activate", { method: "POST", body: JSON.stringify({ revisionId: first.revision.id }) })
    let list = await (await call("/api/public/article/list", { auth: null })).json() as { items: Array<{ shareCode: string }> }
    expect(list.items.map((item) => item.shareCode)).toEqual(["v1"])

    await call("/api/v1/site/unpublish", { method: "POST", body: "{}" })
    list = await (await call("/api/public/article/list", { auth: null })).json() as { items: Array<{ shareCode: string }> }
    expect(list.items).toEqual([])

    const purged = await (await call("/api/v1/site/unpublish", { method: "POST", body: JSON.stringify({ purge: true }) })).json() as { revisions: unknown[] }
    expect(purged.revisions).toEqual([])
  })

  it("重启后仍提供当前版本", async () => {
    await publish({ snapshotVersion: 1, articles: [article("persisted")] })
    app.close()
    await start()
    const list = await (await call("/api/public/article/list", { auth: null })).json() as { items: Array<{ shareCode: string }> }
    expect(list.items.map((item) => item.shareCode)).toEqual(["persisted"])
  })
})

describe("站点页面与配置", () => {
  it("默认关于我资料来自 wl.do，可由环境变量覆盖", async () => {
    expect(await (await call("/api/public/about/profile", { auth: null })).json()).toEqual(DEFAULT_ABOUT)
    app.close()
    await start({ ABOUT_DISPLAY_NAME: "Alice", ABOUT_TOOLKIT: "Go, Rust", ABOUT_ACCENTS: "", ABOUT_INTRO: "第一段\\n\\n第二段" })
    expect(await (await call("/api/public/about/profile", { auth: null })).json()).toMatchObject({
      displayName: "Alice",
      toolkit: ["Go", "Rust"],
      accents: [],
      intro: "第一段\n\n第二段",
    })
  })

  it("页面注入站点配置与 CSP，默认禁止收录", async () => {
    app.close()
    await start({ SITE_TITLE: "我的</script>站点", SITE_GITHUB_URL: "javascript:alert(1)" })
    const response = await call("/p/anything", { auth: null })
    const html = await response.text()
    expect(html).toContain('<script id="sylva-site-config" type="application/json">')
    expect(html).not.toContain("我的</script>")
    expect(html).toContain('"githubUrl":""')
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />')
    expect(response.headers.get("content-security-policy")).toContain("'sha256-")
    expect(await (await call("/robots.txt", { auth: null })).text()).toContain("Disallow: /")
  })

  it("静态资源不能越过构建目录", async () => {
    expect((await call("/assets/app.js", { auth: null })).headers.get("cache-control")).toContain("immutable")
    const traversal = await call("/%2e%2e/%2e%2e/etc/passwd", { auth: null })
    expect(await traversal.text()).toContain("sylva-site-config")
  })

  it("头像默认使用内置文件，配置网址时重定向", async () => {
    expect(await (await call("/about-avatar.avif", { auth: null })).text()).toBe("avatar")
    app.close()
    await start({ ABOUT_AVATAR_URL: "https://example.com/me.png" })
    const response = await call("/about-avatar.avif", { auth: null })
    expect(response.status).toBe(302)
    expect(response.headers.get("location")).toBe("https://example.com/me.png")
  })
})

describe("摘要", () => {
  it("去掉表格分隔行与公式，超长时以 ... 结尾", async () => {
    const { markdownToPlainText } = await import("./site")
    expect(markdownToPlainText("| a | b |\n| --- | :---: |\n| 1 | 2 |\n\n$$E=mc^2$$\n\n**粗体**")).toBe("a b 1 2 粗体")
  })
})
