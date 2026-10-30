# 推送协议 v1

发布服务对外提供两类接口：

- **只读接口** `/api/public/*`：前台页面使用，无需鉴权。
- **推送接口** `/api/v1/*`：客户端使用，除 `GET /api/v1/info` 外都需要发布密钥。

错误响应统一为：

```json
{ "code": 401, "msg": "发布密钥无效", "path": "/api/v1/site", "timestamp": "2026-10-30T08:00:00.000Z" }
```

## 鉴权

```http
Authorization: Bearer sp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- 密钥在服务首次启动时生成，只在日志中输出一次；服务端只保存其 SHA-256。
- `sylva-publish key rotate` 生成新密钥，旧密钥立即失效。
- 同一 IP 在 10 分钟内鉴权失败 10 次后，封禁 15 分钟（返回 429）。
- 客户端只应通过 HTTPS 发送密钥，本机地址（`localhost`、`127.0.0.1`）除外；不应跟随重定向。

## 发布流程

```text
GET  /api/v1/info                 检查协议版本
GET  /api/v1/site                 验证密钥，读取站点 ID 与当前版本
POST /api/v1/uploads/plan         提交文件清单，得到缺少的文件
PUT  /api/v1/blobs/{sha256}       逐个上传缺少的文件（图片与快照）
POST /api/v1/revisions            用快照哈希创建版本（同步校验）
POST /api/v1/site/activate        切换到该版本
```

所有步骤都可以安全重试：重复上传同一个文件直接成功，激活已生效的版本不会出错。
校验失败的版本会被记录（`status: "failed"`），不影响当前在线内容。

### `GET /api/v1/info`（无需鉴权）

```json
{ "protocolVersion": 1, "serverVersion": "0.1.0", "snapshotVersions": [1], "latestSnapshotVersion": 1 }
```

客户端发现 `protocolVersion` 不兼容，或者 `snapshotVersions` 不包含自己要推送的版本时，应提示用户升级发布服务，不要降级推送。

### `GET /api/v1/site`

```json
{
  "siteId": "site_6cOTCQT9o2B7seINasl2e2",
  "currentRevisionId": 3,
  "revisions": [
    { "id": 3, "snapshotSha256": "…", "status": "ready", "error": null, "articleCount": 12,
      "createdAt": "…", "activatedAt": "…" }
  ]
}
```

`siteId` 在部署时生成，重装服务（清空数据卷）后会变化。客户端首次连接时记下它，之后推送前比对，
不一致时停止推送并请用户确认，避免把内容推到错误的站点。

### `POST /api/v1/uploads/plan`

```json
{ "files": [{ "sha256": "…", "size": 1024 }] }
```

返回 `{ "missing": ["…"] }`。

### `PUT /api/v1/blobs/{sha256}`

请求体是文件原始字节。服务端校验：

- 内容的 SHA-256 必须与路径一致；
- 只接受 PNG、JPEG、WebP、GIF、AVIF 图片（按文件头判断，不接受 SVG），以及 JSON 对象（快照）；
- 图片不超过 20 MB，快照不超过 50 MB。

新文件返回 201，已存在返回 200。

### `POST /api/v1/revisions`

```json
{ "snapshotSha256": "…" }
```

校验通过返回 201 与版本信息；校验失败返回 422，`error` 字段给出原因。`GET /api/v1/revisions/{id}` 可再次查询。

### `POST /api/v1/site/activate`

```json
{ "revisionId": 3 }
```

发布与回滚共用这个接口。激活后服务端会清理超出保留数量（`KEEP_REVISIONS`，默认 10）的旧版本，
以及不再被任何版本引用、且上传超过一小时的文件。

### `POST /api/v1/site/unpublish`

```json
{ "purge": false }
```

`purge: false` 只下线，版本保留，可以重新激活；`purge: true` 删除全部版本与文件。

## 快照 v1

```jsonc
{
  "snapshotVersion": 1,
  "generatedAt": "2026-10-30T08:00:00Z",
  "articles": [
    {
      "slug": "welcome",              // 小写字母、数字、连字符，最长 128；页面地址为 /p/<slug>
      "title": "欢迎",
      "markdown": "正文 ![图](/media/<sha256>.png)",
      "excerpt": "",                  // 可选，为空时从正文生成
      "tags": ["随笔"],
      "createdAt": "2026-10-28T09:00:00Z",
      "updatedAt": "2026-10-29T10:30:00Z", // 可选，默认等于 createdAt
      "pinned": false                 // 可选，置顶文章按数组顺序排在最前
    }
  ],
  "media": [{ "sha256": "…", "ext": "png", "size": 20480 }]
}
```

- 正文中的站内图片必须写成 `/media/<sha256>.<ext>`，并在 `media` 中声明、已经上传，否则版本校验失败。
- 未知字段会被忽略，便于以后扩展。
- **服务端不判断内容能否公开**。客户端必须在生成快照前完成隐私过滤：只包含用户明确选择发布的内容，
  移除内部链接、原件引用和未公开的图片。

## 只读接口

形状与 Petrichor 公开站一致，前台页面直接使用：

| 接口 | 说明 |
| --- | --- |
| `GET /api/public/article/list` | 当前版本的文章列表 |
| `GET /api/public/article/share/detail?shareCode=<slug>` | 文章详情 |
| `GET /api/public/article/search?q=&limit=&offset=` | 标题与正文搜索 |
| `GET /api/public/about/profile` | 关于我资料（环境变量） |
| `GET /api/public/filing` | 备案信息（环境变量） |
| `GET /media/<sha256>.<ext>` | 当前版本声明的图片 |
