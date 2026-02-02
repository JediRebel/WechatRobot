// scripts/fetch-all.ts
/* eslint-disable no-console */

import minimist from "minimist"
import Parser from "rss-parser"
import { SCRAPER_CONFIGS } from "../src/scraper-configs"
import {
  AnyScraperConfig,
  HtmlScraperConfig,
  RssScraperConfig,
  isHtmlConfig,
  isRssConfig,
  ScrapeOptions,
} from "../src/utils/types"
import { scrapeByConfig as scrapeHtml } from "../src/scrapers/genericScraper"
import { scrape as scrapeRcmp } from "../src/scrapers/rcmp"
import { scrape as scrapeSaintAndrews } from "../src/scrapers/saint-andrews"
import fs from "fs"
import path from "path"
import { browserManager } from "../src/utils/browser-manager"
// 🚨 引入数据库工具
import { saveNewsItems } from "../src/utils/db"

// ========== CLI 参数 ==========
const argv = minimist(process.argv.slice(2), {
  boolean: ["debug", "ignoreWindow", "all"],
  string: ["only", "windowHours", "show", "json"],
  alias: {
    d: "debug",
    i: "ignoreWindow",
    a: "all",
    o: "only",
  },
  default: {
    debug: false,
    ignoreWindow: false,
    all: false,
    show: "3",
  },
})

const showLimit = Number(argv.show) || 3
const jsonPath = (argv.json || "").toString().trim()
const baseOpts: ScrapeOptions = {
  debug: !!argv.debug,
  ignoreWindow: !!argv.ignoreWindow,
  // windowHours: argv.windowHours ? Number(argv.windowHours) : undefined,
  windowHours: argv.windowHours ? Number(argv.windowHours) : 24,
}

const onlyId = (argv.only || "").toString().trim()
const testAll = !!argv.all || !onlyId

let configsToTest: AnyScraperConfig[]
if (onlyId) {
  configsToTest = SCRAPER_CONFIGS.filter((c) => c.id === onlyId)
} else if (testAll) {
  configsToTest = SCRAPER_CONFIGS
} else {
  configsToTest = SCRAPER_CONFIGS
}

console.log(
  "参数：debug=%s, ignoreWindow=%s, windowHours=%s, show=%s, only=%s, all=%s\n",
  baseOpts.debug,
  baseOpts.ignoreWindow,
  baseOpts.windowHours ?? "(default)",
  showLimit,
  onlyId || "(none)",
  testAll,
)

if (!configsToTest.length) {
  console.error("❌ 没有找到要测试的配置（检查 id 是否正确）")
  process.exit(1)
}

const rssParser = new Parser()
const aggregated: Array<{
  sourceId: string
  name: string
  items: {
    title: string
    link: string
    dateISO?: string
    source: string
    date?: Date
  }[]
}> = []

async function run() {
  try {
    for (const config of configsToTest) {
      if (!config.enabled) {
        console.log(`⏭️  [${config.id}] ${config.name} (disabled)`)
        continue
      }

      try {
        if (isHtmlConfig(config)) {
          if (config.id === "rcmp-nb") {
            await testRcmp(baseOpts)
          } else if (config.id === "town-saint-andrews") {
            await testSaintAndrews(baseOpts)
          } else {
            await testHtml(config, baseOpts)
          }
        } else if (isRssConfig(config)) {
          await testRss(config, baseOpts)
        } else {
          console.log(
            `❓ [${(config as any).id}] Unknown kind: ${(config as any).kind}`,
          )
        }
      } catch (err) {
        console.error(
          `❌ [${(config as any).id}] error:`,
          (err as Error).message,
        )
      }

      console.log()
    }

    // 🚨 关键改进：在所有抓取完成后，将结果存入数据库进行持久化去重
    console.log("💾 正在将新新闻存入数据库...")
    const allItems = aggregated.flatMap((group) => group.items)
    if (allItems.length > 0) {
      try {
        await saveNewsItems(allItems)
        console.log(
          `✅ 已处理 ${allItems.length} 条新闻入库（重复项已自动忽略）。`,
        )
      } catch (dbErr) {
        // 即使入库失败，我们也希望看到采集完成的提示，不要让数据库错误阻塞整个流程
        console.error("❌ 数据库入库失败，但采集已完成:", dbErr)
      }
    }

    console.log("🏁 全部测试完成。")
  } finally {
    if (
      configsToTest.some(
        (c) => c.id === "rcmp-nb" || c.id === "town-saint-andrews",
      )
    ) {
      console.log("扫除：正在关闭常驻浏览器...")
      await browserManager.closeBrowser()
    }
  }

  if (jsonPath) {
    const out = aggregated
    const outFile =
      jsonPath.startsWith(".") || jsonPath.startsWith("/")
        ? jsonPath
        : path.join(process.cwd(), jsonPath)
    fs.mkdirSync(path.dirname(outFile), { recursive: true })
    fs.writeFileSync(outFile, JSON.stringify(out, null, 2), "utf8")
    console.log(`📝 Aggregated JSON saved to ${outFile}`)
  }
  process.exit(0)
}

// ========== HTML ==========
async function testHtml(config: HtmlScraperConfig, opts: ScrapeOptions) {
  console.log(`🔍 正在爬取: [${config.id}] ${config.name}`)
  const items = await scrapeHtml(config, opts)
  const show = Math.min(showLimit, items.length)
  console.log(
    `✅ [${config.id}] got ${items.length} items. Showing first ${show}:`,
  )
  console.dir(items.slice(0, show), { depth: null })
  aggregated.push({
    sourceId: config.id,
    name: config.name,
    items: items.map((it) => ({
      title: it.title,
      link: it.link,
      dateISO: it.date ? it.date.toISOString() : undefined,
      date: it.date,
      source: it.source,
    })),
  })
}

// ========== RSS ==========
async function testRss(config: RssScraperConfig, _opts: ScrapeOptions) {
  console.log(`🔍 正在爬取 RSS: [${config.id}] ${config.name}`)
  const parser = config.headers
    ? new Parser({ headers: config.headers })
    : rssParser

  try {
    const feed = await parser.parseURL(config.url)
    let items = feed.items || []

    if (!_opts.ignoreWindow && _opts.windowHours) {
      const now = Date.now()
      const windowMs = _opts.windowHours * 3600 * 1000
      items = items.filter((it) => {
        const d = it.isoDate || it.pubDate
        if (!d) return false
        const t = Date.parse(d)
        if (Number.isNaN(t)) return false
        return now - t <= windowMs
      })
    }

    if (config.maxItems && items.length > config.maxItems) {
      items = items.slice(0, config.maxItems)
    }

    const show = Math.min(showLimit, items.length)
    console.log(
      `✅ [${config.id}] got ${items.length} items. Showing first ${show}:`,
    )

    aggregated.push({
      sourceId: config.id,
      name: config.name,
      items: (items || []).map((it) => ({
        title: it.title || "",
        link: it.link || "",
        dateISO: it.isoDate || it.pubDate,
        date: it.isoDate
          ? new Date(it.isoDate)
          : it.pubDate
          ? new Date(it.pubDate)
          : undefined,
        source: config.id,
      })),
    })
  } catch (e) {
    console.error(`❌ [${(config as any).id}] error:`, (e as Error).message)
  }
}

// ========== RCMP 特殊 (Puppeteer Managed) ==========
async function testRcmp(opts: ScrapeOptions) {
  console.log("🔍 Testing RCMP NB (managed dynamic scraper)")
  const items = await scrapeRcmp(opts)
  const show = Math.min(showLimit, items.length)
  console.log(`✅ [rcmp-nb] got ${items.length} items. Showing first ${show}:`)
  aggregated.push({
    sourceId: "rcmp-nb",
    name: "RCMP New Brunswick",
    items: items.map((it) => ({
      title: it.title,
      link: it.link,
      dateISO: it.date ? it.date.toISOString() : undefined,
      date: it.date,
      source: it.source,
    })),
  })
}

// ========== Saint Andrews 特殊 (Puppeteer Managed) ==========
async function testSaintAndrews(opts: ScrapeOptions) {
  console.log(
    "🔍 Testing Town of Saint Andrews (managed dynamic scraper for 403 bypass)",
  )
  const items = await scrapeSaintAndrews(opts)
  const show = Math.min(showLimit, items.length)
  console.log(
    `✅ [town-saint-andrews] got ${items.length} items. Showing first ${show}:`,
  )
  aggregated.push({
    sourceId: "town-saint-andrews",
    name: "Town of Saint Andrews",
    items: items.map((it) => ({
      title: it.title,
      link: it.link,
      dateISO: it.date ? it.date.toISOString() : undefined,
      date: it.date,
      source: it.source,
    })),
  })
}

void run()
