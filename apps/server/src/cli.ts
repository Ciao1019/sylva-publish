// 运维命令：sylva-publish key rotate | site info
import { rotateKey, ensureSiteIdentity } from "./auth"
import { loadConfig } from "./config"
import { Store } from "./store"

const [command, subcommand] = process.argv.slice(2)
const store = new Store(loadConfig().dataDir)

try {
  if (command === "key" && subcommand === "rotate") {
    ensureSiteIdentity(store)
    console.log("新的发布密钥（旧密钥已失效，请在 Sylva 客户端中更新）：")
    console.log(rotateKey(store))
  } else if (command === "site" && subcommand === "info") {
    const { siteId } = ensureSiteIdentity(store)
    console.log(JSON.stringify({ siteId, currentRevisionId: store.currentRevisionId(), revisions: store.listRevisions().length }, null, 2))
  } else {
    console.log("用法：\n  sylva-publish key rotate   生成新的发布密钥\n  sylva-publish site info    查看站点 ID 与版本")
    process.exitCode = command ? 1 : 0
  }
} finally {
  store.close()
}
