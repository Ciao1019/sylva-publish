// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/components/blog-search-dialog", () => ({
    BlogSearchDialog: () => null,
    useBlogSearchHotkey: () => undefined,
}))

vi.mock("@/components/iconimate", () => ({
    Github: () => <svg aria-hidden="true" />,
}))

const setTheme = vi.fn()
vi.mock("@/components/theme-provider", () => ({
    useTheme: () => ({ theme: "system", resolvedTheme: "dark", setTheme }),
}))

vi.mock("@/components/public-site-footer", () => ({
    PublicSiteFooter: ({ className }: { className?: string }) => (
        <footer className={className} data-public-filing-footer>
            备案信息
        </footer>
    ),
}))

vi.mock("@/components/public-site-author", () => ({
    PublicSiteAuthor: () => <a href="/about">作者</a>,
}))

const siteConfig = vi.hoisted(() => ({ title: "Sylva", subtitle: "副标题", description: "", githubUrl: "https://github.com/example/repo" }))
vi.mock("@/lib/api", () => ({
    getPublicSiteConfig: () => siteConfig,
}))

import { RetypesetSiteFooter, RetypesetSiteNav } from "@/features/pages/blog/RetypesetSiteChrome"

afterEach(() => {
    cleanup()
    setTheme.mockClear()
})

describe("RetypesetSiteNav", () => {
    it("只保留文章与关于入口，昼夜切换右侧是配置的仓库链接", () => {
        render(
            <MemoryRouter>
                <RetypesetSiteNav activeSection="articles" dockVisible />
            </MemoryRouter>,
        )

        const navigation = screen.getByRole("navigation", { name: "站点导航" })
        expect([...navigation.querySelectorAll("ul a")].map((link) => link.textContent)).toEqual(["文章", "关于"])
        const toggle = screen.getByRole("button", { name: "切换到浅色模式" })
        const github = screen.getByRole("link", { name: "GitHub 仓库" })
        expect(toggle.nextElementSibling).toBe(github)
        expect(github.getAttribute("href")).toBe(siteConfig.githubUrl)
        expect(screen.queryByRole("link", { name: "问答" })).toBeNull()

        fireEvent.click(toggle)
        expect(setTheme).toHaveBeenCalledWith("light")
    })

    it("未配置仓库地址时不显示 GitHub 入口", () => {
        siteConfig.githubUrl = ""
        render(
            <MemoryRouter>
                <RetypesetSiteNav activeSection="articles" dockVisible />
            </MemoryRouter>,
        )
        expect(screen.queryByRole("link", { name: "GitHub 仓库" })).toBeNull()
        siteConfig.githubUrl = "https://github.com/example/repo"
    })

    it("将备案信息独立于首屏导航，保留桌面侧栏定位", () => {
        const { container } = render(
            <MemoryRouter>
                <RetypesetSiteNav activeSection="articles" dockVisible />
                <RetypesetSiteFooter />
            </MemoryRouter>,
        )

        const navigation = screen.getByRole("navigation", { name: "站点导航" })
        const filing = container.querySelector<HTMLElement>("[data-public-filing-footer]")
        const navigationGroup = container.querySelector<HTMLElement>("[data-public-site-navigation]")

        expect(navigationGroup?.contains(navigation)).toBe(true)
        expect(navigationGroup?.contains(filing)).toBe(false)
        expect(filing?.classList.contains("lg:fixed")).toBe(true)
        expect(filing?.classList.contains("lg:bottom-20")).toBe(true)
        expect(filing?.classList.contains("fixed")).toBe(false)
    })
})
