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
import { saveNewsItems } from "../src/utils/db"
import OpenAI from "openai"

// ========== CLI 参数 ==========
const argv = minimist(process.argv.slice(2), {
  boolean: ["debug", "ignoreWindow", "all", "prod"],
  string: ["only", "windowHours", "show", "json"],
  alias: {
    d: "debug",
    i: "ignoreWindow",
    a: "all",
    o: "only",
    p: "prod",
  },
  default: {
    debug: false,
    ignoreWindow: false,
    all: false,
    show: "3",
    prod: false,
  },
})

const showLimit = Number(argv.show) || 3
const jsonPath = (argv.json || "").toString().trim()
const baseOpts: ScrapeOptions = {
  debug: !!argv.debug,
  ignoreWindow: !!argv.ignoreWindow,
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
  "参数：debug=%s, ignoreWindow=%s, windowHours=%s, show=%s, only=%s, all=%s, prod=%s\n",
  baseOpts.debug,
  baseOpts.ignoreWindow,
  baseOpts.windowHours ?? "(default)",
  showLimit,
  onlyId || "(none)",
  testAll,
  argv.prod,
)

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

// ========== 🚨 语义去重核心函数 ==========
const dateBucket = (d?: Date) => {
  if (d instanceof Date && !Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10) // 按日分桶，防止长周期误并
  }
  return new Date().toISOString().slice(0, 10)
}

async function clusterNewsByAI(items: any[]) {
  if (items.length <= 1) return items

  const shortTitleRatio =
    items.filter((it) => (it.title || "").trim().length <= 8).length /
    items.length
  // 全是极短标题时，跳过 AI，防误并
  if (shortTitleRatio > 0.7) {
    return items.map((it) => ({
      ...it,
      cluster_key: `${it.title}||${dateBucket(it.date)}`,
    }))
  }

  console.log(`🤖 正在请求 AI 进行语义去重（处理 ${items.length} 条数据）...`)
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const prompt = `
    你是一个新闻去重助手。请分析以下新闻标题列表，将描述同一事件的标题归为一组。
    要求：为每组新闻生成一个简短、标准的中文核心标题作为 "cluster_key"。
    请严格返回 JSON 数组格式，不要包含任何解释文字。格式如下：
    [{"idx": 0, "cluster_key": "标准化标题1"}, {"idx": 1, "cluster_key": "标准化标题1"}]
    
    新闻列表：
    ${items.map((it, idx) => `${idx}: ${it.title}`).join("\n")}
  `
  try {
    const completion = await openai.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
    })
    const content = completion.choices[0].message.content
    if (!content) return items
    const result = JSON.parse(content)
    const mappings = Array.isArray(result) ? result : result.clusters || []
    return items.map((it, idx) => {
      const match = mappings.find((m: any) => m.idx === idx)
      const baseKey = match && match.cluster_key ? match.cluster_key : it.title
      return { ...it, cluster_key: `${baseKey}||${dateBucket(it.date)}` }
    })
  } catch (err) {
    console.error("❌ AI 聚类失败，回退到标题去重:", err)
    return items.map((it) => ({
      ...it,
      cluster_key: `${it.title}||${dateBucket(it.date)}`,
    }))
  }
}

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

    let allItems = aggregated.flatMap((group) =>
      group.items.map((it) => ({
        title: it.title,
        link: it.link,
        source: it.source || group.sourceId,
        date: it.date,
        content: (it as any).content,
      })),
    )

    console.log(
      `\n📊 抓取汇总：共从 ${aggregated.length} 个源中抓取到 ${allItems.length} 条新闻。`,
    )

    if (argv.prod) {
      console.log("🚀 [Production 模式] 准备执行 AI 聚类并同步至数据库...")
      if (allItems.length > 0) {
        allItems = await clusterNewsByAI(allItems)
        try {
          await saveNewsItems(allItems)
          console.log(`✅ 数据库入库完成。`)
        } catch (dbErr) {
          console.error("❌ 数据库写入失败:", dbErr)
        }
      }
    } else {
      console.log("🧪 [Test 模式] 已跳过数据库入库。")
      const testOutDir = path.join(process.cwd(), "out")
      if (!fs.existsSync(testOutDir)) fs.mkdirSync(testOutDir)
      const testFile = path.join(testOutDir, "latest-fetch-test.json")
      fs.writeFileSync(testFile, JSON.stringify(allItems, null, 2), "utf8")
      console.log(`📝 抓取结果预览已保存至: ${testFile}`)
    }
    console.log("🏁 全部抓取任务结束。")
  } catch (globalErr) {
    console.error("❌ 全局运行异常:", globalErr)
  } finally {
    if (
      configsToTest.some(
        (c) => c.id === "rcmp-nb" || c.id === "town-saint-andrews",
      )
    ) {
      console.log("🧹 正在关闭常驻浏览器...")
      await browserManager.closeBrowser()
    }
  }
}

// ========== 恢复展示详情的辅助函数 ==========

async function testHtml(config: HtmlScraperConfig, opts: ScrapeOptions) {
  console.log(`🔍 正在爬取: [${config.id}] ${config.name}`)
  const items = await scrapeHtml(config, opts)
  const show = Math.min(showLimit, items.length)
  console.log(
    `✅ [${config.id}] got ${items.length} items. Showing first ${show}:`,
  )
  // 🚨 恢复详情打印
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
      content: (it as any).content,
    })),
  })
}

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
        return !Number.isNaN(t) && now - t <= windowMs
      })
    }
    const show = Math.min(showLimit, items.length)
    console.log(
      `✅ [${config.id}] got ${items.length} items. Showing first ${show}:`,
    )

    const mappedItems = (items || []).map((it) => ({
      title: it.title || "",
      link: it.link || "",
      dateISO: it.isoDate || it.pubDate,
      date: it.isoDate
        ? new Date(it.isoDate)
        : it.pubDate
        ? new Date(it.pubDate)
        : undefined,
      source: config.id,
      content: (it as any).content,
    }))
    // 🚨 恢复详情打印
    console.dir(mappedItems.slice(0, show), { depth: null })

    aggregated.push({
      sourceId: config.id,
      name: config.name,
      items: mappedItems,
    })
  } catch (e) {
    console.error(`❌ [${config.id}] error:`, (e as Error).message)
  }
}

async function testRcmp(opts: ScrapeOptions) {
  console.log("🔍 Testing RCMP NB (managed dynamic scraper)")
  const items = await scrapeRcmp(opts)
  const show = Math.min(showLimit, items.length)
  console.log(`✅ [rcmp-nb] got ${items.length} items. Showing first ${show}:`)
  // 🚨 恢复详情打印
  console.dir(items.slice(0, show), { depth: null })
  aggregated.push({
    sourceId: "rcmp-nb",
    name: "RCMP NB",
    items: items.map((it) => ({ ...it, source: it.source, content: (it as any).content })),
  })
}

async function testSaintAndrews(opts: ScrapeOptions) {
  console.log("🔍 Testing Town of Saint Andrews")
  const items = await scrapeSaintAndrews(opts)
  const show = Math.min(showLimit, items.length)
  console.log(
    `✅ [town-saint-andrews] got ${items.length} items. Showing first ${show}:`,
  )
  // 🚨 恢复详情打印
  console.dir(items.slice(0, show), { depth: null })
  aggregated.push({
    sourceId: "town-saint-andrews",
    name: "Saint Andrews",
    items: items.map((it) => ({ ...it, source: it.source, content: (it as any).content })),
  })
}

void run()
