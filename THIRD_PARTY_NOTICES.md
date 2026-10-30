# 第三方声明

本仓库代码以 MIT 许可证发布（见 [LICENSE](./LICENSE)）。前台界面迁移自同一作者的
[Petrichor](https://github.com/Ciao1019/Petrichor) 公开站，其中复制或改编了下列第三方代码与资源，
它们按各自的许可证分发。npm 依赖的许可证随各依赖包分发，不在此重复列出。

## 代码

| 位置 | 来源 | 许可证 | 版权 |
| --- | --- | --- | --- |
| `apps/web/src/components/ui/`（基础组件） | [shadcn/ui](https://github.com/shadcn-ui/ui) | MIT | Copyright (c) 2023 shadcn |
| `apps/web/src/components/ui/*-node.tsx`、`components/editor/` | [Plate](https://github.com/udecode/plate) 组件注册表 | MIT | Copyright (c) Ziad Beyens, Dylan Schiemann, Joe Anderson, Felix Feng |
| `apps/web/src/components/godui/` | [GodUI](https://github.com/LucasBassetti/godui) Highlighter | MIT | Copyright (c) 2026 Lucas Bassetti |
| `apps/web/src/cuicui/` | [cuicui](https://github.com/damien-schneider/cuicui) Static Noise | MIT | Copyright (c) 2024 Damien Schneider |
| `apps/web/src/components/iconimate/` | [Iconimate](https://iconimate.app/) 动画与 [Phosphor Icons](https://github.com/phosphor-icons/core) 2.1.1 字形 | MIT | 见 [NOTICE.md](./apps/web/src/components/iconimate/NOTICE.md) |

以上 MIT 许可证的条款与本仓库 [LICENSE](./LICENSE) 相同，仅版权行不同。

## 字体

| 位置 | 来源 | 许可证 |
| --- | --- | --- |
| `apps/web/public/fonts/luo/` | [Luo 落文](https://github.com/tw93/Luo) | SIL OFL 1.1，见目录内 OFL.txt 与 README.md |
| `apps/web/public/fonts/maple/` | [Maple Mono](https://github.com/subframe7536/maple-font) | SIL OFL 1.1，见目录内 OFL.txt |

## 不随 MIT 授权的内容

- `apps/web/public/about-avatar.avif`、`about-avatar.png`：作者个人头像，仅作为默认示例使用。
  部署自己的站点时请通过 `ABOUT_AVATAR_URL` 换成你自己的头像。
- `apps/web/public/sidebar-logo.jpg`：网站图标，同上。
- “Sylva”“Petrichor”名称与图标不随本仓库许可证授权，分叉项目请更名。
