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
