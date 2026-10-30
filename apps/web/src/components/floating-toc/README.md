# FloatingToc：通用悬浮大纲（含完整源码）

适用于 React 的通用悬浮目录。默认显示标题层级横线，鼠标悬停或键盘聚焦后展开文字，支持当前项高亮、目录自动居中和点击跳转。

组件只接收 `{ id, level, text }` 数据，不解析 Markdown，也不读取 Plate 状态。数据可以来自 Markdown 渲染结果、Plate 标题节点、聊天消息或普通 HTML。

## 独立使用

**这份 README 包含完整源码和接入说明，可单独保存或交给开发者 / AI 使用。**

使用时，根据文末「完整源码」的三个代码块，在目标项目中创建对应文件，保持相对位置：

```text
components/floating-toc/
├── index.tsx          # React 组件、公开类型和 scrollToHeading 导出
├── toc.ts            # 类型与默认 DOM 定位逻辑
└── floating-toc.css  # 独立样式，由 index.tsx 自动导入
```

运行时仅依赖 `react`、`react-dom`，不需要安装 Plate、Tailwind、图标库或动画库。已验证的运行环境为 React 19 / TypeScript / Vite。构建环境需支持 TSX 与普通 CSS 导入；若框架要求全局 CSS 统一从入口加载，将 `index.tsx` 内的 CSS import 移到应用入口即可。

实际运行时，将文末源码保存为上面的三个文件。下方接入示例引用的就是这三个文件。

## 最小接入：普通 HTML 标题

```tsx
import { FloatingToc, type TocItem } from "./components/floating-toc"

const items: TocItem[] = [
  { id: "install", level: 2, text: "安装" },
  { id: "config", level: 3, text: "配置" },
]

export function Article() {
  return (
    <>
      <article>
        <h2 id="install">安装</h2>
        <p>安装说明……</p>
        <h3 id="config">配置</h3>
        <p>配置说明……</p>
      </article>
      <FloatingToc items={items} activeId="" />
    </>
  )
}
```

无需传 `onSelect` 即可点击跳转。默认定位通过 `document.getElementById(id)` 查找标题，滚动 `window`，并更新 URL 的 `#锚点`，不新增浏览历史。目标不存在时不滚动。

`activeId` 是受控属性：空字符串表示没有当前项。最小示例只演示跳转；随正文滚动更新高亮需要由宿主跟踪滚动，并将当前标题 ID 传回来。

固定导航栏的留白设置在正文标题上：

```css
article :is(h1, h2, h3, h4, h5, h6) {
  scroll-margin-top: 80px;
}
```

## 纯 Markdown：含点击跳转和滚动高亮

可使用任意 Markdown 渲染器，让渲染后的标题拥有稳定、唯一的 ID，再传给目录即可。下面示例使用 `react-markdown` 与 `rehype-slug`，运行该示例需安装这两个包；它们属于正文渲染方案，不是 FloatingToc 的依赖。

示例直接从渲染后的 DOM 收集标题，避免 Markdown 与目录分别生成 ID 时出现重复标题、标点、行内格式处理不一致的问题。

```tsx
import { useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import rehypeSlug from "rehype-slug"
import { FloatingToc, type TocItem } from "./components/floating-toc"

export function MarkdownArticle({ markdown }: { markdown: string }) {
  const rootRef = useRef<HTMLElement>(null)
  const [items, setItems] = useState<TocItem[]>([])
  const [activeId, setActiveId] = useState("")

  useEffect(() => {
    const headings = Array.from(
      rootRef.current?.querySelectorAll<HTMLElement>("h2[id], h3[id], h4[id]") ?? [],
    )
    setItems(headings.map((heading) => ({
      id: heading.id,
      level: Number(heading.tagName.slice(1)),
      text: heading.textContent?.trim() || "未命名标题",
    })))

    let frame: number | null = null
    const updateActive = () => {
      frame = null
      let current = headings[0]
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= 81) current = heading
      }
      // 末节很短时，标题可能始终无法到达顶部判定线。
      const page = document.documentElement
      if (page.scrollHeight > window.innerHeight
        && window.scrollY + window.innerHeight >= page.scrollHeight - 2) {
        current = headings[headings.length - 1]
      }
      setActiveId(current?.id ?? "")
    }
    const scheduleUpdate = () => {
      if (frame === null) frame = requestAnimationFrame(updateActive)
    }
    updateActive()
    window.addEventListener("scroll", scheduleUpdate, { passive: true })
    window.addEventListener("resize", scheduleUpdate)
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      window.removeEventListener("scroll", scheduleUpdate)
      window.removeEventListener("resize", scheduleUpdate)
    }
  }, [markdown])

  return (
    <>
      <article ref={rootRef} className="markdown-body">
        <ReactMarkdown rehypePlugins={[rehypeSlug]}>{markdown}</ReactMarkdown>
      </article>
      <FloatingToc items={items} activeId={activeId} />
    </>
  )
}
```

配套样式：

```css
.markdown-body :is(h2, h3, h4) { scroll-margin-top: 80px; }
```

此示例适用于同步渲染的正文和 `window` 滚动。若正文会在渲染完成后继续插入标题，应在渲染器的完成回调或 `MutationObserver` 中重新收集标题；图片等内容改变布局时，也应重新计算当前项。一个页面展示多篇文章时，要为标题 ID 添加文章前缀，确保整页唯一。

## Plate、聊天与自定义滚动容器

Plate 也可以使用相同组件：宿主提取标题并传入条目。如果渲染后的标题拥有匹配的 ID 且页面滚动源是 `window`，可以直接使用默认跳转。否则通过 `onSelect` 适配编辑器定位 API 或其他滚动容器。

```tsx
import { FloatingToc, type TocSelectHandler } from "./components/floating-toc"

// viewportRef 指向 overflow-y: auto 的容器；items、activeId 由宿主维护。
const selectItem: TocSelectHandler = (id, behavior = "smooth") => {
  const viewport = viewportRef.current
  if (!viewport) return
  const target = Array.from(
    viewport.querySelectorAll<HTMLElement>("[data-section-id]"),
  ).find((node) => node.dataset.sectionId === id)
  if (!target) return

  const top = target.getBoundingClientRect().top
    - viewport.getBoundingClientRect().top
    - viewport.clientTop
    + viewport.scrollTop
    - 16
  viewport.scrollTo({ top: Math.max(0, top), behavior })
  setActiveId(id)
}

<FloatingToc
  items={items}
  activeId={activeId}
  onSelect={selectItem}
  portal
  style={{ right: 24, top: "20%" }}
  aria-label="文档大纲"
/>
```

传入 `onSelect` 后，组件只调用它，不再执行默认定位或修改 URL。高亮跟踪也应监听对应容器的滚动。减少动态效果偏好开启时，组件会将 `"auto"` 传给回调；适配函数应使用这个参数。

## API

| 属性 | 类型 | 默认值 / 行为 |
| --- | --- | --- |
| `items` | `readonly TocItem[]` | 必填；空数组不渲染目录；顺序由宿主决定 |
| `activeId` | `string` | 必填；当前项 ID，空字符串表示无当前项 |
| `onSelect` | `(id: string, behavior?: ScrollBehavior) => void` | 按 DOM ID 定位并滚动 `window` |
| `portal` | `boolean` | `false`；开启后客户端挂载到 `document.body` |
| `centerOnSelect` | `boolean` | `false`；开启后点击时也居中目录项 |
| `aria-label` | `string` | `"目录"` |
| `className` | `string` | 追加样式类 |
| `style` | `React.CSSProperties` | 可覆盖位置、尺寸、层级等 |

```ts
type TocItem = {
  id: string    // 唯一标识；使用默认定位时，必须与正文标题 ID 完全一致
  level: number // 默认视觉层级针对 2、3、4；其他值使用基础样式
  text: string // 纯文本标题，超长时截断，可通过 title 查看完整文本
}
```

另导出 `scrollToHeading(id, behavior?) => boolean`，可在其他入口复用。返回值表示是否找到目标；未找到目标或服务端环境返回 `false`。

## 外观、键盘与移动端

- 样式包含浅色主题；祖先存在 `.dark` 或 `[data-theme="dark"]` 时切换暗色。Portal 模式下，主题应放在 `html` 或 `body` 上，局部容器的主题类和 CSS 变量不会自动继承到 Portal。
- 悬停或 Tab 聚焦时展开文字；Enter / Space 激活目录项，当前项使用 `aria-current="location"`。遵守 `prefers-reduced-motion`，减少过渡及滚动动画。
- 默认固定在右侧 28px、顶部 20%，目录高度不超过 `min(55vh, 420px)`；可通过 `style` 或自己的 CSS 覆盖。
- **默认在小于 1024px 的视口隐藏**。组件不包含移动端抽屉，可自行接入移动目录。若要在小屏显示，可用下方覆盖，但应确保触摸设备上的文字始终可见。
- `portal` 可避免祖先的 `transform`、`overflow` 影响定位；开启后初始服务端输出为空，客户端挂载后再显示。

```css
/* 在目标项目的样式中覆盖，className="my-toc"。 */
.my-toc { right: 20px; top: 120px; }

@media (max-width: 1023px) {
  .my-toc { display: flex; overflow-y: auto; max-width: 160px; }
  .my-toc .ftoc-text { opacity: 1; max-width: 120px; padding-inline: 8px; }
  .my-toc .ftoc-line { display: none; }
}
```

样式位于 CSS `components` 层，可通过自定义样式覆盖颜色、字体、尺寸和位置。标题数据、当前项检测、正文滚动容器和位置测量由使用方管理。

## 完整源码

以下是可直接复制的完整运行源码，无省略。按文件名分别保存即可。

### `index.tsx`

```tsx
"use client"

import * as React from "react"
import { createPortal } from "react-dom"

import { prefersReducedMotion, scrollToHeading, type TocItem, type TocSelectHandler } from "./toc"

import "./floating-toc.css"

export { scrollToHeading } from "./toc"
export type { TocItem, TocSelectHandler } from "./toc"

export type FloatingTocProps = {
  items: readonly TocItem[]
  activeId: string
  /** 默认按标题 DOM ID 跳转；编辑器、聊天等滚动容器可传入自己的定位逻辑。 */
  onSelect?: TocSelectHandler
  /** 挂载到 body，避免祖先的 transform 或 overflow 影响固定定位。 */
  portal?: boolean
  /** 点击时同时居中目录项；默认关闭，避免与正文滚动相互干扰。 */
  centerOnSelect?: boolean
  "aria-label"?: string
  className?: string
  style?: React.CSSProperties
}

const LINE_WIDTH: Record<number, number> = { 2: 14, 3: 10, 4: 7 }
const ACTIVE_LINE_WIDTH: Record<number, number> = { 2: 22, 3: 18, 4: 13 }

/** 只负责目录展示与交互，不依赖 Markdown、Plate 或对话运行时。 */
export function FloatingToc({
  items,
  activeId,
  onSelect = scrollToHeading,
  portal = false,
  centerOnSelect = false,
  "aria-label": ariaLabel = "目录",
  className,
  style,
}: FloatingTocProps) {
  const containerRef = React.useRef<HTMLElement | null>(null)
  const itemRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const unlockTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [portalReady, setPortalReady] = React.useState(false)

  React.useEffect(() => {
    if (portal) setPortalReady(true)
  }, [portal])

  const centerItem = React.useCallback((id: string) => {
    const container = containerRef.current
    const item = itemRefs.current.get(id)
    if (!container || !item) return
    container.scrollTo({
      top: item.offsetTop - container.clientHeight / 2 + item.clientHeight / 2,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    })
  }, [])

  React.useEffect(() => {
    if (unlockTimerRef.current === null && activeId) centerItem(activeId)
  }, [activeId, items, centerItem, portalReady])

  React.useEffect(() => () => {
    if (unlockTimerRef.current !== null) clearTimeout(unlockTimerRef.current)
  }, [])

  const handleSelect = (id: string) => {
    if (centerOnSelect) centerItem(id)
    // 正文平滑滚动期间暂停目录自动居中；连续点击时从最后一次点击重新计时。
    if (unlockTimerRef.current !== null) clearTimeout(unlockTimerRef.current)
    unlockTimerRef.current = setTimeout(() => { unlockTimerRef.current = null }, 900)
    if (prefersReducedMotion()) onSelect(id, "auto")
    else onSelect(id)
  }

  if (items.length === 0) return null

  const toc = (
    <nav ref={containerRef} className={["ftoc", className].filter(Boolean).join(" ")} style={style} aria-label={ariaLabel}>
      {items.map((item) => {
        const active = activeId === item.id
        const width = active ? (ACTIVE_LINE_WIDTH[item.level] ?? 18) : (LINE_WIDTH[item.level] ?? 10)
        return (
          <button
            key={item.id}
            ref={(node) => {
              if (node) itemRefs.current.set(item.id, node)
              else itemRefs.current.delete(item.id)
            }}
            type="button"
            data-toc-id={item.id}
            data-level={item.level}
            aria-current={active ? "location" : undefined}
            title={item.text}
            className={active ? "ftoc-item is-active" : "ftoc-item"}
            onClick={() => handleSelect(item.id)}
          >
            <span className="ftoc-text">{item.text}</span>
            <span className="ftoc-line" style={{ width }} aria-hidden="true" />
          </button>
        )
      })}
    </nav>
  )

  return portal ? (portalReady ? createPortal(toc, document.body) : null) : toc
}
```

### `toc.ts`

```ts
export type TocItem = {
  id: string
  level: number
  text: string
}

export type TocSelectHandler = (id: string, behavior?: ScrollBehavior) => void

export function prefersReducedMotion(): boolean {
  return typeof window === "undefined"
    || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
}

/** 按 DOM 标题 ID 定位，适用于任意渲染器；顶部留白由标题的 scroll-margin-top 决定。 */
export function scrollToHeading(id: string, behaviorOverride?: ScrollBehavior): boolean {
  if (typeof window === "undefined") return false
  const el = document.getElementById(id)
  if (!el) return false

  try {
    window.history.replaceState(null, "", `#${encodeURIComponent(id)}`)
  } catch {
    // 沙箱预览可能禁用历史记录，仍继续定位正文。
  }

  const behavior = behaviorOverride ?? (prefersReducedMotion() ? "auto" : "smooth")
  const margin = Number.parseFloat(window.getComputedStyle(el).scrollMarginTop)
  const absoluteTop = el.getBoundingClientRect().top + window.scrollY
  window.scrollTo({ top: Math.max(0, absoluteTop - (Number.isFinite(margin) ? margin : 0)), behavior })
  return true
}
```

### `floating-toc.css`

```css
/* 独立 CSS，无需 Tailwind、项目主题变量或全局 reset。 */
@layer components {
  .ftoc *, .ftoc *::before, .ftoc *::after {
    box-sizing: border-box;
  }

  .ftoc {
    position: fixed;
    right: 28px;
    top: 20%;
    z-index: 30;
    box-sizing: border-box;

    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 14px 12px;
    border-radius: 12px;

    max-height: min(55vh, 420px);
    overflow-y: hidden;
    overflow-x: hidden;

    background: transparent;
    border: 1px solid transparent;
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .ftoc:is(:hover, :focus-within) {
    overflow-y: auto;
    border-color: rgb(0 0 0 / 0.06);
    box-shadow: 0 8px 32px rgb(0 0 0 / 0.06);

    background: rgb(255 255 255 / 0.65);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
  }

  :is(.dark, [data-theme="dark"]) .ftoc:is(:hover, :focus-within) {
    border-color: rgb(255 255 255 / 0.08);
    box-shadow: 0 8px 32px rgb(0 0 0 / 0.3);
    background: rgb(24 24 27 / 0.7);
  }

  .ftoc::-webkit-scrollbar { width: 3px; }

  .ftoc::-webkit-scrollbar-track { background: transparent; }

  .ftoc::-webkit-scrollbar-thumb { background: transparent; border-radius: 3px; }

  .ftoc:is(:hover, :focus-within)::-webkit-scrollbar-thumb { background: rgb(0 0 0 / 0.12); }

  :is(.dark, [data-theme="dark"]) .ftoc:is(:hover, :focus-within)::-webkit-scrollbar-thumb { background: rgb(255 255 255 / 0.15); }

  .ftoc-item {
    box-sizing: border-box;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    cursor: pointer;
    padding: 4px 0;
    width: 100%;
    border-radius: 6px;
    transition: justify-content 0s,
                transform 0.25s cubic-bezier(0.4, 0, 0.2, 1),
                background 0.25s ease;
  }

  .ftoc:is(:hover, :focus-within) .ftoc-item {
    justify-content: flex-start;
  }

  .ftoc:is(:hover, :focus-within) .ftoc-item:hover {
    background: rgb(0 0 0 / 0.04);
  }

  :is(.dark, [data-theme="dark"]) .ftoc:is(:hover, :focus-within) .ftoc-item:hover {
    background: rgb(255 255 255 / 0.06);
  }

  .ftoc:is(:hover, :focus-within) .ftoc-item.is-active {
    background: rgb(0 0 0 / 0.04);
  }

  :is(.dark, [data-theme="dark"]) .ftoc:is(:hover, :focus-within) .ftoc-item.is-active {
    background: rgb(255 255 255 / 0.06);
  }

  .ftoc:is(:hover, :focus-within) .ftoc-item.is-active::before {
    content: "";
    position: absolute;
    left: 0;
    top: 4px;
    bottom: 4px;
    width: 2px;
    border-radius: 2px;
    background: rgb(0 0 0 / 0.75);
  }

  :is(.dark, [data-theme="dark"]) .ftoc:is(:hover, :focus-within) .ftoc-item.is-active::before {
    background: rgb(255 255 255 / 0.8);
  }

  .ftoc-line {
    display: block;
    height: 2px;
    border-radius: 2px;
    flex-shrink: 0;
    transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);

    background: rgb(0 0 0 / 0.18);
  }

  :is(.dark, [data-theme="dark"]) .ftoc-line {
    background: rgb(255 255 255 / 0.22);
  }

  .ftoc-item:hover .ftoc-line {
    background: rgb(0 0 0 / 0.45);
  }

  :is(.dark, [data-theme="dark"]) .ftoc-item:hover .ftoc-line {
    background: rgb(255 255 255 / 0.5);
  }

  .ftoc-item.is-active .ftoc-line {
    background: rgb(0 0 0 / 0.78);
  }

  :is(.dark, [data-theme="dark"]) .ftoc-item.is-active .ftoc-line {
    background: rgb(255 255 255 / 0.85);
  }

  .ftoc:is(:hover, :focus-within) .ftoc-line {
    width: 0 !important;
    opacity: 0;
  }

  .ftoc-text {
    opacity: 0;
    max-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    text-align: left;
    font-size: 12.5px;
    line-height: 1.35;
    letter-spacing: -0.01em;
    padding-right: 0;
    padding-left: 0;
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);

    color: rgb(0 0 0 / 0.4);
  }

  :is(.dark, [data-theme="dark"]) .ftoc-text {
    color: rgb(255 255 255 / 0.4);
  }

  .ftoc:is(:hover, :focus-within) .ftoc-text {
    max-width: 180px;
    opacity: 1;
    padding-left: 8px;
    padding-right: 6px;
  }

  .ftoc-item[data-level="2"] .ftoc-text {
    font-weight: 400;
  }

  .ftoc:is(:hover, :focus-within) .ftoc-item[data-level="2"] .ftoc-text {
    color: rgb(0 0 0 / 0.7);
  }

  :is(.dark, [data-theme="dark"]) .ftoc:is(:hover, :focus-within) .ftoc-item[data-level="2"] .ftoc-text {
    color: rgb(255 255 255 / 0.7);
  }

  .ftoc-item[data-level="3"] .ftoc-text {
    font-weight: 400;
  }

  .ftoc:is(:hover, :focus-within) .ftoc-item[data-level="3"] .ftoc-text {
    padding-left: 20px;
    color: rgb(0 0 0 / 0.48);
  }

  :is(.dark, [data-theme="dark"]) .ftoc:is(:hover, :focus-within) .ftoc-item[data-level="3"] .ftoc-text {
    color: rgb(255 255 255 / 0.48);
  }

  .ftoc-item[data-level="4"] .ftoc-text {
    font-weight: 400;
    font-size: 11.5px;
  }

  .ftoc:is(:hover, :focus-within) .ftoc-item[data-level="4"] .ftoc-text {
    padding-left: 32px;
    color: rgb(0 0 0 / 0.36);
  }

  :is(.dark, [data-theme="dark"]) .ftoc:is(:hover, :focus-within) .ftoc-item[data-level="4"] .ftoc-text {
    color: rgb(255 255 255 / 0.36);
  }

  .ftoc-item.is-active .ftoc-text {
    color: rgb(0 0 0 / 0.88);
    font-weight: 400;
  }

  :is(.dark, [data-theme="dark"]) .ftoc-item.is-active .ftoc-text {
    color: rgb(255 255 255 / 0.92);
  }

  .ftoc:is(:hover, :focus-within) .ftoc-item:hover .ftoc-text {
    color: rgb(0 0 0 / 0.7);
  }

  :is(.dark, [data-theme="dark"]) .ftoc:is(:hover, :focus-within) .ftoc-item:hover .ftoc-text {
    color: rgb(255 255 255 / 0.75);
  }

  .ftoc-item:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .ftoc, .ftoc-item, .ftoc-line, .ftoc-text {
      transition: none;
    }
  }

  /* 小屏由宿主提供目录入口；可通过 className 覆盖。 */
  @media (max-width: 1023px) {
    .ftoc {
      display: none;
    }
  }
}
```

维护说明：修改组件实现后，应同步更新本章节中的源码，确保单独保存的 README 仍能还原对应版本。
