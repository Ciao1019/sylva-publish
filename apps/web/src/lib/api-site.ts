// 站点标题、副标题与仓库链接由发布服务从环境变量读取，并内联到 index.html，
// 页面首帧即可同步读取，不会出现标题闪烁。
export interface PublicSiteConfig {
  title: string
  subtitle: string
  description: string
  githubUrl: string
}

const DEFAULT_SITE_CONFIG: PublicSiteConfig = {
  title: "Sylva",
  subtitle: "Knowledge, Articles & Inspiration",
  description: "由 Sylva 发布的文章。",
  githubUrl: "",
}

let siteConfigCache: PublicSiteConfig | null = null

function readInlineSiteConfig(): Partial<PublicSiteConfig> {
  if (typeof document === "undefined") return {}
  const element = document.getElementById("sylva-site-config")
  if (!element?.textContent) return {}
  try {
    const parsed: unknown = JSON.parse(element.textContent)
    return parsed && typeof parsed === "object" ? parsed as Partial<PublicSiteConfig> : {}
  } catch {
    return {}
  }
}

export function getPublicSiteConfig(): PublicSiteConfig {
  if (!siteConfigCache) {
    const inline = readInlineSiteConfig()
    siteConfigCache = {
      title: inline.title?.trim() || DEFAULT_SITE_CONFIG.title,
      subtitle: inline.subtitle?.trim() || DEFAULT_SITE_CONFIG.subtitle,
      description: inline.description?.trim() || DEFAULT_SITE_CONFIG.description,
      githubUrl: inline.githubUrl?.trim() || DEFAULT_SITE_CONFIG.githubUrl,
    }
  }
  return siteConfigCache
}
