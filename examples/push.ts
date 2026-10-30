// 参考客户端：把一个快照目录推送到发布服务。
// 用法：SYLVA_PUBLISH_URL=http://127.0.0.1:8080 SYLVA_PUBLISH_KEY=sp_xxx bun examples/push.ts examples/snapshot
// 目录结构：snapshot.json，以及 snapshot.json 中 media 声明的 media/<sha256>.<ext> 文件。
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"

const baseUrl = (process.env.SYLVA_PUBLISH_URL ?? "").replace(/\/+$/, "")
const key = process.env.SYLVA_PUBLISH_KEY ?? ""
const directory = process.argv[2]
if (!baseUrl || !key || !directory) {
  console.error("需要 SYLVA_PUBLISH_URL、SYLVA_PUBLISH_KEY 环境变量和快照目录参数")
  process.exit(1)
}
const url = new URL(baseUrl)
if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
  console.error("发布密钥只能通过 HTTPS 发送（本机地址除外）")
  process.exit(1)
}

async function request(pathname: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    redirect: "manual",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...init.headers },
  })
  const body = await response.json().catch(() => null) as Record<string, unknown> | null
  if (!response.ok) throw new Error(`${pathname} 失败（${response.status}）：${String(body?.msg ?? body?.error ?? "")}`)
  return body!
}

const snapshotBytes = readFileSync(path.join(directory, "snapshot.json"))
const snapshot = JSON.parse(snapshotBytes.toString("utf8")) as { media?: Array<{ sha256: string; ext: string }> }
const files = new Map<string, Uint8Array>()
files.set(createHash("sha256").update(snapshotBytes).digest("hex"), snapshotBytes)
for (const media of snapshot.media ?? []) {
  files.set(media.sha256, readFileSync(path.join(directory, "media", `${media.sha256}.${media.ext}`)))
}

const info = await (await fetch(`${baseUrl}/api/v1/info`)).json() as { protocolVersion: number }
if (info.protocolVersion !== 1) throw new Error(`发布服务协议版本 ${info.protocolVersion} 不受支持`)

const plan = await request("/api/v1/uploads/plan", {
  method: "POST",
  body: JSON.stringify({ files: [...files].map(([sha256, body]) => ({ sha256, size: body.byteLength })) }),
}) as { missing: string[] }
for (const sha256 of plan.missing) {
  await request(`/api/v1/blobs/${sha256}`, { method: "PUT", body: files.get(sha256)!, headers: { "Content-Type": "application/octet-stream" } })
}
const snapshotSha256 = [...files.keys()][0]!
const revision = await request("/api/v1/revisions", { method: "POST", body: JSON.stringify({ snapshotSha256 }) }) as { id: number }
await request("/api/v1/site/activate", { method: "POST", body: JSON.stringify({ revisionId: revision.id }) })
console.log(`已上传 ${plan.missing.length} 个文件，版本 ${revision.id} 已上线`)
