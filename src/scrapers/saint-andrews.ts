// src/scrapers/saint-andrews.ts
const puppeteer = require("puppeteer-extra")
const StealthPlugin = require("puppeteer-extra-plugin-stealth")
puppeteer.use(StealthPlugin())

import { FinalItem } from "./genericScraper"
import { ScrapeOptions } from "../utils/types"
// ✅ 1. 引入时间判断工具
import { isWithinTimeWindow } from "../utils/helpers"

export async function scrape(opts: ScrapeOptions = {}): Promise<FinalItem[]> {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  )

  const results: FinalItem[] = []

  try {
    if (opts.debug)
      console.log("[town-saint-andrews] 正在尝试绕过 Cloudflare...")

    await page.goto("https://www.townofsaintandrews.ca/news/", {
      waitUntil: "networkidle2",
      timeout: 60000,
    })
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

    // 2. 循环详情页，并增加时间过滤
    for (const item of items) {
      // 先不 slice，根据时间窗口动态决定
      if (!item.link) continue

      // ✅ 3. 解析日期并检查时间窗口
      const articleDate = item.dateStr ? new Date(item.dateStr) : new Date()

      // 如果没有设置 ignoreWindow，则进行 24 小时检查
      if (
        !opts.ignoreWindow &&
        !isWithinTimeWindow(articleDate.toISOString())
      ) {
        if (opts.debug)
          console.log(
            `⏭️ [town-saint-andrews] 跳过旧闻: ${item.title} (${item.dateStr})`,
          )
        continue // 如果太旧了，跳过这条，继续看下一条
      }

      // 如果通过了时间检查，或者设置了 ignoreWindow，才进入详情页抓取正文
      try {
        await page.goto(item.link, {
          waitUntil: "networkidle2",
          timeout: 45000,
        })
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

        // 限制一下，抓到 5 条新鲜的就够了
        if (results.length >= 5) break
      } catch (e) {
        console.error(`[town-saint-andrews] 详情页抓取失败: ${item.link}`)
      }
    }
  } catch (e) {
    console.error("[town-saint-andrews] 绕过失败:", (e as Error).message)
  } finally {
    await browser.close()
  }

  return results
}
