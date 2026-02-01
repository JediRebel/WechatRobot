// src/utils/types.ts

/* ========= 新闻结果结构 ========= */

export interface NewsArticle {
  title: string
  link: string
  /** 进入主流程前必须是一个有效的 Date */
  date: Date
  /** 来源网站标识，例如 "cbc" | "city-sj" | "rothesay" */
  source: string
  /** 可选：正文，供 AI 摘要/分类使用 */
  content?: string
}

/** 爬虫解析列表/详情时的中间态：date 可以暂时为空，等细页补齐后再转为 NewsArticle */
export interface RawNewsRow {
  title: string
  link: string
  date?: Date | null
  source?: string // 有的地方也会先带上，非必填
}

/* ========= 下游（摘要 / 分类）结构 ========= */

export interface SummarizedNews {
  title: string
  summary: string
  link: string
  category?: NewsCategory
}

export interface ClassifiedNews extends SummarizedNews {
  category: NewsCategory
}

export enum NewsCategory {
  学校通知 = "学校通知",
  天气 = "天气",
  交通 = "交通",
  突发事件 = "突发事件",
  政府公告 = "政府公告",
  健康 = "健康",
  商业新闻 = "商业新闻",
  移民 = "移民",
  社区活动 = "社区活动",
  其他 = "其他",
}

/* ========= 时间窗与调试参数（dayjs 会用到） ========= */

export interface ScrapeOptions {
  /** 打印更详细日志 */
  debug?: boolean
  /** 跳过时间窗过滤，抓全量（用于一次性回溯或调试） */
  ignoreWindow?: boolean
  /** 过滤窗口时区，默认 NB 所在时区 */
  tz?: string // e.g. 'America/Moncton'
  /** 窗口起始小时（当天），默认 7 点 */
  windowStartHour?: number // default 7
  /** 窗口长度小时数，默认 24 小时 */
  windowHours?: number // default 24
}

export const DEFAULT_TZ = "America/Moncton" as const

/* ========= 爬虫配置结构（HTML / RSS） ========= */

export type SourceKind = "html" | "rss"

export interface HtmlSelectors {
  /** 列表项选择器 */
  listItem: string
  /** 相对列表项的标题选择器 */
  title: string
  /** 相对列表项的链接选择器 */
  link: string
  /** 可选：相对列表项的日期选择器 */
  date?: string
  /** 可选：日期从哪个属性取（若为 null/未填则取 innerText） */
  dateAttr?: string | null
  // 允许配置正文选择器
  content?: string
}

export interface DetailFetchOptions {
  /** 列表没有日期时是否抓详情页拿日期（默认 true） */
  fetchWhenNoDate?: boolean
  /** 是否总是抓取详情页（用于特别不稳定的站点） */
  alwaysFetch?: boolean
  /** 详情抓取并发 */
  concurrency?: number
}

export interface HtmlScraperConfig {
  id: string
  name: string
  enabled: boolean
  kind: "html"
  /** 列表页 URL */
  url: string
  /** 用于补全相对链接 */
  baseUrl?: string
  /** HTML 解析选择器 */
  selectors?: HtmlSelectors
  /** 标签 / 地区等 */
  areaTags?: string[]
  /** 最多保留条数 */
  maxItems?: number
  /** 额外请求头 */
  headers?: Record<string, string>
  /** 仅保留：链接含任一片段 */
  linkIncludes?: string[]
  /** 排除：链接含任一片段（如 /category/、/page/ 等） */
  linkExcludes?: string[]
  /** 剔除：标题含任一关键词 */
  titleExcludes?: string[]
  /** 详情抓取策略 */
  detail?: DetailFetchOptions
  /** 给 dayjs 的日期格式白名单 */
  dateFormats?: string[]
}

export interface RssScraperConfig {
  id: string
  name: string
  enabled: boolean
  kind: "rss"
  /** RSS 地址 */
  url: string
  areaTags?: string[]
  maxItems?: number
  /** 给 dayjs 的日期格式白名单 */
  dateFormats?: string[]
  /** 可选：请求头（部分源需要 Accept / UA 才能返回 feed） */
  headers?: Record<string, string>
}

export type AnyScraperConfig = HtmlScraperConfig | RssScraperConfig

/* ========= 类型守卫（方便在运行时区分 html / rss） ========= */

export function isHtmlConfig(c: AnyScraperConfig): c is HtmlScraperConfig {
  return c.kind === "html"
}

export function isRssConfig(c: AnyScraperConfig): c is RssScraperConfig {
  return c.kind === "rss"
}
