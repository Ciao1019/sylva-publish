"use client"

import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { ThemeProvider } from '@/components/theme-provider'
import { lazy, Suspense, useLayoutEffect } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { RouteLoadErrorBoundary, RouteLoadSuccessMarker } from '@/components/route-load-boundary'
import { RouteLoadingFallback } from '@/components/route-loading-fallback'

// 显式 lazy 拆包：文章页的 Plate 渲染链体积较大，不应拖慢首页。
const BlogHomePage = lazy(() =>
  import('@/features/pages/blog/BlogHomePage').then((module) => ({ default: module.BlogHomePage }))
)
const AboutPage = lazy(() =>
  import('@/features/pages/about/AboutPage').then((module) => ({ default: module.AboutPage }))
)
const PublicArticlePage = lazy(() =>
  import('@/features/pages/public/PublicArticlePage').then((module) => ({ default: module.PublicArticlePage }))
)

function AppThemeScope() {
  const location = useLocation()

  // 发布站只有公开页面，始终启用公开站主题。
  useLayoutEffect(() => {
    document.documentElement.toggleAttribute('data-public-site', true)
  }, [])

  return (
    <ThemeProvider defaultTheme="system">
      <TooltipProvider>
        <Toaster />
        <div style={{ position: 'relative', minHeight: '100vh' }}>
          <RouteLoadErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<RouteLoadingFallback />}>
              <Routes>
                <Route path="/" element={<BlogHomePage />} />
                <Route path="/about" element={<AboutPage />} />
                <Route path="/p/:shareCode" element={<PublicArticlePage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
              <RouteLoadSuccessMarker />
            </Suspense>
          </RouteLoadErrorBoundary>
        </div>
      </TooltipProvider>
    </ThemeProvider>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AppThemeScope />
    </BrowserRouter>
  )
}

export default App
