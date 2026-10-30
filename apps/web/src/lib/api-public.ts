import type { AxiosResponse } from "axios"

import { api } from "@/lib/api-client"
import type { SiteFilingResponse } from "@/lib/api-core"

export interface PublicSharedArticleDetailRequest {
  shareCode: string
  accessPassword?: string | null
}

export interface PublicArticleTocItem {
  id: string
  level: number
  text: string
}

export interface PublicSharedArticleDetailResponse {
  title: string
  mediaAccessToken?: string | null
  contentMd: string
  contentJson?: string | null
  contentMetaJson?: string | null
  tocJson?: PublicArticleTocItem[] | null
  aiSummary?: string | null
  aiSummaryGeneratedAt?: string | null
  aiSummaryStale?: boolean
  tags: string[]
  createdAt: string
  updatedAt: string
  isRepost: boolean
  originalUrl?: string | null
  originalAuthorName?: string | null
  mindmapData?: unknown | null
  mindmapGeneratedAt?: string | null
  knowledgeGraphData?: unknown | null
  knowledgeGraphGeneratedAt?: string | null
}

export interface PublicArticleListItem {
  articleId: string
  shareCode: string
  title: string
  excerpt: string
  updatedAt: string
  readingMinutes: number
  tags: string[]
  href: string
  expired: boolean
  expiresAt?: string | null
  hasPassword: boolean
  isRepost: boolean
  isInternalLink?: boolean
  isPinned?: boolean
  pinOrder?: number | null
}

export interface PublicArticleListResponse {
  items: PublicArticleListItem[]
}

export interface PublicArticleSearchItem extends PublicArticleListItem {
  score: number
}

export interface PublicArticleSearchResponse {
  keyword: string
  limit: number
  offset: number
  items: PublicArticleSearchItem[]
  hasMore: boolean
}

type ClientCacheEntry<T> = {
  expiresAt: number
  value: T
}

const publicArticleListCacheTtlMs = 60_000
const publicArticleDetailCacheTtlMs = 300_000
let publicArticleListCache: ClientCacheEntry<PublicArticleListResponse> | null = null
let publicArticleListRequest: Promise<AxiosResponse<PublicArticleListResponse>> | null = null
const publicArticleDetailCache = new Map<string, ClientCacheEntry<PublicSharedArticleDetailResponse>>()
const publicArticleDetailRequests = new Map<string, Promise<AxiosResponse<PublicSharedArticleDetailResponse>>>()

function createCachedAxiosResponse<T>(value: T): AxiosResponse<T> {
  return {
    data: value,
    status: 200,
    statusText: "OK",
    headers: {},
    config: {},
  } as AxiosResponse<T>
}

function getFreshClientCacheValue<T>(entry: ClientCacheEntry<T> | null | undefined, now = Date.now()) {
  return entry && entry.expiresAt > now ? entry.value : null
}

function fetchPublicArticleList(forceRefresh = false) {
  const cached = forceRefresh ? null : getFreshClientCacheValue(publicArticleListCache)
  if (cached) {
    return Promise.resolve(createCachedAxiosResponse(cached))
  }
  if (!forceRefresh && publicArticleListRequest) {
    return publicArticleListRequest
  }

  publicArticleListRequest = api.get<PublicArticleListResponse>("/public/article/list")
    .then((response) => {
      publicArticleListCache = {
        expiresAt: Date.now() + publicArticleListCacheTtlMs,
        value: response.data,
      }
      return response
    })
    .finally(() => {
      publicArticleListRequest = null
    })

  return publicArticleListRequest
}

function fetchPublicArticleDetailWithoutPassword(shareCode: string, forceRefresh = false) {
  const normalizedShareCode = shareCode.trim()
  const cached = forceRefresh ? null : getFreshClientCacheValue(publicArticleDetailCache.get(normalizedShareCode))
  if (cached) {
    return Promise.resolve(createCachedAxiosResponse(cached))
  }
  const inFlight = publicArticleDetailRequests.get(normalizedShareCode)
  if (!forceRefresh && inFlight) {
    return inFlight
  }

  const request = api.get<PublicSharedArticleDetailResponse>("/public/article/share/detail", {
    params: {
      shareCode: normalizedShareCode,
      ...(forceRefresh ? { _t: Date.now() } : {}),
    },
    ...(forceRefresh ? { headers: { "Cache-Control": "no-cache" } } : {}),
  })
    .then((response) => {
      publicArticleDetailCache.set(normalizedShareCode, {
        expiresAt: Date.now() + publicArticleDetailCacheTtlMs,
        value: response.data,
      })
      return response
    })
    .finally(() => {
      publicArticleDetailRequests.delete(normalizedShareCode)
    })
  publicArticleDetailRequests.set(normalizedShareCode, request)

  return request
}

function invalidatePublicArticleClientCache() {
  publicArticleListCache = null
  publicArticleListRequest = null
  publicArticleDetailCache.clear()
  publicArticleDetailRequests.clear()
}

let publicSiteFilingCache: SiteFilingResponse | null = null
let publicSiteFilingRequest: Promise<AxiosResponse<SiteFilingResponse>> | null = null

function fetchPublicSiteFiling() {
  if (publicSiteFilingCache) {
    return Promise.resolve(createCachedAxiosResponse(publicSiteFilingCache))
  }
  if (publicSiteFilingRequest) {
    return publicSiteFilingRequest
  }

  publicSiteFilingRequest = api.get<SiteFilingResponse>("/public/filing")
    .then((response) => {
      publicSiteFilingCache = response.data
      return response
    })
    .finally(() => {
      publicSiteFilingRequest = null
    })

  return publicSiteFilingRequest
}

function invalidatePublicSiteFilingClientCache() {
  publicSiteFilingCache = null
  publicSiteFilingRequest = null
}

export const publicSiteFilingApi = {
  detail: fetchPublicSiteFiling,
  getCachedDetail: () => publicSiteFilingCache,
  invalidateClientCache: invalidatePublicSiteFilingClientCache,
  resetClientCacheForTests: invalidatePublicSiteFilingClientCache,
}

export const publicArticleShareApi = {
  list: (options?: { forceRefresh?: boolean }) => fetchPublicArticleList(Boolean(options?.forceRefresh)),
  getCachedList: () => getFreshClientCacheValue(publicArticleListCache),
  search: (params: { keyword: string; limit?: number; offset?: number; signal?: AbortSignal }) =>
    api.get<PublicArticleSearchResponse>("/public/article/search", {
      params: {
        q: params.keyword,
        ...(params.limit != null ? { limit: params.limit } : {}),
        ...(params.offset != null ? { offset: params.offset } : {}),
      },
      signal: params.signal,
    }),
  detail: (shareCode: string, accessPassword?: string | null, options?: { forceRefresh?: boolean }) =>
    accessPassword?.trim()
      ? api.post<PublicSharedArticleDetailResponse>("/public/article/share/detail", {
        shareCode,
        accessPassword: accessPassword.trim(),
      }).then((response) => {
        publicArticleDetailCache.delete(shareCode.trim())
        return response
      })
      : fetchPublicArticleDetailWithoutPassword(shareCode, Boolean(options?.forceRefresh)),
  getCachedDetail: (shareCode: string) => getFreshClientCacheValue(publicArticleDetailCache.get(shareCode.trim())),
  prefetchDetail: (shareCode: string) => {
    const normalizedShareCode = shareCode.trim()
    if (!normalizedShareCode || getFreshClientCacheValue(publicArticleDetailCache.get(normalizedShareCode))) {
      return Promise.resolve()
    }
    return fetchPublicArticleDetailWithoutPassword(normalizedShareCode)
      .then(() => undefined)
      .catch(() => undefined)
  },
  invalidateClientCache: invalidatePublicArticleClientCache,
  resetClientCacheForTests: invalidatePublicArticleClientCache,
}

export interface PresignGetRequest {
  objectKey: string
}

export interface PresignGetResponse {
  url: string
}

export const uploadApi = {
  /** 公开版：获取预签名下载 URL，用于公开分享文章的附件（无需登录） */
  publicPresignGet: (objectKey: string, mediaAccessToken?: string | null) =>
    api.post<PresignGetResponse>("/public/upload/presign-get", {
      objectKey,
      ...(mediaAccessToken ? { mediaAccessToken } : {}),
    }),
}
