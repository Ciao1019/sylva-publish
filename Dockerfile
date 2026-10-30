# 构建前端
FROM oven/bun:1.3.14 AS web
WORKDIR /src/apps/web
COPY apps/web/package.json apps/web/bun.lock ./
COPY apps/web/patches ./patches
RUN bun install --frozen-lockfile
COPY apps/web ./
RUN bun run build

# 运行发布服务（无第三方运行时依赖）
FROM oven/bun:1.3.14-slim
WORKDIR /app
COPY apps/server/src ./server/src
COPY --from=web /src/apps/web/dist ./web/dist
COPY docker/sylva-publish /usr/local/bin/sylva-publish
RUN mkdir -p /data && chown -R bun:bun /data && chmod +x /usr/local/bin/sylva-publish
USER bun
ENV HOST=0.0.0.0 PORT=8080 DATA_DIR=/data WEB_DIST=/app/web/dist NODE_ENV=production
EXPOSE 8080
VOLUME ["/data"]
CMD ["bun", "server/src/server.ts"]
