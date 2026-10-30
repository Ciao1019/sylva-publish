import type { AxiosResponse } from "axios"

import { api } from "@/lib/api-client"

// 正文注记样式：red/orange/green/teal/blue/purple/pink 为手绘波浪下划线，yellow 为荧光笔高亮。
export type AboutAccentStyle = "red" | "orange" | "green" | "teal" | "blue" | "purple" | "pink" | "yellow"

export interface AboutAccent {
  phrase: string
  style: AboutAccentStyle
  note?: string
}

export interface AboutProfileResponse {
  displayName: string
  roleTitle: string
  intro: string
  expertise: string[]
  toolkit: string[]
  quote: string
  accents: AboutAccent[]
  contactText: string
  contactLabel: string
  contactHref: string
  createdAt?: string | null
  updatedAt?: string | null
}

type AboutProfileCache = {
  response: AxiosResponse<AboutProfileResponse> | null
  request: Promise<AxiosResponse<AboutProfileResponse>> | null
}

// 作者资料在本次访问中保持稳定。
const publicAboutProfileCache: AboutProfileCache = { response: null, request: null }

function getPublicAboutProfileCache(): AboutProfileCache {
  return publicAboutProfileCache
}

export const publicAboutProfileApi = {
  detail: () => {
    const cache = getPublicAboutProfileCache()
    if (cache.response) return Promise.resolve(cache.response)
    if (cache.request) return cache.request

    cache.request = api.get<AboutProfileResponse>("/public/about/profile")
      .then((response) => {
        cache.response = response
        return response
      })
      .finally(() => {
        cache.request = null
      })
    return cache.request
  },
  getCachedDetail: () => getPublicAboutProfileCache().response?.data ?? null,
  invalidateClientCache: () => {
    publicAboutProfileCache.response = null
    publicAboutProfileCache.request = null
  },
}

export interface SiteFilingResponse {
  enabled: boolean
  icpNumber: string
  icpUrl: string
  publicSecurityNumber: string
  publicSecurityUrl: string
  createdAt?: string | null
  updatedAt?: string | null
}
