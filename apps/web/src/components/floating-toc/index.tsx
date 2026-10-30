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
  /** 保留编辑器和对话页点击后居中目录项的行为，普通文章默认关闭以避免滚动抖动。 */
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
