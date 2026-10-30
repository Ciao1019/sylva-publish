import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: {
        // Bun 可能为宽松 peerDependency 保留嵌套 React；强制 lazy chunk 复用同一 React 实例。
        dedupe: ["react", "react-dom"],
        alias: [
            { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
        ],
    },
    optimizeDeps: {
        // 文章页位于 lazy 路由，显式列为扫描入口，避免首次进入时 Plate 依赖重建导致 504。
        entries: [
            "index.html",
            "src/features/pages/public/PublicArticlePage.tsx",
        ],
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
        sourcemap: false,
        target: "es2022",
    },
    worker: {
        format: "es",
    },
    server: {
        host: "127.0.0.1",
        port: 5173,
        strictPort: true,
        // 开发时把只读接口与图片转发到本机发布服务。
        proxy: {
            "/api": "http://127.0.0.1:8080",
            "/media": "http://127.0.0.1:8080",
            "/about-avatar": "http://127.0.0.1:8080",
        },
    },
})
