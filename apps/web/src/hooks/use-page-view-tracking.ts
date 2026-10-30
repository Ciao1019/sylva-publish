// 发布站不做访问统计；保留与 Petrichor 相同的调用点，便于页面组件原样复用。
export type AnalyticsTarget =
  | { type: "page"; pageKey: string }
  | { type: "article"; shareCode: string }
  | { type: "profile" }

export function usePageViewTracking(_target: AnalyticsTarget | null, _viewKey: unknown) {}

export function usePublicPageTracking(_pageKey: string, _scope: "navigation" | "mount" = "navigation") {}
