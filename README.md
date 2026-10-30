# Sylva Publish

把 [Sylva](https://sylva.wl.do) 文档库中你选中的文章，发布到你自己域名下的只读站点。

- **自托管**：一个 Docker 镜像，部署在你自己的服务器上，Sylva 不经手你的内容和流量。
- **客户端推送**：在 Sylva 客户端填写站点地址和发布密钥，一键发布、增量更新、回滚和下线。
- **只发布你选的**：没有任何内容会被默认公开；隐私过滤在客户端完成，服务器上只有你确认公开的内容。
- **界面**：沿用 Petrichor 公开站的 Retypeset 风格，支持亮色/暗色、手机端、文章目录、思维导图与文章卡片。

当前版本提供文章列表、文章页和“关于我”。知识页与知识图谱会在后续版本加入。

## 快速部署

需要一台能访问公网的服务器，以及一个已经解析到这台服务器的域名。

```bash
git clone https://github.com/Ciao1019/sylva-publish.git
cd sylva-publish
cp .env.example .env        # 至少修改 SITE_DOMAIN，其余按需填写
docker compose up -d --build
docker compose logs publish # 找到“已生成发布密钥”下一行的 sp_ 开头的密钥
```

`compose.yaml` 自带 Caddy，会自动申请 HTTPS 证书。已有 Nginx、宝塔或 1Panel 的服务器，
可以只运行 `publish` 服务，把域名反向代理到它的 8080 端口，并设置 `TRUST_PROXY=true`。

然后在 Sylva 客户端的“公开发布”中填写：

- 站点地址：`https://你的域名`
- 发布密钥：上一步日志中的 `sp_…`

> 在中国大陆服务器上使用自有域名，需要先完成 ICP 备案，并在 `.env` 中填写 `FILING_*` 以在页脚展示备案号。

### 管理密钥

密钥只在首次启动时输出一次，服务端只保存它的哈希。忘记或泄露时：

```bash
docker compose exec publish sylva-publish key rotate
```

旧密钥立即失效，请在客户端中更新。

## 配置

全部配置通过环境变量设置，完整列表与说明见 [.env.example](./.env.example)。

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `SITE_TITLE` / `SITE_SUBTITLE` | 侧栏标题与副标题 | `Sylva` / `Knowledge, Articles & Inspiration` |
| `SITE_GITHUB_URL` | 侧栏 GitHub 图标链接，留空不显示 | 空 |
| `SITE_ALLOW_INDEXING` | 是否允许搜索引擎收录 | `false` |
| `ABOUT_*` | “关于我”的姓名、简介、专长、工具、引言、注记、联系方式 | 作者在 [wl.do/about](https://wl.do/about) 的资料 |
| `ABOUT_AVATAR_URL` | 头像网址或容器内文件路径 | 内置头像 |
| `FILING_*` | ICP 备案号与公安备案号 | 空 |
| `KEEP_REVISIONS` | 保留的历史版本数 | `10` |

## 开发

需要 [Bun](https://bun.sh) 1.3.14 或更新版本。

```bash
bun run install:all
bun run dev:server     # 发布服务：http://127.0.0.1:8080，首次启动会打印发布密钥
bun run dev:web        # 前台开发服务器：http://127.0.0.1:5173，接口转发到 8080

# 推送示例数据（内容全部虚构）
SYLVA_PUBLISH_URL=http://127.0.0.1:8080 SYLVA_PUBLISH_KEY=sp_xxx bun examples/push.ts examples/snapshot
```

检查：

```bash
bun run typecheck
bun run lint
bun run test
bun run build
```

## 推送协议

客户端与发布服务之间的协议见 [docs/protocol.md](./docs/protocol.md)。
[examples/push.ts](./examples/push.ts) 是一个不依赖 Sylva 的最小参考客户端，可以用来接入其他写作工具。

## 安全

- 发布密钥为 32 字节随机数，服务端只保存 SHA-256；鉴权失败过多的 IP 会被暂时封禁。
- 只接受 PNG、JPEG、WebP、GIF、AVIF 图片与快照 JSON，按文件头判断类型，不接受 SVG。
- 页面带有 CSP（禁止第三方脚本与内联脚本），默认 `noindex`。
- 发现安全问题请通过 GitHub 私密漏洞报告联系，不要公开提交 issue。

## 许可证

代码以 [MIT](./LICENSE) 许可证发布。第三方代码、字体以及不随 MIT 授权的头像等资源见
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
