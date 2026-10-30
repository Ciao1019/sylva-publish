import { useParams } from "react-router-dom"

import { usePublicPageMeta } from "@/features/pages/public-page-meta"
import { getPublicSiteConfig } from "@/lib/api"
import { PublicArticlePageView } from "@/features/pages/public/PublicArticlePageView"
import { usePublicArticlePageModel } from "@/features/pages/public/usePublicArticlePageModel"

export function PublicArticlePage() {
  const { shareCode } = useParams()
  const model = usePublicArticlePageModel(shareCode)
  usePublicPageMeta(
    `${model.title} · ${getPublicSiteConfig().title}`,
    model.aiSummary || "",
    `/p/${encodeURIComponent(shareCode || "")}`,
  )
  return <PublicArticlePageView model={model} />
}
