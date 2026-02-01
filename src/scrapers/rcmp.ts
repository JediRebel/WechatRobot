// src/scrapers/rcmp.ts
/* eslint-disable no-console */

import puppeteer from "puppeteer"
import * as cheerio from "cheerio"
import axios from "axios" // 用 axios 抓详情页更快
import { NewsArticle, ScrapeOptions } from "../utils/types"
import { isWithinTimeWindow } from "../utils/helpers"

// 工具：处理相对路径
function absUrl(href: string): string {
  if (!href) return ""
  if (/^https?:\/\//i.test(href)) return href
  return new URL(href, "https://rcmp.ca").toString()
}

// 工具：从 HTML 字符串中提取 href
function extractLink(html: string): string {
  const m = html.match(/href\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i)
  const raw = m?.[1] || m?.[2] || m?.[3] || ""
  return raw ? absUrl(raw) : ""
}

// 工具：去除 HTML 标签
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * 抓取 RCMP 新闻的混合策略：
 * 1. Puppeteer: 渲染列表页，获取 DataTables 里的链接。
 * 2. Axios + Cheerio: 拿到链接后，并发抓取详情页正文（比全用 Puppeteer 快很多）。
 */
export async function scrape(opts: ScrapeOptions = {}): Promise<NewsArticle[]> {
  const browser = await puppeteer.launch({ headless: true })
  const page = await browser.newPage()

  // 伪装 UA，防止被拦截
  await page.setUserAgent(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  )

  try {
    if (opts.debug) console.log("[rcmp-nb] Launching Puppeteer for list...")

    // 1. 打开列表页
    await page.goto("https://rcmp.ca/en/nb/news", {
      waitUntil: "networkidle2",
      timeout: 60000,
    })

    // 2. 等待 DataTables 加载数据
    await page.waitForFunction(
      () =>
        (window as any).jQuery &&
        (window as any)
          .jQuery("#n")
          .DataTable()
          .data().length > 0,
      { timeout: 20000 },
    )

    // 3. 从内存中直接读取 DataTables 的数据 (比解析 DOM 更准)
    const rows = await page.evaluate(() => {
      const $ = (window as any).jQuery
      const dt = $("#n").DataTable()
      return dt.data().toArray()
    })

    if (opts.debug)
      console.log(`[rcmp-nb] Found ${rows.length} rows in DataTable.`)

    // 4. 初步筛选 (时间 + 格式)
    const candidates: NewsArticle[] = []
    for (const r of rows) {
      const titleHtml: string = r.title || ""
      const link = extractLink(titleHtml)
      const title = stripHtml(titleHtml)
      const dateStr: string = r.date || ""
      const date = dateStr ? new Date(dateStr) : new Date()

      if (!title || !link) continue

      // 时间过滤
      if (!opts.ignoreWindow && !isWithinTimeWindow(date.toISOString()))
        continue

      candidates.push({
        title,
        link,
        date,
        source: "rcmp-nb",
        content: "", // 暂时留空，等待填补
      })
    }

    // 关闭浏览器 (列表抓取完毕)
    await browser.close()

    // 截取前 10 条，避免一次抓太多
    const targets = candidates.slice(0, 10)
    if (opts.debug)
      console.log(`[rcmp-nb] Fetching details for ${targets.length} items...`)

    // 5. 并发抓取详情页正文 (使用 Axios，速度快)
    await Promise.all(
      targets.map(async (item) => {
        try {
          const { data: html } = await axios.get(item.link, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; Scraper/1.0)" },
            timeout: 10000,
          })
          const $ = cheerio.load(html)

          // 尝试提取正文 (Canada.ca 标准结构)
          // 移除干扰项
          $("script, style, nav, header, footer, .alert").remove()

          // 优先抓取 article 或 main
          let content =
            $("main article")
              .text()
              .trim() ||
            $("main #wb-cont")
              .nextAll()
              .text()
              .trim() ||
            $("main")
              .text()
              .trim()

          // 简单的清洗
          content = content.replace(/\s+/g, " ").slice(0, 5000) // 限制长度
          item.content = content
        } catch (e) {
          if (opts.debug)
            console.error(`[rcmp-nb] Failed to fetch detail: ${item.link}`)
        }
      }),
    )

    return targets
  } catch (e) {
    console.error("[rcmp-nb] scrape failed:", (e as Error).message)
    if (!browser.process()?.killed) await browser.close()
    return []
  }
}
