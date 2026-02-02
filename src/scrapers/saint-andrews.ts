// src/scrapers/saint-andrews.ts
import { FinalItem } from "./genericScraper"
import { ScrapeOptions } from "../utils/types"
import { isWithinTimeWindow } from "../utils/helpers"
import { browserManager } from "../utils/browser-manager"

export async function scrape(opts: ScrapeOptions = {}): Promise<FinalItem[]> {
  // 🚨 使用集成了 Stealth 插件的托管页面
  const page = await browserManager.newPage()
  const results: FinalItem[] = []

  try {
    if (opts.debug)
      console.log("[town-saint-andrews] 正在尝试绕过 Cloudflare (Managed)...")

    await page.goto("https://www.townofsaintandrews.ca/news/", {
      waitUntil: "networkidle2",
      timeout: 60000,
    })

    // 🚨 保留你原来的 5秒 等待，这对绕过验证很重要
    await new Promise((r) => setTimeout(r, 5000))

    // 解析列表项
    const items = await page.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll(".oxy-dynamic-list .card-relaxed"),
      )
      return cards.map((card) => {
        const titleEl = card.querySelector("h3.ct-headline")
        const linkEl = card.querySelector("a.ct-link-text") as HTMLAnchorElement
        const dateEl = card.querySelector(".ct-text-block.font-semibold span")
        return {
          title: titleEl?.textContent?.trim() || "",
          link: linkEl?.href || "",
          dateStr: dateEl?.textContent?.trim() || "",
        }
      })
    })

    if (opts.debug)
      console.log(
        `[town-saint-andrews] 列表解析完成，找到 ${items.length} 条备选。`,
      )

    // 循环详情页
    for (const item of items) {
      if (!item.link) continue

      const articleDate = item.dateStr ? new Date(item.dateStr) : new Date()

      if (
        !opts.ignoreWindow &&
        !isWithinTimeWindow(articleDate.toISOString())
      ) {
        if (opts.debug) console.log(`⏭️  跳过旧闻: ${item.title}`)
        continue
      }

      // 🚨 进入详情页抓取正文
      try {
        if (opts.debug) console.log(`📖 正在抓取正文: ${item.title}`)

        await page.goto(item.link, {
          waitUntil: "networkidle2",
          timeout: 45000,
        })

        // 🚨 保留你原来的 2秒 等待
        await new Promise((r) => setTimeout(r, 2000))

        const content = await page.evaluate(() => {
          const container =
            document.querySelector(".oxy-stock-content-styles") ||
            document.querySelector("article")
          return container?.textContent?.replace(/\s+/g, " ").trim() || ""
        })

        results.push({
          title: item.title,
          link: item.link,
          date: articleDate,
          source: "town-saint-andrews",
          content: content,
        })

        if (results.length >= 5) break
      } catch (e) {
        console.error(`[town-saint-andrews] 详情页抓取失败: ${item.link}`)
      }
    }
  } catch (e) {
    console.error("[town-saint-andrews] 抓取失败:", (e as Error).message)
  } finally {
    // 仅关闭页面，不关闭浏览器
    if (page && !page.isClosed()) {
      await page.close()
    }
  }

  return results
}
