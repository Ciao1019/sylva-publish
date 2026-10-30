// 发布服务入口：读取环境变量配置，启动 HTTP 服务。
import { createApp } from "./app"
import { loadConfig } from "./config"
import { clientIp } from "./http"

const config = loadConfig()
const app = await createApp(config)

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  // 上传快照最大 50 MB，留出余量给请求头
  maxRequestBodySize: 52 * 1024 * 1024,
  fetch: (request, bunServer) => app.fetch(request, clientIp(request, bunServer, config.trustProxy)),
})

console.log(`[sylva-publish] 站点 ${app.siteId} 已启动：http://${server.hostname}:${server.port}`)
if (app.initialKey) {
  // 密钥只在首次生成时输出一次，服务端仅保存其哈希。
  console.log("[sylva-publish] 已生成发布密钥（只显示这一次，请填入 Sylva 客户端）：")
  console.log(app.initialKey)
}

function shutdown() {
  void server.stop().finally(() => {
    app.close()
    process.exit(0)
  })
}
process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
