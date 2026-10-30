// 持久化：SQLite 保存站点元数据、版本与审计日志，文件按内容哈希存放在 blobs/。
import { Database } from "bun:sqlite"
import { mkdirSync, existsSync, readdirSync, renameSync, rmSync, statSync } from "node:fs"
import path from "node:path"

export type RevisionStatus = "ready" | "failed"

export interface RevisionRow {
  id: number
  snapshotSha256: string
  status: RevisionStatus
  error: string | null
  articleCount: number
  createdAt: string
  activatedAt: string | null
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS revision (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_sha256 TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  article_count INTEGER NOT NULL DEFAULT 0,
  media_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  activated_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  ip TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
`

type RevisionRecord = {
  id: number
  snapshot_sha256: string
  status: RevisionStatus
  error: string | null
  article_count: number
  created_at: string
  activated_at: string | null
}

function toRevision(row: RevisionRecord): RevisionRow {
  return {
    id: row.id,
    snapshotSha256: row.snapshot_sha256,
    status: row.status,
    error: row.error,
    articleCount: row.article_count,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
  }
}

export class Store {
  readonly db: Database
  readonly blobDir: string
  private readonly tmpDir: string

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true })
    this.blobDir = path.join(dataDir, "blobs")
    this.tmpDir = path.join(dataDir, "tmp")
    mkdirSync(this.blobDir, { recursive: true })
    rmSync(this.tmpDir, { recursive: true, force: true })
    mkdirSync(this.tmpDir, { recursive: true })
    this.db = new Database(path.join(dataDir, "publish.db"), { create: true, strict: true })
    this.db.exec("PRAGMA journal_mode = WAL;")
    this.db.exec(SCHEMA)
  }

  close() {
    this.db.close()
  }

  getMeta(key: string): string | null {
    const row = this.db.query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?").get(key)
    return row?.value ?? null
  }

  setMeta(key: string, value: string | null) {
    if (value === null) this.db.query("DELETE FROM meta WHERE key = ?").run(key)
    else this.db.query("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value)
  }

  audit(ip: string, action: string, detail = "") {
    this.db.query("INSERT INTO audit_log (created_at, ip, action, detail) VALUES (?, ?, ?, ?)")
      .run(new Date().toISOString(), ip, action, detail.slice(0, 500))
  }

  // ===== 文件 =====

  blobPath(sha256: string) {
    return path.join(this.blobDir, sha256.slice(0, 2), sha256)
  }

  hasBlob(sha256: string) {
    return existsSync(this.blobPath(sha256))
  }

  /** 先写临时文件再原子改名，避免中断留下半个文件。 */
  async writeBlob(sha256: string, body: Uint8Array) {
    const target = this.blobPath(sha256)
    if (existsSync(target)) return
    mkdirSync(path.dirname(target), { recursive: true })
    const temporary = path.join(this.tmpDir, `${sha256}.${process.pid}.${Date.now()}`)
    await Bun.write(temporary, body)
    renameSync(temporary, target)
  }

  readBlobText(sha256: string) {
    return Bun.file(this.blobPath(sha256)).text()
  }

  // ===== 版本 =====

  createRevision(snapshotSha256: string, status: RevisionStatus, error: string | null, articleCount: number, mediaSha256: string[]) {
    const row = this.db.query<{ id: number }, [string, string, string | null, number, string, string]>(
      "INSERT INTO revision (snapshot_sha256, status, error, article_count, media_json, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    ).get(snapshotSha256, status, error, articleCount, JSON.stringify(mediaSha256), new Date().toISOString())
    return row!.id
  }

  getRevision(id: number): RevisionRow | null {
    const row = this.db.query<RevisionRecord, [number]>("SELECT * FROM revision WHERE id = ?").get(id)
    return row ? toRevision(row) : null
  }

  listRevisions(): RevisionRow[] {
    return this.db.query<RevisionRecord, []>("SELECT * FROM revision ORDER BY id DESC").all().map(toRevision)
  }

  currentRevisionId(): number | null {
    const value = this.getMeta("current_revision")
    return value ? Number(value) : null
  }

  activateRevision(id: number) {
    this.db.transaction(() => {
      this.db.query("UPDATE revision SET activated_at = ? WHERE id = ?").run(new Date().toISOString(), id)
      this.setMeta("current_revision", String(id))
    })()
  }

  deactivate() {
    this.setMeta("current_revision", null)
  }

  /**
   * 只保留最近 keep 个成功版本（当前版本始终保留），删除其余版本，
   * 再清理不再被任何版本引用的文件。返回删除的文件数。
   */
  pruneRevisions(keep: number) {
    const current = this.currentRevisionId()
    const ready = this.db.query<{ id: number }, []>("SELECT id FROM revision WHERE status = 'ready' ORDER BY id DESC").all()
    const kept = new Set(ready.slice(0, keep).map((row) => row.id))
    if (current !== null) kept.add(current)
    const all = this.db.query<{ id: number }, []>("SELECT id FROM revision").all()
    const removeIds = all.map((row) => row.id).filter((id) => !kept.has(id))
    const remove = this.db.prepare("DELETE FROM revision WHERE id = ?")
    this.db.transaction(() => {
      for (const id of removeIds) remove.run(id)
    })()
    return this.collectGarbage()
  }

  /** 删除全部版本与文件（撤回并清除）。 */
  purgeAll() {
    this.db.transaction(() => {
      this.db.query("DELETE FROM revision").run()
      this.setMeta("current_revision", null)
    })()
    return this.collectGarbage(0)
  }

  private referencedBlobs() {
    const referenced = new Set<string>()
    const rows = this.db.query<{ snapshot_sha256: string; media_json: string }, []>("SELECT snapshot_sha256, media_json FROM revision").all()
    for (const row of rows) {
      referenced.add(row.snapshot_sha256)
      for (const sha256 of JSON.parse(row.media_json) as string[]) referenced.add(sha256)
    }
    return referenced
  }

  /**
   * 清理未被引用的文件。刚上传、尚未创建版本的文件在一小时内保留，
   * 避免和正在进行的推送互相干扰。
   */
  collectGarbage(graceMs = 60 * 60 * 1000) {
    const referenced = this.referencedBlobs()
    const now = Date.now()
    let removed = 0
    for (const prefix of readdirSync(this.blobDir)) {
      const directory = path.join(this.blobDir, prefix)
      for (const name of readdirSync(directory)) {
        if (referenced.has(name)) continue
        const file = path.join(directory, name)
        if (now - statSync(file).mtimeMs < graceMs) continue
        rmSync(file, { force: true })
        removed += 1
      }
    }
    return removed
  }
}
